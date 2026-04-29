import type { Octokit } from "@octokit/rest";
import {
  ChannelType,
  type Client,
  type ForumChannel,
  MessageFlags,
  type ThreadChannel,
} from "discord.js";
import type Database from "better-sqlite3";
import type { RepoConfig } from "../config/repos.js";
import { sendChunked } from "../discord/chunkForDiscord.js";
import type { TrackedThread } from "../db/index.js";
import {
  getTrackedByGithub,
  insertTrackedThread,
  listTrackedForRepo,
  recordOutboundGithubComment,
  updateGithubReflectedState,
  updateLastSeenComment,
  wasOutboundGithubComment,
} from "../db/repo.js";
import { formatGithubCommentMirror, formatIssueHeader, formatPullHeader } from "./format.js";

const CLOSED_THREAD_PREFIX = "[Closed] ";

export class GithubPoller {
  private readonly discussionsWarned = new Set<string>();

  constructor(
    private readonly octokit: Octokit,
    private readonly discord: Client,
    private readonly db: Database.Database,
    /** Server PAT user's `login` — poller only; see `resolveActorLogin`. Not used for OAuth users later. */
    private readonly githubActorLogin: string,
  ) {}

  async runRepo(cfg: RepoConfig): Promise<void> {
    const { owner, name: repo } = cfg;
    const dk = `${owner}/${repo}`;
    if (cfg.trackDiscussions && !this.discussionsWarned.has(dk)) {
      this.discussionsWarned.add(dk);
      console.warn(
        `[${dk}] GitHub Discussions sync is not implemented yet — set trackDiscussions to false in config.`,
      );
    }
    if (cfg.trackIssues) await this.pollIssues(cfg);
    if (cfg.trackPulls) await this.pollPulls(cfg);
    const tracked = listTrackedForRepo(this.db, owner, repo);
    for (const t of tracked) {
      try {
        await this.syncCommentsForThread(t, cfg);
      } catch (e) {
        console.error(`syncComments ${owner}/${repo}#${t.github_number}`, e);
      }
    }
  }

  private async pollIssues(cfg: RepoConfig): Promise<void> {
    const { owner, name: repo } = cfg;
    const { data } = await this.octokit.rest.issues.listForRepo({
      owner,
      repo,
      state: "all",
      sort: "updated",
      direction: "desc",
      per_page: 40,
    });
    for (const item of data) {
      if ("pull_request" in item && item.pull_request) continue;
      const existing = getTrackedByGithub(this.db, owner, repo, item.number, "issue");
      if (existing) continue;
      await this.createIssueThread(cfg, item.number);
    }
  }

  private async pollPulls(cfg: RepoConfig): Promise<void> {
    const { owner, name: repo } = cfg;
    const { data } = await this.octokit.rest.pulls.list({
      owner,
      repo,
      state: cfg.pullsState,
      sort: "updated",
      direction: "desc",
      per_page: 30,
    });
    for (const pr of data) {
      const existing = getTrackedByGithub(this.db, owner, repo, pr.number, "pull_request");
      if (existing) continue;
      await this.createPullThread(cfg, pr.number);
    }
  }

  private async createIssueThread(cfg: RepoConfig, number: number): Promise<void> {
    const { owner, name: repo } = cfg;
    const { data: issue } = await this.octokit.rest.issues.get({ owner, repo, issue_number: number });
    if ("pull_request" in issue && issue.pull_request) return;

    const forum = await this.fetchForum(cfg.discordIssuesForumId);
    const title = `Issue #${issue.number} · ${issue.title}`.slice(0, 100);
    const header = formatIssueHeader(owner, repo, issue);
    const body = issue.body ?? "";
    const full = `${header}\n\n${body}`;

    const chunks = splitFirstChunk(full, 1900);
    const thread = await forum.threads.create({
      name: title,
      message: { content: chunks.first },
    });
    const ch = await thread.fetch();
    for (const rest of chunks.rest) {
      await sendChunked((c) => ch.send({ content: c }), rest, 12);
    }

    insertTrackedThread(this.db, {
      owner,
      repo,
      github_number: number,
      github_item_type: "issue",
      discord_thread_id: ch.id,
      discord_forum_channel_id: forum.id,
      last_seen_comment_id: 0,
      internal_pin_message_id: null,
      internal_notes: null,
      internal_status: null,
      internal_priority: null,
    });

    await this.backfillComments(ch, owner, repo, number);
  }

  private async createPullThread(cfg: RepoConfig, number: number): Promise<void> {
    const { owner, name: repo } = cfg;
    const { data: pr } = await this.octokit.rest.pulls.get({ owner, repo, pull_number: number });

    const forum = await this.fetchForum(cfg.discordPrsForumId);
    const title = `PR #${pr.number} · ${pr.title}`.slice(0, 100);
    const header = formatPullHeader(owner, repo, pr);
    const body = pr.body ?? "";
    const full = `${header}\n\n${body}`;

    const chunks = splitFirstChunk(full, 1900);
    const thread = await forum.threads.create({
      name: title,
      message: { content: chunks.first },
    });
    const ch = await thread.fetch();
    for (const rest of chunks.rest) {
      await sendChunked((c) => ch.send({ content: c }), rest, 12);
    }

    insertTrackedThread(this.db, {
      owner,
      repo,
      github_number: number,
      github_item_type: "pull_request",
      discord_thread_id: ch.id,
      discord_forum_channel_id: forum.id,
      last_seen_comment_id: 0,
      internal_pin_message_id: null,
      internal_notes: null,
      internal_status: null,
      internal_priority: null,
    });

    await this.backfillComments(ch, owner, repo, number);
  }

  private async backfillComments(thread: ThreadChannel, owner: string, repo: string, number: number): Promise<void> {
    const { data } = await this.octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: number,
      per_page: 100,
    });
    let maxId = 0;
    const sorted = [...data].sort((a, b) => a.id - b.id);
    for (const c of sorted) {
      maxId = Math.max(maxId, c.id);
      if (wasOutboundGithubComment(this.db, c.id)) continue;
      const text = formatGithubCommentMirror(c.user?.login ?? "unknown", c.body ?? "", c.html_url);
      await sendChunked(
        (content) => thread.send({ content, flags: MessageFlags.SuppressEmbeds }),
        text,
        12,
      );
    }
    updateLastSeenComment(this.db, thread.id, maxId);
  }

  private async syncCommentsForThread(t: TrackedThread, _cfg: RepoConfig): Promise<void> {
    let thread = (await this.discord.channels.fetch(t.discord_thread_id)) as ThreadChannel | null;
    if (!thread?.isTextBased()) return;

    const { data: ghIssue } = await this.octokit.rest.issues.get({
      owner: t.owner,
      repo: t.repo,
      issue_number: t.github_number,
    });
    const ghState: "open" | "closed" = ghIssue.state === "closed" ? "closed" : "open";
    let lastReflected = (t.github_reflected_state as "open" | "closed" | null) ?? null;

    if (ghState === "open" && lastReflected === "closed") {
      try {
        await this.reflectReopenedOnDiscord(thread);
        updateGithubReflectedState(this.db, t.discord_thread_id, "open");
        lastReflected = "open";
        thread = ((await this.discord.channels.fetch(t.discord_thread_id)) as ThreadChannel | null) ?? thread;
      } catch (e) {
        console.error(`reopen thread for ${t.owner}/${t.repo}#${t.github_number}`, e);
      }
    }

    const skipMirroringComments =
      thread.archived && ghState === "closed" && lastReflected === "closed";

    const { data } = await this.octokit.rest.issues.listComments({
      owner: t.owner,
      repo: t.repo,
      issue_number: t.github_number,
      per_page: 100,
    });

    const sorted = [...data].filter((c) => c.id > t.last_seen_comment_id).sort((a, b) => a.id - b.id);
    let maxSeen = t.last_seen_comment_id;
    for (const c of sorted) {
      maxSeen = Math.max(maxSeen, c.id);
      if (wasOutboundGithubComment(this.db, c.id)) continue;
      // Skip comments from the server PAT identity only (OAuth posters use other logins + outbound map).
      if (this.githubActorLogin && c.user?.login === this.githubActorLogin) continue;
      if (skipMirroringComments) continue;
      const text = formatGithubCommentMirror(c.user?.login ?? "unknown", c.body ?? "", c.html_url);
      await sendChunked(
        (content) => thread.send({ content, flags: MessageFlags.SuppressEmbeds }),
        text,
        12,
      );
    }
    if (maxSeen > t.last_seen_comment_id) updateLastSeenComment(this.db, t.discord_thread_id, maxSeen);

    try {
      if (ghState === "closed" && lastReflected !== "closed") {
        await this.reflectClosedOnDiscord(thread, ghIssue.html_url ?? "");
        updateGithubReflectedState(this.db, t.discord_thread_id, "closed");
      } else if (ghState === "open" && lastReflected == null) {
        updateGithubReflectedState(this.db, t.discord_thread_id, "open");
      }
    } catch (e) {
      console.error(`github closed-state sync ${t.owner}/${t.repo}#${t.github_number}`, e);
    }
  }

  /** Prefix title, post a short notice, archive — Discord hides active forum threads that are archived. */
  private async reflectClosedOnDiscord(thread: ThreadChannel, issueUrl: string): Promise<void> {
    if (thread.archived) {
      await thread.setArchived(false, "Apply GitHub closed state");
    }
    const cur = thread.name;
    if (!cur.startsWith(CLOSED_THREAD_PREFIX)) {
      await thread.setName((CLOSED_THREAD_PREFIX + cur).slice(0, 100), "GitHub item closed");
    }
    const link = issueUrl.trim();
    const line =
      `**Closed on GitHub** — this thread is archived so it does not look like active work.` +
      (link ? `\n${link}` : "");
    await thread.send({ content: line.slice(0, 2000), flags: MessageFlags.SuppressEmbeds });
    await thread.setArchived(true, "GitHub item closed");
  }

  private async reflectReopenedOnDiscord(thread: ThreadChannel): Promise<void> {
    await thread.setArchived(false, "GitHub item reopened");
    const stripped = thread.name.replace(/^\[Closed\]\s*/i, "").trim() || thread.name;
    if (stripped !== thread.name) {
      await thread.setName(stripped.slice(0, 100), "GitHub item reopened");
    }
  }

  private async fetchForum(id: string): Promise<ForumChannel> {
    const ch = await this.discord.channels.fetch(id);
    if (!ch || ch.type !== ChannelType.GuildForum) throw new Error(`Channel ${id} is not a forum`);
    return ch as ForumChannel;
  }
}

/** First forum post must be ≤ ~2000; split tail for sendChunked */
function splitFirstChunk(full: string, firstMax: number): { first: string; rest: string[] } {
  if (full.length <= firstMax) return { first: full, rest: [] };
  const first = full.slice(0, firstMax);
  const tail = full.slice(firstMax);
  return { first, rest: [tail] };
}

export async function postDiscordCommentToGithub(
  octokit: Octokit,
  db: Database.Database,
  owner: string,
  repo: string,
  issueNumber: number,
  body: string,
  discordThreadId: string,
  discordMessageId: string,
): Promise<void> {
  const { data: created } = await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body,
  });
  recordOutboundGithubComment(db, created.id, discordMessageId, discordThreadId);
}

export async function updateDiscordCommentOnGithub(
  octokit: Octokit,
  owner: string,
  repo: string,
  githubCommentId: number,
  body: string,
): Promise<void> {
  await octokit.rest.issues.updateComment({
    owner,
    repo,
    comment_id: githubCommentId,
    body,
  });
}
