import {
  ChannelType,
  type ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import type { Octokit } from "@octokit/rest";
import type Database from "better-sqlite3";
import type { Client } from "discord.js";
import type { Env } from "../env.js";
import type { RepoConfig } from "../config/repos.js";
import { getTrackedByThreadId, setHandled, setInternalSummary } from "../db/repo.js";

export const commandData = [
  new SlashCommandBuilder()
    .setName("verify-discord")
    .setDescription("Show loaded repo config and tracked thread counts"),
  new SlashCommandBuilder()
    .setName("setup-repo")
    .setDescription("Create issues / pull-requests / discussions forums under a category")
    .addStringOption((o) => o.setName("repo").setDescription("owner/repo").setRequired(true))
    .addChannelOption((o) =>
      o
        .setName("category")
        .setDescription("Parent category")
        .addChannelTypes(ChannelType.GuildCategory)
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("handled")
    .setDescription("Mark this thread handled locally (Discord-only)"),
  new SlashCommandBuilder()
    .setName("internal")
    .setDescription("Internal triage (never sent to GitHub)")
    .addSubcommand((s) =>
      s
        .setName("note")
        .setDescription("Append an internal note")
        .addStringOption((o) => o.setName("text").setDescription("Note text").setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName("status")
        .setDescription("Set internal status")
        .addStringOption((o) => o.setName("value").setDescription("Status text").setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName("priority")
        .setDescription("Set internal priority")
        .addStringOption((o) => o.setName("value").setDescription("Priority text").setRequired(true)),
    ),
].map((c) => c.toJSON());

export async function handleSlash(
  interaction: ChatInputCommandInteraction,
  ctx: { env: Env; db: Database.Database; repos: RepoConfig[]; octokit: Octokit; discord: Client },
): Promise<void> {
  void ctx.octokit;
  void ctx.discord;
  if (!interaction.inGuild() || !interaction.channel) {
    await interaction.reply({ content: "Use this in a server.", ephemeral: true });
    return;
  }

  const { env, db, repos } = ctx;

  if (interaction.commandName === "verify-discord") {
    const tracked = db.prepare(`SELECT COUNT(*) as c FROM tracked_threads`).get() as { c: number };
    await interaction.reply({
      ephemeral: true,
      content: `Repos in config: **${repos.length}**\nTracked threads in DB: **${tracked.c}**\nDatabase: \`${env.DATABASE_PATH}\``,
    });
    return;
  }

  if (interaction.commandName === "setup-repo") {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
      await interaction.reply({ content: "Need **Manage Channels**.", ephemeral: true });
      return;
    }
    const raw = interaction.options.getString("repo", true).trim();
    const parts = raw.split("/").filter(Boolean);
    if (parts.length !== 2) {
      await interaction.reply({ content: "Use `owner/repo` (one slash).", ephemeral: true });
      return;
    }
    const [owner, name] = parts as [string, string];
    const category = interaction.options.getChannel("category", true);
    if (category.type !== ChannelType.GuildCategory) {
      await interaction.reply({ content: "Pick a category channel.", ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const guild = interaction.guild!;
    const labels = ["issues", "pull-requests", "discussions"] as const;
    const ids: Record<(typeof labels)[number], string> = {
      issues: "",
      "pull-requests": "",
      discussions: "",
    };
    for (const label of labels) {
      const ch = await guild.channels.create({
        name: label,
        type: ChannelType.GuildForum,
        parent: category.id,
        reason: `GitHub mirror setup for ${owner}/${name}`,
      });
      ids[label] = ch.id;
    }

    const snippet = {
      owner,
      name,
      discordIssuesForumId: ids.issues,
      discordPrsForumId: ids["pull-requests"],
      discordDiscussionsForumId: ids.discussions,
      trackIssues: true,
      trackPulls: true,
      trackDiscussions: false,
      pullsState: "open" as const,
    };

    await interaction.editReply({
      content:
        `Created forums for **${owner}/${name}** under **${category.name}**.\n\n` +
        `Add this object to the \`repos\` array in \`config/repos.json\`, then restart the bot:\n\`\`\`json\n${JSON.stringify(snippet, null, 2)}\n\`\`\``,
    });
    return;
  }

  if (interaction.commandName === "handled") {
    if (!interaction.channel?.isThread()) {
      await interaction.reply({ content: "Use inside a forum **thread**.", ephemeral: true });
      return;
    }
    const t = getTrackedByThreadId(db, interaction.channel.id);
    if (!t) {
      await interaction.reply({ content: "This thread is not tracked.", ephemeral: true });
      return;
    }
    setHandled(db, interaction.channel.id);
    await interaction.reply({ content: "Marked handled (local).", ephemeral: true });
    return;
  }

  if (interaction.commandName === "internal") {
    if (!interaction.channel?.isThread()) {
      await interaction.reply({ content: "Use inside a tracked forum thread.", ephemeral: true });
      return;
    }
    const t0 = getTrackedByThreadId(db, interaction.channel.id);
    if (!t0) {
      await interaction.reply({ content: "This thread is not tracked.", ephemeral: true });
      return;
    }
    const sub = interaction.options.getSubcommand(true);
    const thread = interaction.channel;

    let notes = t0.internal_notes;
    let status = t0.internal_status;
    let priority = t0.internal_priority;

    if (sub === "note") {
      const text = interaction.options.getString("text", true);
      notes = notes ? `${notes}\n${text}` : text;
    } else if (sub === "status") {
      status = interaction.options.getString("value", true);
    } else if (sub === "priority") {
      priority = interaction.options.getString("value", true);
    }

    setInternalSummary(db, thread.id, {
      notes: notes ?? undefined,
      status: status ?? undefined,
      priority: priority ?? undefined,
    });

    const t1 = getTrackedByThreadId(db, thread.id)!;
    const summary =
      `**Internal triage** (not on GitHub)\n` +
      `**status:** ${t1.internal_status ?? "—"}\n` +
      `**priority:** ${t1.internal_priority ?? "—"}\n` +
      `**notes:**\n${t1.internal_notes ?? "—"}`;

    const content = summary.slice(0, 2000);
    const existingPin = t1.internal_pin_message_id;
    try {
      if (existingPin) {
        const msg = await thread.messages.fetch(existingPin);
        await msg.edit({ content });
      } else {
        const msg = await thread.send({ content });
        db.prepare(`UPDATE tracked_threads SET internal_pin_message_id = ? WHERE discord_thread_id = ?`).run(
          msg.id,
          thread.id,
        );
      }
    } catch {
      const msg = await thread.send({ content });
      db.prepare(`UPDATE tracked_threads SET internal_pin_message_id = ? WHERE discord_thread_id = ?`).run(
        msg.id,
        thread.id,
      );
    }

    await interaction.reply({ content: "Updated internal triage.", ephemeral: true });
    return;
  }
}
