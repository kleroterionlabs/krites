// src/github/review.ts — the two GitHub writes a review produces: post a PR review, and (only when the
// deterministic gate allows) MERGE. Krites merges via REST PINNED to the reviewed SHA, and is granted no
// Administration scope — so GitHub branch protection still enforces required checks/reviews server-side
// and rejects the merge if they are not met. Krites is the second layer; branch protection is the gate.
// Every agent-authored string is run through koine cleanOutbound first.
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

export type MergeMethod = "squash" | "merge" | "rebase";

export interface MergeOutcome {
  merged: boolean;
  reason?: string; // present when GitHub refused (branch protection, conflict, or moved head)
}

/**
 * Merge a PR via REST, PINNED to the reviewed SHA so GitHub refuses if the branch moved. A 405/409/422
 * means GitHub declined — required checks/reviews not satisfied, a conflict, or the head changed — which
 * is a non-fatal "not now" (returned as merged:false), NOT a crash. Branch protection does the gating;
 * Krites has no admin bypass, so a 405 here is the human-review/required-check backstop doing its job.
 */
export async function mergePullRequest(
  gh: GitHubClient,
  owner: string,
  name: string,
  prNumber: number,
  sha: string,
  mergeMethod: MergeMethod,
): Promise<MergeOutcome> {
  try {
    await gh.withRest("write", (o) =>
      o.pulls.merge({ owner, repo: name, pull_number: prNumber, sha, merge_method: mergeMethod }),
    );
    return { merged: true };
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 405 || status === 409 || status === 422) {
      return { merged: false, reason: (e as { message?: string }).message ?? `HTTP ${status}` };
    }
    throw e;
  }
}
