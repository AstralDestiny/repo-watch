import type { Octokit } from "@octokit/rest";

/**
 * GitHub comments use the server PAT — identity comes from the token, not from this string.
 *
 * This `login` is **only** for the poller heuristic: skip re-mirroring issue comments authored by the
 * **same GitHub user as the server PAT** (belt-and-suspenders next to `outbound_github_comment`).
 *
 * **Future per-user OAuth / OpenID:** outbound posts should use **that user's** Octokit + token so
 * GitHub shows the right author; dedupe stays per-comment via `outbound_github_comment`. This
 * server-PAT login must **not** be reused to skip other users' comments — only ever compare to the
 * PAT used for **unauthenticated** poller reads (or drop this skip when all writes are per-user).
 */
export async function resolveActorLogin(octokit: Octokit, manualOverride: string): Promise<string> {
  const trimmed = manualOverride.trim();
  if (trimmed) {
    console.log(`Using GITHUB_ACTOR_LOGIN override: ${trimmed}`);
    return trimmed;
  }
  const { data } = await octokit.rest.users.getAuthenticated();
  console.log(`GitHub PAT is user: ${data.login} (used for poller skip; set GITHUB_ACTOR_LOGIN only to override)`);
  return data.login;
}
