import type { GitHubClient } from "@kleroterion/koine";
import { describe, expect, it } from "vitest";
import { linkedTaskNumber, listReviewablePRs } from "../../src/github/pulls.js";

describe("linkedTaskNumber", () => {
  it("extracts the first closing reference (Closes/Fixes/Resolves)", () => {
    expect(linkedTaskNumber("Closes #31\nVerifies #6")).toBe(31);
    expect(linkedTaskNumber("fixes #7")).toBe(7);
    expect(linkedTaskNumber("This resolves #420 nicely")).toBe(420);
  });
  it("returns null when there is no closing reference", () => {
    expect(linkedTaskNumber("Verifies #6 only")).toBeNull();
    expect(linkedTaskNumber("")).toBeNull();
  });
});

interface PrStub {
  number: number;
  user: string;
  draft?: boolean;
  labels?: string[];
  body?: string;
}

function fakeGh(prs: PrStub[]): GitHubClient {
  const octokit = {
    pulls: {
      list: async () => ({
        data: prs.map((p) => ({
          number: p.number,
          node_id: `n${p.number}`,
          title: `PR ${p.number}`,
          body: p.body ?? "Closes #1",
          draft: p.draft ?? false,
          head: { sha: `sha${p.number}`, ref: "feature" },
          base: { ref: "main" },
          user: { login: p.user },
          html_url: `https://x/${p.number}`,
          labels: (p.labels ?? []).map((name) => ({ name })),
        })),
      }),
    },
  };
  return {
    withRest: (_lane: string, fn: (o: typeof octokit) => unknown) => fn(octokit),
  } as unknown as GitHubClient;
}

const TRUSTED = "praktorai[bot]";

describe("listReviewablePRs", () => {
  it("keeps only trusted-author, non-draft, not-yet-approved PRs", async () => {
    const gh = fakeGh([
      { number: 1, user: TRUSTED }, // ok
      { number: 2, user: "mallory" }, // untrusted author — dropped (self-approval defense)
      { number: 3, user: TRUSTED, draft: true }, // draft — dropped
      { number: 4, user: TRUSTED, labels: ["krites:approved"] }, // already approved — dropped
    ]);
    const out = await listReviewablePRs(gh, "o", "r", TRUSTED);
    expect(out.map((p) => p.number)).toEqual([1]);
  });

  it("surfaces the linked task number from the PR body", async () => {
    const gh = fakeGh([{ number: 9, user: TRUSTED, body: "Closes #42" }]);
    const [pr] = await listReviewablePRs(gh, "o", "r", TRUSTED);
    expect(pr?.taskNumber).toBe(42);
  });
});
