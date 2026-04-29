import type { Message } from "discord.js";
import type { Octokit } from "@octokit/rest";
import type Database from "better-sqlite3";
import { buildAllowlist, isAllowlisted } from "./allowlist.js";
import { getTrackedByThreadId } from "../db/repo.js";
import { postDiscordCommentToGithub } from "../github/poller.js";

export function attachMessageCreate(
  db: Database.Database,
  octokit: Octokit,
  allowlist: ReturnType<typeof buildAllowlist>,
): (message: Message) => Promise<void> {
  return async (message: Message) => {
    if (!message.channel.isThread()) return;
    if (message.author.bot) return;
    if (!message.content?.trim()) return;

    const tracked = getTrackedByThreadId(db, message.channel.id);
    if (!tracked) return;

    if (!isAllowlisted(message, allowlist.userIds, allowlist.roleIds)) return;

    const body = message.content.trim();
    try {
      await postDiscordCommentToGithub(
        octokit,
        db,
        tracked.owner,
        tracked.repo,
        tracked.github_number,
        body,
        tracked.discord_thread_id,
        message.id,
      );
    } catch (e) {
      console.error("Failed to post GitHub comment", e);
      await message.react("❌").catch(() => {});
    }
  };
}
