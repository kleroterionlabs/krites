// src/index.ts — programmatic API surface (mirrors what the CLI drives).
export { loadConfig } from "./config/load.js";
export type { Config } from "./config/schema.js";
export { resolveAuth } from "./config/auth.js";
export { createGitHubClient } from "@kleroterion/koine";
export { KRITES_LABELS } from "./github/labels.js";
export {
  listReviewablePRs,
  getLinkedTask,
  getPrDetail,
  getCiConclusion,
} from "./github/pulls.js";
export type { ReviewablePR, LinkedTask, CiConclusion } from "./github/pulls.js";
export { canMerge } from "./review/gate.js";
export type { MergeDecision, MergeDecisionInput } from "./review/gate.js";
export { resolveCapturedVerdict, reviewEvent } from "./review/verdict.js";
export type { Verdict, VerdictResult } from "./review/verdict.js";
export { reviewPR } from "./agents/reviewer.js";
export { hasActiveClaim, claimMarker, prClaimKey } from "./github/discussions.js";
