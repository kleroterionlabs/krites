// src/github/pulls.ts — read the PR backlog and the context a review needs. A PR is REVIEWABLE iff it
// is open, NOT a draft, authored by the TRUSTED bot login (verified here, never via a user-settable
// label), and links a Boule Task via a "Closes #N" reference. The strict managed/kind:task check happens
// at review time in getLinkedTask. Nothing here mutates GitHub.
import {
  type GitHubClient,
  OPERATIONAL_LABELS,
  kindLabel,
  parseBouleBlock,
  parseVerifies,
} from "@kleroterion/koine";
import { KRITES_LABELS } from "./labels.js";

const TASK_LABEL = kindLabel("task");
const MANAGED_LABEL = OPERATIONAL_LABELS.managed;
// "Closes #12", "fixes #12", "resolved #12" — GitHub's PR→issue linking keywords.
const CLOSES_RE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/i;

export type CiConclusion = "success" | "pending" | "failure" | "none";

export interface ReviewablePR {
  number: number;
  nodeId: string;
  title: string;
  body: string;
  headSha: string;
  headRef: string;
  baseRef: string;
  author: string;
  url: string;
  taskNumber: number | null;
  labels: string[];
}

export interface PrDetail {
  headSha: string;
  nodeId: string;
  mergeable: boolean | null; // GitHub computes this asynchronously; null = not yet known
}

export interface LinkedTask {
  number: number;
  title: string;
  body: string;
  bouleId: string | null;
  verifies: number[]; // requirement issue numbers this task Verifies
  managed: boolean; // carries boule:managed
  isTask: boolean; // carries kind:task
}

const labelNames = (labels: unknown[]): string[] =>
  labels.map((l) => (typeof l === "string" ? l : ((l as { name?: string }).name ?? ""))).filter(Boolean);

/** First Boule Task number a PR closes, or null. */
export function linkedTaskNumber(body: string): number | null {
  const m = CLOSES_RE.exec(body);
  return m ? Number(m[1]) : null;
}

/** Open, non-draft PRs by the trusted author that link a Task and Krites hasn't already approved. */
export async function listReviewablePRs(
  gh: GitHubClient,
  owner: string,
  name: string,
  trustedAuthor: string,
): Promise<ReviewablePR[]> {
  const res = await gh.withRest("read", (o) =>
    o.pulls.list({ owner, repo: name, state: "open", per_page: 100 }),
  );
  const out: ReviewablePR[] = [];
  for (const p of res.data) {
    if (p.draft) continue;
    if ((p.user?.login ?? "") !== trustedAuthor) continue; // trusted-author only
    const labels = labelNames(p.labels ?? []);
    if (labels.includes(KRITES_LABELS.approved)) continue; // already approved / merge-enabled
    out.push({
      number: p.number,
      nodeId: p.node_id,
      title: p.title,
      body: p.body ?? "",
      headSha: p.head.sha,
      headRef: p.head.ref,
      baseRef: p.base.ref,
      author: p.user?.login ?? "",
      url: p.html_url,
      taskNumber: linkedTaskNumber(p.body ?? ""),
      labels,
    });
  }
  return out.sort((a, b) => a.number - b.number);
}

/** Fetch the unified diff for a PR (size-capped so a giant PR can't blow the review context budget). */
export async function getPrDiff(
  gh: GitHubClient,
  owner: string,
  name: string,
  number: number,
  maxBytes = 200_000,
): Promise<string> {
  const r = await gh.withRest("read", (o) =>
    o.pulls.get({ owner, repo: name, pull_number: number, mediaType: { format: "diff" } }),
  );
  // With the diff media type Octokit returns the raw diff string as `data`.
  const diff = r.data as unknown as string;
  return diff.length > maxBytes
    ? `${diff.slice(0, maxBytes)}\n\n…[diff truncated at ${maxBytes} bytes — review the checked-out tree for the rest]`
    : diff;
}

/** Re-fetch the live head SHA, node id, and mergeable flag — call this right before deciding to merge. */
export async function getPrDetail(
  gh: GitHubClient,
  owner: string,
  name: string,
  number: number,
): Promise<PrDetail> {
  const r = await gh.withRest("read", (o) => o.pulls.get({ owner, repo: name, pull_number: number }));
  return { headSha: r.data.head.sha, nodeId: r.data.node_id, mergeable: r.data.mergeable };
}

/** Fetch the linked Task issue and its Boule provenance/labels (traceability for the reviewer). */
export async function getLinkedTask(
  gh: GitHubClient,
  owner: string,
  name: string,
  taskNumber: number,
): Promise<LinkedTask> {
  const r = await gh.withRest("read", (o) => o.issues.get({ owner, repo: name, issue_number: taskNumber }));
  const body = r.data.body ?? "";
  const labels = labelNames(r.data.labels ?? []);
  return {
    number: taskNumber,
    title: r.data.title,
    body,
    bouleId: parseBouleBlock(body)?.bouleId ?? null,
    verifies: parseVerifies(body),
    managed: labels.includes(MANAGED_LABEL),
    isTask: labels.includes(TASK_LABEL),
  };
}

/** Fetch the requirement issue bodies a Task Verifies (best-effort; skips unreadable ones). */
export async function getRequirements(
  gh: GitHubClient,
  owner: string,
  name: string,
  numbers: number[],
): Promise<{ number: number; title: string; body: string }[]> {
  const out: { number: number; title: string; body: string }[] = [];
  for (const n of numbers) {
    try {
      const r = await gh.withRest("read", (o) => o.issues.get({ owner, repo: name, issue_number: n }));
      out.push({ number: n, title: r.data.title, body: r.data.body ?? "" });
    } catch {
      // requirement unreadable — skip; the reviewer still has the task's own criteria
    }
  }
  return out;
}

/** Collapse all check-runs + commit statuses for a ref into one conclusion (pessimistic on unknowns). */
export async function getCiConclusion(
  gh: GitHubClient,
  owner: string,
  name: string,
  ref: string,
): Promise<CiConclusion> {
  const [checks, status] = await Promise.all([
    gh.withRest("read", (o) => o.checks.listForRef({ owner, repo: name, ref, per_page: 100 })),
    gh.withRest("read", (o) => o.repos.getCombinedStatusForRef({ owner, repo: name, ref })),
  ]);
  const runs = checks.data.check_runs;
  const statuses = status.data.statuses;
  if (runs.length === 0 && statuses.length === 0) return "none";

  const bad = new Set(["failure", "timed_out", "cancelled", "action_required", "startup_failure", "stale"]);
  for (const r of runs) {
    if (r.status !== "completed") return "pending";
    if (r.conclusion && bad.has(r.conclusion)) return "failure";
  }
  if (statuses.some((s) => s.state === "failure" || s.state === "error")) return "failure";
  if (statuses.some((s) => s.state === "pending")) return "pending";
  return "success";
}
