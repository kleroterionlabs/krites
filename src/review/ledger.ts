// src/review/ledger.ts — a durable audit trail for every review/merge decision. An autonomous merger
// MUST be forensically reconstructable: what SHA was reviewed, what the verdict was, what CI said, and
// what Krites did. The record lives in two durable places — a structured (koine-redacted) log line for
// CI, and a markdown summary posted as an immutable PR comment.
import type { Logger } from "@kleroterion/koine";
import type { MergeDecision } from "./gate.js";
import type { Verdict } from "./verdict.js";

export type LedgerAction =
  | "merged"
  | "merge-deferred" // gate passed but GitHub declined (branch protection / conflict / moved head)
  | "changes-requested"
  | "escalated"
  | "skipped";

export interface MergeLedgerEntry {
  runId: string;
  pr: number;
  reviewedSha: string;
  verdict: Verdict;
  verdictParsed: boolean;
  ciConclusion: string;
  mergeable: boolean | null;
  decision: MergeDecision;
  action: LedgerAction;
  mergeMethod: string;
  costUsd: number;
}

/** Record one decision (structured log + a markdown line to post as the PR audit comment). */
export function recordMergeDecision(log: Logger, e: MergeLedgerEntry): string {
  log.info(
    { event: "merge_decision", ...e, reason: e.decision.reason, allow: e.decision.allow },
    "merge decision",
  );
  const verdict = e.verdictParsed ? e.verdict : `${e.verdict} (unparsed)`;
  return [
    `🤖 Krites run \`${e.runId}\` reviewed \`${e.reviewedSha.slice(0, 7)}\`.`,
    `- verdict: **${verdict}** · CI: ${e.ciConclusion} · mergeable: ${String(e.mergeable)}`,
    `- decision: **${e.action}** — ${e.decision.reason}`,
    `- cost: $${e.costUsd.toFixed(4)}`,
  ].join("\n");
}
