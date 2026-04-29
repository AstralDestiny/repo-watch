import type { GuildMember, Message } from "discord.js";
import type { Env } from "../env.js";
import { parseIdList } from "../env.js";

export function buildAllowlist(env: Env): {
  userIds: Set<string>;
  roleIds: Set<string>;
} {
  return {
    userIds: parseIdList(env.ALLOWED_DISCORD_USER_IDS),
    roleIds: parseIdList(env.ALLOWED_ROLE_IDS ?? ""),
  };
}

export function isAllowlisted(message: Message, userIds: Set<string>, roleIds: Set<string>): boolean {
  if (message.author.bot) return false;
  const uid = message.author.id;
  if (userIds.has(uid)) return true;
  if (roleIds.size === 0) return false;
  const member = message.member as GuildMember | null;
  if (!member) return false;
  return member.roles.cache.some((r) => roleIds.has(r.id));
}
