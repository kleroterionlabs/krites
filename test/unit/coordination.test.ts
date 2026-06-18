import { describe, expect, it } from "vitest";
import { type Claim, claimMarker, hasActiveClaim, prClaimKey } from "../../src/github/discussions.js";

const NOW = Date.parse("2026-06-18T12:00:00Z");
const claim = (prKey: string, runId: string, minutesAgo: number): Claim => ({
  prKey,
  runId,
  ts: new Date(NOW - minutesAgo * 60_000).toISOString(),
  url: "u",
});

describe("prClaimKey", () => {
  it("binds the claim to a PR AND its head SHA (a force-push changes the key)", () => {
    expect(prClaimKey(12, "abc123")).toBe("#12@abc123");
    expect(prClaimKey(12, "abc123")).not.toBe(prClaimKey(12, "def456"));
  });
});

describe("hasActiveClaim", () => {
  it("is true when a different run holds a fresh claim for the same PR-key", () => {
    expect(hasActiveClaim("#12@abc", "me", [claim("#12@abc", "other", 10)], NOW, 60)).toBe(true);
  });

  it("ignores my own claim (re-running the same PR is fine)", () => {
    expect(hasActiveClaim("#12@abc", "me", [claim("#12@abc", "me", 10)], NOW, 60)).toBe(false);
  });

  it("ignores stale claims past the TTL", () => {
    expect(hasActiveClaim("#12@abc", "me", [claim("#12@abc", "other", 90)], NOW, 60)).toBe(false);
  });

  it("ignores a claim for the SAME pr at a DIFFERENT head SHA (force-pushed)", () => {
    expect(hasActiveClaim("#12@def", "me", [claim("#12@abc", "other", 5)], NOW, 60)).toBe(false);
  });
});

describe("claimMarker", () => {
  it("round-trips through the claim parser regex", () => {
    const marker = claimMarker("#12@abc", "run123", "2026-06-18T12:00:00Z");
    expect(marker).toBe("<!-- krites:claim pr=#12@abc run=run123 ts=2026-06-18T12:00:00Z -->");
  });
});
