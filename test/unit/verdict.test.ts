import { describe, expect, it } from "vitest";
import { type CapturedVerdict, resolveCapturedVerdict, reviewEvent } from "../../src/review/verdict.js";

const cap = (verdict: CapturedVerdict["verdict"], summary = "s"): CapturedVerdict => ({ verdict, summary });

describe("resolveCapturedVerdict", () => {
  it("resolves the single submitted verdict", () => {
    expect(resolveCapturedVerdict([cap("approve", "looks good")])).toEqual({
      verdict: "approve",
      parsed: true,
      summary: "looks good",
    });
  });

  it("default-denies when NO verdict was submitted (model never called the tool)", () => {
    const r = resolveCapturedVerdict([]);
    expect(r.verdict).toBe("comment");
    expect(r.parsed).toBe(false);
  });

  it("default-denies when MULTIPLE verdicts were submitted (ambiguous)", () => {
    const r = resolveCapturedVerdict([cap("approve"), cap("request_changes")]);
    expect(r.verdict).toBe("comment");
    expect(r.parsed).toBe(false);
  });

  it("passes through request_changes and comment verdicts", () => {
    expect(resolveCapturedVerdict([cap("request_changes")]).verdict).toBe("request_changes");
    expect(resolveCapturedVerdict([cap("comment")]).verdict).toBe("comment");
  });
});

describe("reviewEvent", () => {
  it("maps verdicts to GitHub review events", () => {
    expect(reviewEvent("approve")).toBe("APPROVE");
    expect(reviewEvent("request_changes")).toBe("REQUEST_CHANGES");
    expect(reviewEvent("comment")).toBe("COMMENT");
  });
});
