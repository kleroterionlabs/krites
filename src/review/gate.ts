// src/review/gate.ts — the deterministic merge authority. The LLM reviewer is ADVISORY; this pure,
// default-deny predicate is what actually decides whether Krites enables auto-merge. Every branch denies
// unless ALL conditions hold, so an unparseable verdict, a moved SHA, a halt, a dry-run, a non-green CI,
// an untrusted author, or a hit cap can never result in a merge. Exhaustively unit-tested.
import type { CiConclusion } from "../github/pulls.js";
import type { Verdict } from "./verdict.js";

export interface MergeDecisionInput {
  verdict: Verdict; // the parsed reviewer verdict (default-deny on parse failure)
  trustedAuthor: boolean; // PR authored by the trusted Praktor bot login
  ciConclusion: CiConclusion; // collapsed CI state for the reviewed head
  mergeable: boolean | null; // GitHub mergeable flag (null = unknown)
  reviewedHeadSha: string; // SHA the reviewer actually examined
  currentHeadSha: string; // SHA right now (re-fetched before deciding)
  halted: boolean; // live boule:halt re-poll
  dryRun: boolean;
  mergesUsed: number; // auto-merges already enabled this run
  maxMerges: number; // blast-radius cap
  requireCI: boolean; // refuse non-green CI when true
}

export interface MergeDecision {
  allow: boolean;
  reason: string;
}

const deny = (reason: string): MergeDecision => ({ allow: false, reason });

/**
 * Allow enabling auto-merge ONLY when every gate passes. Order is chosen so the most important refusals
 * (kill-switch, dry-run, trust, explicit verdict) report first. Default-deny: any unhandled state denies.
 */
export function canMerge(i: MergeDecisionInput): MergeDecision {
  if (i.dryRun) return deny("dry-run: merge disabled");
  if (i.halted) return deny("boule:halt is active");
  if (i.mergesUsed >= i.maxMerges) return deny(`merge cap reached (${i.maxMerges})`);
  if (!i.trustedAuthor) return deny("PR author is not the trusted Praktor identity");
  if (i.verdict !== "approve") return deny(`reviewer verdict is "${i.verdict}", not "approve"`);
  if (!i.reviewedHeadSha || !i.currentHeadSha) return deny("missing head SHA");
  if (i.reviewedHeadSha !== i.currentHeadSha)
    return deny("head SHA moved since review (possible force-push)");
  if (i.mergeable !== true) return deny("PR is not mergeable");
  if (i.requireCI && i.ciConclusion !== "success") return deny(`CI not green (${i.ciConclusion})`);
  return { allow: true, reason: "all merge gates pass" };
}
