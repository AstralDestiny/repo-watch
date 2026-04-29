import { z } from "zod";

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_APPLICATION_ID: z.string().min(1),
  DISCORD_GUILD_ID: z.string().min(1),
  GITHUB_TOKEN: z.string().min(1),
  ALLOWED_DISCORD_USER_IDS: z.string().min(1),
  ALLOWED_ROLE_IDS: z.string().optional().default(""),
  CONFIG_PATH: z.string().default("./config/repos.json"),
  DATABASE_PATH: z.string().default("./data/bot.db"),
  POLL_INTERVAL_MS: z.coerce.number().min(10_000).default(90_000),
  /** Optional override for poller skip-by-author; empty = use GET /user (same identity as PAT) */
  GITHUB_ACTOR_LOGIN: z.string().optional().default(""),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error(parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment variables");
  }
  return parsed.data;
}

export function parseIdList(csv: string): Set<string> {
  return new Set(
    csv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}
