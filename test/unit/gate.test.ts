import { describe, expect, it } from "vitest";
import { type MergeDecisionInput, canMerge } from "../../src/review/gate.js";

// A baseline input where EVERY gate passes — each test flips exactly one field to a denying value.
const SHA = "abc123";
const ok = (over: Partial<MergeDecisionInput> = {}): MergeDecisionInput => ({
  verdict: "approve",
  trustedAuthor: true,
  ciConclusion: "success",
  mergeable: true,
  reviewedHeadSha: SHA,
  currentHeadSha: SHA,
  halted: false,
  dryRun: false,
  mergesUsed: 0,
  maxMerges: 1,
  requireCI: true,
  branchProtected: true,
  ...over,
});

describe("canMerge", () => {
  it("allows when every gate passes", () => {
    expect(canMerge(ok())).toEqual({ allow: true, reason: "all merge gates pass" });
  });

  // Each row flips one field; ALL must deny. This is the security contract — default-deny everywhere.
  const denials: Array<[string, Partial<MergeDecisionInput>]> = [
    ["dry-run", { dryRun: true }],
    ["halted", { halted: true }],
    ["branch unprotected (no real gate)", { branchProtected: false }],
    ["cap reached", { mergesUsed: 1, maxMerges: 1 }],
    ["untrusted author", { trustedAuthor: false }],
    ["verdict request_changes", { verdict: "request_changes" }],
    ["verdict comment", { verdict: "comment" }],
    ["missing reviewed sha", { reviewedHeadSha: "" }],
    ["missing current sha", { currentHeadSha: "" }],
    ["sha moved (force-push)", { currentHeadSha: "def456" }],
    ["not mergeable (false)", { mergeable: false }],
    ["not mergeable (null/unknown)", { mergeable: null }],
    ["CI pending", { ciConclusion: "pending" }],
    ["CI failure", { ciConclusion: "failure" }],
    ["CI none", { ciConclusion: "none" }],
  ];
  for (const [name, over] of denials) {
    it(`denies: ${name}`, () => {
      expect(canMerge(ok(over)).allow).toBe(false);
    });
  }

  it("allows non-green CI ONLY when requireCI is off (GitHub branch protection still gates)", () => {
    expect(canMerge(ok({ ciConclusion: "pending", requireCI: false })).allow).toBe(true);
    expect(canMerge(ok({ ciConclusion: "failure", requireCI: false })).allow).toBe(true);
  });

  it("denies when the cap is already spent even with a higher max", () => {
    expect(canMerge(ok({ mergesUsed: 3, maxMerges: 3 })).allow).toBe(false);
    expect(canMerge(ok({ mergesUsed: 2, maxMerges: 3 })).allow).toBe(true);
  });
});
