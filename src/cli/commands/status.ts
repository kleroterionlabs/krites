// src/cli/commands/status.ts — read-only snapshot: reviewable vs approved vs changes-requested PRs,
// plus active Krites claims in the coordination category.
import type { Command } from "commander";
import { ulid } from "ulid";
import { findCategoryId, listClaims } from "../../github/discussions.js";
import { KRITES_LABELS } from "../../github/labels.js";
import { listReviewablePRs } from "../../github/pulls.js";
import { context, globals } from "./_shared.js";

const labelNames = (labels: unknown[]): string[] =>
  labels.map((l) => (typeof l === "string" ? l : ((l as { name?: string }).name ?? ""))).filter(Boolean);

export function registerStatus(program: Command): void {
  program
    .command("status")
    .description("Snapshot of PRs: reviewable, approved, changes-requested, and active Krites claims.")
    .action(async (_local: unknown, cmd: Command) => {
      const ctx = await context(globals(cmd), ulid());

      const [reviewable, openPrs] = await Promise.all([
        listReviewablePRs(ctx.gh, ctx.owner, ctx.name, ctx.cfg.review.trustedAuthor),
        ctx.gh.withRest("read", (o) =>
          o.pulls.list({ owner: ctx.owner, repo: ctx.name, state: "open", per_page: 100 }),
        ),
      ]);
      const approved = openPrs.data.filter((p) =>
        labelNames(p.labels ?? []).includes(KRITES_LABELS.approved),
      ).length;
      const changesRequested = openPrs.data.filter((p) =>
        labelNames(p.labels ?? []).includes(KRITES_LABELS.changesRequested),
      ).length;

      const cat = await findCategoryId(ctx.gh, ctx.owner, ctx.name, ctx.cfg.coordination.category);
      const claims = cat ? await listClaims(ctx.gh, ctx.owner, ctx.name, cat) : [];

      const snapshot = {
        reviewable: reviewable.length,
        approved,
        changesRequested,
        activeClaims: claims.length,
      };

      if (ctx.json) {
        process.stdout.write(`${JSON.stringify(snapshot)}\n`);
        return;
      }
      const lines = [
        `PRs: ${snapshot.reviewable} reviewable · ${snapshot.approved} approved · ${snapshot.changesRequested} changes-requested`,
        `Claims in "${ctx.cfg.coordination.category}": ${snapshot.activeClaims}`,
      ];
      process.stdout.write(`${lines.join("\n")}\n`);
    });
}
