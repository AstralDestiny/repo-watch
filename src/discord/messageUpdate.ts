import type { Message, PartialMessage } from "discord.js";
import type { Octokit } from "@octokit/rest";
import type Database from "better-sqlite3";
import { buildAllowlist, isAllowlisted } from "./allowlist.js";
import { getGithubCommentIdForDiscordMessage, getTrackedByThreadId } from "../db/repo.js";
import { updateDiscordCommentOnGithub } from "../github/poller.js";

export function attachMessageUpdate(
  db: Database.Database,
  octokit: Octokit,
  allowlist: ReturnType<typeof buildAllowlist>,
): (oldMessage: Message | PartialMessage, newMessage: Message | PartialMessage) => Promise<void> {
  return async (oldMessage, newMessage) => {
    let msg: Message;
    try {
      msg = newMessage.partial ? await newMessage.fetch() : newMessage;
    } catch {
      return;
    }

    if (!msg.channel.isThread()) return;
    if (msg.author?.bot) return;

    if (!oldMessage.partial && oldMessage.content === msg.content) return;

    const content = msg.content?.trim();
    if (!content) return;

    const tracked = getTrackedByThreadId(db, msg.channel.id);
    if (!tracked) return;

    if (!isAllowlisted(msg, allowlist.userIds, allowlist.roleIds)) return;

    const githubCommentId = getGithubCommentIdForDiscordMessage(db, msg.id);
    if (githubCommentId == null) return;

    try {
      await updateDiscordCommentOnGithub(octokit, tracked.owner, tracked.repo, githubCommentId, content);
    } catch (e) {
      console.error("Failed to update GitHub comment from Discord edit", e);
      await msg.react("❌").catch(() => {});
    }
  };
}
