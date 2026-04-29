import { readFileSync } from "node:fs";
import { z } from "zod";

const repoEntry = z.object({
  owner: z.string(),
  name: z.string(),
  discordIssuesForumId: z.string(),
  discordPrsForumId: z.string(),
  discordDiscussionsForumId: z.union([z.string(), z.null()]).optional(),
  trackIssues: z.boolean().default(true),
  trackPulls: z.boolean().default(true),
  trackDiscussions: z.boolean().default(false),
  pullsState: z.enum(["open", "closed", "all"]).default("open"),
});

const fileSchema = z.object({
  repos: z.array(repoEntry),
});

export type RepoConfig = z.infer<typeof repoEntry>;

export function loadReposConfig(path: string): RepoConfig[] {
  const raw = readFileSync(path, "utf-8");
  const json = JSON.parse(raw) as unknown;
  const parsed = fileSchema.safeParse(json);
  if (!parsed.success) {
    console.error(parsed.error.flatten());
    throw new Error(`Invalid repos config: ${path}`);
  }
  return parsed.data.repos;
}
