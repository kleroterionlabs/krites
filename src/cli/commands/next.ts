// src/cli/commands/next.ts — show the PRs that are READY for Krites to review (read-only).
import type { Command } from "commander";
import { ulid } from "ulid";
import { listReviewablePRs } from "../../github/pulls.js";
import { context, globals } from "./_shared.js";

export function registerNext(program: Command): void {
  program
    .command("next")
    .description("List PRs ready to review (trusted author, link a Boule Task, not draft/approved).")
    .action(async (_local: unknown, cmd: Command) => {
      const ctx = await context(globals(cmd), ulid());
      const prs = await listReviewablePRs(ctx.gh, ctx.owner, ctx.name, ctx.cfg.review.trustedAuthor);

      if (ctx.json) {
        process.stdout.write(`${JSON.stringify({ reviewable: prs })}\n`);
        return;
      }
      if (prs.length === 0) {
        process.stdout.write("No reviewable PRs. (None open from the trusted author linking a Task.)\n");
        return;
      }
      const lines = [`${prs.length} reviewable PR(s):`];
      for (const p of prs) {
        const task = p.taskNumber ? ` closes #${p.taskNumber}` : " (no linked task!)";
        lines.push(`  #${p.number}  ${p.title}${task}`);
      }
      lines.push("\nReview the first: krites review");
      process.stdout.write(`${lines.join("\n")}\n`);
    });
}
