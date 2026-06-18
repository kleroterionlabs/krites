// src/review/verdict.ts — the verdict vocabulary and its default-deny resolution. The reviewer delivers
// its verdict ONLY through a structured, zod-validated `submit_verdict` MCP tool call — never free text —
// so a prompt injection in the PR diff cannot fabricate a verdict by writing words. This pure resolver
// turns the captured tool call(s) into a single verdict, defaulting to the safe "comment" unless EXACTLY
// one valid verdict was submitted. Unit-tested.
export type Verdict = "approve" | "request_changes" | "comment";

export interface CapturedVerdict {
  verdict: Verdict;
  summary: string;
}

export interface VerdictResult {
  verdict: Verdict;
  parsed: boolean; // false => the reviewer did not submit exactly one verdict => default-deny + escalate
  summary: string;
}

/** Collapse the verdict(s) the reviewer submitted into one. Default-deny unless exactly one was given. */
export function resolveCapturedVerdict(captured: CapturedVerdict[]): VerdictResult {
  if (captured.length !== 1) {
    return {
      verdict: "comment",
      parsed: false,
      summary: captured.map((c) => c.summary).join("\n\n"),
    };
  }
  const only = captured[0] as CapturedVerdict;
  return { verdict: only.verdict, parsed: true, summary: only.summary };
}

/** Map a verdict to the GitHub review event. */
export function reviewEvent(v: Verdict): "APPROVE" | "REQUEST_CHANGES" | "COMMENT" {
  if (v === "approve") return "APPROVE";
  if (v === "request_changes") return "REQUEST_CHANGES";
  return "COMMENT";
}
