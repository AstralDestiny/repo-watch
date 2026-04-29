import type Database from "better-sqlite3";
import type { TrackedThread } from "./index.js";

export function getTrackedByThreadId(db: Database.Database, threadId: string): TrackedThread | undefined {
  const row = db
    .prepare(
      `SELECT id, owner, repo, github_number, github_item_type, discord_thread_id, discord_forum_channel_id,
              last_seen_comment_id, internal_pin_message_id, internal_notes, internal_status, internal_priority,
              github_reflected_state
       FROM tracked_threads WHERE discord_thread_id = ?`,
    )
    .get(threadId) as TrackedThread | undefined;
  return row;
}

export function getTrackedByGithub(
  db: Database.Database,
  owner: string,
  repo: string,
  number: number,
  type: "issue" | "pull_request",
): TrackedThread | undefined {
  return db
    .prepare(
      `SELECT id, owner, repo, github_number, github_item_type, discord_thread_id, discord_forum_channel_id,
              last_seen_comment_id, internal_pin_message_id, internal_notes, internal_status, internal_priority,
              github_reflected_state
       FROM tracked_threads WHERE owner = ? AND repo = ? AND github_number = ? AND github_item_type = ?`,
    )
    .get(owner, repo, number, type) as TrackedThread | undefined;
}

export function insertTrackedThread(
  db: Database.Database,
  row: Omit<TrackedThread, "id" | "github_reflected_state"> & { id?: number; github_reflected_state?: string | null },
): void {
  db.prepare(
    `INSERT INTO tracked_threads (
      owner, repo, github_number, github_item_type, discord_thread_id, discord_forum_channel_id,
      last_seen_comment_id, internal_pin_message_id, internal_notes, internal_status, internal_priority,
      github_reflected_state
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(owner, repo, github_number, github_item_type) DO UPDATE SET
      discord_thread_id = excluded.discord_thread_id,
      discord_forum_channel_id = excluded.discord_forum_channel_id`,
  ).run(
    row.owner,
    row.repo,
    row.github_number,
    row.github_item_type,
    row.discord_thread_id,
    row.discord_forum_channel_id,
    row.last_seen_comment_id,
    row.internal_pin_message_id,
    row.internal_notes,
    row.internal_status,
    row.internal_priority,
    row.github_reflected_state ?? null,
  );
}

export function listTrackedForRepo(db: Database.Database, owner: string, repo: string): TrackedThread[] {
  return db
    .prepare(
      `SELECT id, owner, repo, github_number, github_item_type, discord_thread_id, discord_forum_channel_id,
              last_seen_comment_id, internal_pin_message_id, internal_notes, internal_status, internal_priority,
              github_reflected_state
       FROM tracked_threads WHERE owner = ? AND repo = ?`,
    )
    .all(owner, repo) as TrackedThread[];
}

export function updateLastSeenComment(db: Database.Database, threadId: string, lastId: number): void {
  db.prepare(`UPDATE tracked_threads SET last_seen_comment_id = ? WHERE discord_thread_id = ?`).run(lastId, threadId);
}

export function updateGithubReflectedState(
  db: Database.Database,
  threadId: string,
  state: "open" | "closed",
): void {
  db.prepare(`UPDATE tracked_threads SET github_reflected_state = ? WHERE discord_thread_id = ?`).run(
    state,
    threadId,
  );
}

export function recordOutboundGithubComment(
  db: Database.Database,
  githubCommentId: number,
  discordMessageId: string,
  discordThreadId: string,
): void {
  db.prepare(
    `INSERT OR REPLACE INTO outbound_github_comment (github_comment_id, discord_message_id, discord_thread_id)
     VALUES (?, ?, ?)`,
  ).run(githubCommentId, discordMessageId, discordThreadId);
}

export function wasOutboundGithubComment(db: Database.Database, githubCommentId: number): boolean {
  const r = db.prepare(`SELECT 1 FROM outbound_github_comment WHERE github_comment_id = ?`).get(githubCommentId);
  return Boolean(r);
}

/** GitHub comment id for a Discord message posted via this bot (Discord → GitHub mirror). */
export function getGithubCommentIdForDiscordMessage(
  db: Database.Database,
  discordMessageId: string,
): number | undefined {
  const row = db
    .prepare(`SELECT github_comment_id FROM outbound_github_comment WHERE discord_message_id = ?`)
    .get(discordMessageId) as { github_comment_id: number } | undefined;
  return row?.github_comment_id;
}

/** Set internal fields explicitly (allows clearing with empty string if we pass undefined logic in caller) */
export function setInternalSummary(
  db: Database.Database,
  threadId: string,
  patch: { notes?: string; status?: string; priority?: string; pinMessageId?: string },
): void {
  const cur = getTrackedByThreadId(db, threadId);
  if (!cur) return;
  const notes = patch.notes !== undefined ? patch.notes : cur.internal_notes;
  const status = patch.status !== undefined ? patch.status : cur.internal_status;
  const priority = patch.priority !== undefined ? patch.priority : cur.internal_priority;
  const pin = patch.pinMessageId !== undefined ? patch.pinMessageId : cur.internal_pin_message_id;
  db.prepare(
    `UPDATE tracked_threads SET internal_notes = ?, internal_status = ?, internal_priority = ?, internal_pin_message_id = ?
     WHERE discord_thread_id = ?`,
  ).run(notes, status, priority, pin, threadId);
}

export function setHandled(db: Database.Database, threadId: string): void {
  db.prepare(`UPDATE tracked_threads SET discord_handled_at = ? WHERE discord_thread_id = ?`).run(
    Math.floor(Date.now() / 1000),
    threadId,
  );
}
