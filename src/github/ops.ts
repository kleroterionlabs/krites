// src/github/ops.ts — the shared kill-switch. Like Boule and Praktor, Krites halts the moment any OPEN
// issue carries `boule:halt`. An auto-merger must re-check this LIVE right before enabling a merge, not
// just at start, so a human hitting the switch mid-run is honoured within one PR.
import { type GitHubClient, OPERATIONAL_LABELS } from "@kleroterion/koine";

/** True if any OPEN issue carries `boule:halt`. */
export async function isHalted(gh: GitHubClient, owner: string, name: string): Promise<boolean> {
  const res = await gh.withRest("read", (o) =>
    o.issues.listForRepo({ owner, repo: name, labels: OPERATIONAL_LABELS.halt, state: "open", per_page: 1 }),
  );
  return res.data.length > 0;
}
