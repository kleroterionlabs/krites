// src/github/progress.ts — Krites's marks on a PR (and its linked Task). Krites signals state with its
// OWN `krites:*` labels + audit comments, and escalates with Boule's shared `boule:needs-human`. It
// never touches Boule's `status:*` lifecycle or Praktor's `praktor:*` labels. PRs are issues under the
// hood, so the issues API drives labels/comments for both.
import { type GitHubClient, OPERATIONAL_LABELS } from "@kleroterion/koine";

export async function addLabels(
  gh: GitHubClient,
  owner: string,
  name: string,
  number: number,
  labels: string[],
): Promise<void> {
  await gh.withRest("write", (o) => o.issues.addLabels({ owner, repo: name, issue_number: number, labels }));
}

export async function removeLabel(
  gh: GitHubClient,
  owner: string,
  name: string,
  number: number,
  label: string,
): Promise<void> {
  try {
    await gh.withRest("write", (o) =>
      o.issues.removeLabel({ owner, repo: name, issue_number: number, name: label }),
    );
  } catch {
    // label not present — fine
  }
}

export async function comment(
  gh: GitHubClient,
  owner: string,
  name: string,
  number: number,
  body: string,
): Promise<void> {
  await gh.withRest("write", (o) =>
    o.issues.createComment({ owner, repo: name, issue_number: number, body }),
  );
}

/** Flag a PR for human attention (shared Boule operational label) and remove transient krites state. */
export const escalateToHuman = (gh: GitHubClient, owner: string, name: string, n: number) =>
  addLabels(gh, owner, name, n, [OPERATIONAL_LABELS.needsHuman]);
