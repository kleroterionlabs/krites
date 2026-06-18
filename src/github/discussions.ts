// src/github/discussions.ts — peer coordination via GitHub Discussions. Krites posts a CLAIM before
// reviewing/merging a PR so independent runners don't act on the same one, and escalates to a human via
// a separate category. Claims are best-effort cooperative locks (Discussions have no transaction):
// check → post → re-check. The claim KEY is `#<pr>@<headSha>` so a force-push under the claim
// invalidates it — the reviewed code can never silently change beneath the lock.
import type { GitHubClient } from "@kleroterion/koine";

/** Machine-readable marker embedded in a claim discussion body (HTML comment, invisible in the UI). */
const CLAIM_RE = /<!--\s*krites:claim\s+pr=(\S+)\s+run=(\S+)\s+ts=(\S+)\s*-->/g;

export interface Claim {
  prKey: string; // `#<number>@<headSha>`
  runId: string;
  ts: string; // ISO-8601
  url: string;
}

/** Stable claim key for a PR at a specific head — a force-push changes the SHA and breaks the claim. */
export const prClaimKey = (prNumber: number, headSha: string): string => `#${prNumber}@${headSha}`;

export function claimMarker(prKey: string, runId: string, ts: string): string {
  return `<!-- krites:claim pr=${prKey} run=${runId} ts=${ts} -->`;
}

/** Is there a FRESH claim for this PR-key held by a DIFFERENT run? (pure — testable) */
export function hasActiveClaim(
  prKey: string,
  runId: string,
  claims: Claim[],
  now: number,
  ttlMinutes: number,
): boolean {
  const ttlMs = ttlMinutes * 60_000;
  return claims.some((c) => c.prKey === prKey && c.runId !== runId && now - new Date(c.ts).getTime() < ttlMs);
}

async function repositoryId(gh: GitHubClient, owner: string, name: string): Promise<string> {
  const data = await gh.graphql<{ repository: { id: string } }>(
    "read",
    "query($o:String!,$n:String!){ repository(owner:$o,name:$n){ id } }",
    { o: owner, n: name },
  );
  return data.repository.id;
}

export async function findCategoryId(
  gh: GitHubClient,
  owner: string,
  name: string,
  category: string,
): Promise<string | null> {
  const data = await gh.graphql<{
    repository: { discussionCategories: { nodes: Array<{ id: string; name: string }> } };
  }>(
    "read",
    "query($o:String!,$n:String!){ repository(owner:$o,name:$n){ discussionCategories(first:25){ nodes{ id name } } } }",
    { o: owner, n: name },
  );
  const found = data.repository.discussionCategories.nodes.find(
    (c) => c.name.toLowerCase() === category.toLowerCase(),
  );
  return found?.id ?? null;
}

/** Parse recent claim markers from the coordination category. */
export async function listClaims(
  gh: GitHubClient,
  owner: string,
  name: string,
  categoryId: string,
): Promise<Claim[]> {
  const data = await gh.graphql<{
    repository: { discussions: { nodes: Array<{ url: string; body: string }> } };
  }>(
    "read",
    `query($o:String!,$n:String!,$c:ID!){ repository(owner:$o,name:$n){
        discussions(first:50, categoryId:$c, orderBy:{field:UPDATED_AT,direction:DESC}){ nodes{ url body } } } }`,
    { o: owner, n: name, c: categoryId },
  );
  const claims: Claim[] = [];
  for (const d of data.repository.discussions.nodes) {
    for (const m of d.body.matchAll(CLAIM_RE)) {
      claims.push({ prKey: m[1] as string, runId: m[2] as string, ts: m[3] as string, url: d.url });
    }
  }
  return claims;
}

export async function postDiscussion(
  gh: GitHubClient,
  owner: string,
  name: string,
  categoryId: string,
  title: string,
  body: string,
): Promise<{ number: number; url: string }> {
  const repoId = await repositoryId(gh, owner, name);
  const data = await gh.graphql<{ createDiscussion: { discussion: { number: number; url: string } } }>(
    "write",
    `mutation($r:ID!,$c:ID!,$t:String!,$b:String!){
       createDiscussion(input:{repositoryId:$r,categoryId:$c,title:$t,body:$b}){ discussion{ number url } } }`,
    { r: repoId, c: categoryId, t: title, b: body },
  );
  return data.createDiscussion.discussion;
}
