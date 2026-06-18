// src/github/review.ts — the two GitHub writes a review produces: post a PR review, and (only when the
// deterministic gate allows) ENABLE auto-merge. Krites never calls the merge API directly: it enables
// GitHub's native auto-merge, so GitHub performs the merge only once branch-protection's required checks
// and reviews pass. Every agent-authored string is run through koine cleanOutbound first.
import { type GitHubClient, cleanOutbound } from "@kleroterion/koine";

export type ReviewEvent = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

export interface PostedReview {
  secrets: string[]; // redacted credential kinds, for audit logging
  mentions: string[]; // stripped @-mentions, for audit logging
}

/** Post a PR review with a sanitized body. Returns what cleanOutbound scrubbed, for the audit log. */
export async function postReview(
  gh: GitHubClient,
  owner: string,
  name: string,
  prNumber: number,
  event: ReviewEvent,
  body: string,
): Promise<PostedReview> {
  const safe = cleanOutbound(body);
  await gh.withRest("write", (o) =>
    o.pulls.createReview({ owner, repo: name, pull_number: prNumber, event, body: safe.clean }),
  );
  return { secrets: safe.secrets, mentions: safe.mentions };
}

const MERGE_METHOD_ENUM = { squash: "SQUASH", merge: "MERGE", rebase: "REBASE" } as const;
export type MergeMethod = keyof typeof MERGE_METHOD_ENUM;

/** Enable GitHub native auto-merge. GitHub still gates the actual merge on branch protection. */
export async function enableAutoMerge(
  gh: GitHubClient,
  prNodeId: string,
  mergeMethod: MergeMethod,
): Promise<void> {
  await gh.graphql(
    "write",
    `mutation($id:ID!,$m:PullRequestMergeMethod!){
       enablePullRequestAutoMerge(input:{pullRequestId:$id, mergeMethod:$m}){ clientMutationId } }`,
    { id: prNodeId, m: MERGE_METHOD_ENUM[mergeMethod] },
  );
}
