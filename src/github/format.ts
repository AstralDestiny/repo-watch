export function issuePermalink(owner: string, repo: string, number: number): string {
  return `https://github.com/${owner}/${repo}/issues/${number}`;
}

export function formatIssueHeader(
  owner: string,
  repo: string,
  issue: {
    number: number;
    title: string;
    state: string;
    user?: { login?: string } | null;
    labels?: Array<{ name?: string } | string>;
  },
): string {
  const labels =
    issue.labels && Array.isArray(issue.labels)
      ? issue.labels.map((l) => (typeof l === "string" ? l : l.name)).filter(Boolean).join(", ")
      : "";
  const lines = [
    `repo: ${owner}/${repo}`,
    `kind: issue`,
    `#${issue.number}: ${issue.title}`,
    `state: ${issue.state}`,
    `author: ${issue.user?.login ?? "unknown"}`,
    labels ? `labels: ${labels}` : null,
    `link: ${issuePermalink(owner, repo, issue.number)}`,
  ].filter(Boolean);
  return "```\n" + lines.join("\n") + "\n```";
}

export function formatPullHeader(
  owner: string,
  repo: string,
  pr: {
    number: number;
    title: string;
    state: string;
    draft?: boolean;
    user?: { login?: string } | null;
    labels?: Array<{ name?: string } | string>;
  },
): string {
  const labels =
    pr.labels && Array.isArray(pr.labels)
      ? pr.labels.map((l) => (typeof l === "string" ? l : l.name)).filter(Boolean).join(", ")
      : "";
  const lines = [
    `repo: ${owner}/${repo}`,
    `kind: pull_request`,
    `#${pr.number}: ${pr.title}`,
    `state: ${pr.state}`,
    `draft: ${pr.draft ? "yes" : "no"}`,
    `author: ${pr.user?.login ?? "unknown"}`,
    labels ? `labels: ${labels}` : null,
    `link: ${issuePermalink(owner, repo, pr.number)}`,
  ].filter(Boolean);
  return "```\n" + lines.join("\n") + "\n```";
}

/** Plain-text mirror for GitHub issue comments (send with `SuppressEmbeds` so URLs stay readable, no link cards). */
export function formatGithubCommentMirror(login: string, body: string, htmlUrl?: string | null): string {
  const u = htmlUrl?.trim();
  const head = u ? `**${login}** <${u}>` : `**${login}**`;
  return `${head}\n\n${body}`;
}
