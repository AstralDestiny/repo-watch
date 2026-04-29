import "dotenv/config";
import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
} from "discord.js";
import { loadEnv } from "./env.js";
import { loadReposConfig } from "./config/repos.js";
import { openDatabase } from "./db/index.js";
import { createOctokit } from "./github/octokit.js";
import { GithubPoller } from "./github/poller.js";
import { resolveActorLogin } from "./github/resolveActorLogin.js";
import { attachMessageCreate } from "./discord/messageCreate.js";
import { attachMessageUpdate } from "./discord/messageUpdate.js";
import { buildAllowlist } from "./discord/allowlist.js";
import { commandData, handleSlash } from "./discord/slashCommands.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const repos = loadReposConfig(env.CONFIG_PATH);
  const db = openDatabase(env.DATABASE_PATH);
  const octokit = createOctokit(env.GITHUB_TOKEN);
  const githubActorLogin = await resolveActorLogin(octokit, env.GITHUB_ACTOR_LOGIN);
  const allowlist = buildAllowlist(env);

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      // GuildMembers omitted: enable Server Members Intent + add it here if you rely on ALLOWED_ROLE_IDS and member is missing on messages.
    ],
    partials: [Partials.Channel],
  });

  const poller = new GithubPoller(octokit, client, db, githubActorLogin);

  client.once(Events.ClientReady, async (c) => {
    console.log(`Logged in as ${c.user.tag}`);
    const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);
    await rest.put(Routes.applicationGuildCommands(env.DISCORD_APPLICATION_ID, env.DISCORD_GUILD_ID), {
      body: commandData,
    });
    console.log("Slash commands registered for guild", env.DISCORD_GUILD_ID);

    const run = async () => {
      for (const r of repos) {
        try {
          await poller.runRepo(r);
        } catch (e) {
          console.error(`poll ${r.owner}/${r.name}`, e);
        }
      }
    };
    await run();
    setInterval(run, env.POLL_INTERVAL_MS);
  });

  client.on(Events.MessageCreate, attachMessageCreate(db, octokit, allowlist));
  client.on(Events.MessageUpdate, attachMessageUpdate(db, octokit, allowlist));

  client.on(Events.InteractionCreate, async (i) => {
    if (!i.isChatInputCommand()) return;
    try {
      await handleSlash(i, { env, db, repos, octokit, discord: client });
    } catch (e) {
      console.error("slash error", e);
      if (i.deferred || i.replied) await i.editReply({ content: "Command failed." }).catch(() => {});
      else await i.reply({ content: "Command failed.", ephemeral: true }).catch(() => {});
    }
  });

  await client.login(env.DISCORD_TOKEN);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
