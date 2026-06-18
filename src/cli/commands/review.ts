// src/cli/commands/review.ts — the core loop for ONE PR: claim it (cooperative lock via Discussions),
// drive the read-only critic, post a GitHub review, and — only if the deterministic canMerge gate allows
// — enable gated auto-merge. Every irreversible step is guarded: trusted-author, SHA-pin (the reviewed
// SHA must still be the head), a LIVE boule:halt re-poll, requireCI, the per-run cap, and --dry-run.
import { execFileSync } from "node:child_process";
import type { Command } from "commander";
import { ulid } from "ulid";
import { reviewPR } from "../../agents/reviewer.js";
import {
  claimMarker,
  findCategoryId,
  hasActiveClaim,
  listClaims,
  postDiscussion,
  prClaimKey,
} from "../../github/discussions.js";
import { KRITES_LABELS } from "../../github/labels.js";
import { isHalted } from "../../github/ops.js";
import { addLabels, comment, escalateToHuman, removeLabel } from "../../github/progress.js";
import {
  type ReviewablePR,
  getCiConclusion,
  getLinkedTask,
  getPrDetail,
  getPrDiff,
  getRequirements,
  listReviewablePRs,
} from "../../github/pulls.js";
import { enableAutoMerge, postReview } from "../../github/review.js";
import { canMerge } from "../../review/gate.js";
import { type LedgerAction, recordMergeDecision } from "../../review/ledger.js";
import { type VerdictResult, reviewEvent } from "../../review/verdict.js";
import { type Ctx, context, globals } from "./_shared.js";

/** Match a CLI target ("12" or "#12") against the reviewable list; default to the first. */
function pickTarget(prs: ReviewablePR[], target?: string): ReviewablePR | undefined {
  if (!target) return prs[0];
  const num = Number(target.replace(/^#/, ""));
  return Number.isInteger(num) ? prs.find((p) => p.number === num) : undefined;
}

/** Best-effort: check out the PR head so the critic reviews the proposed tree. Returns the SHA reviewed. */
function checkoutPrHead(prNumber: number, fallbackSha: string, log: Ctx["log"]): string {
  try {
    execFileSync("git", ["fetch", "--depth=1", "origin", `pull/${prNumber}/head`], { stdio: "ignore" });
    execFileSync("git", ["checkout", "--quiet", "FETCH_HEAD"], { stdio: "ignore" });
    return execFileSync("git", ["rev-parse", "HEAD"]).toString().trim() || fallbackSha;
  } catch (e) {
    log.warn(
      { err: e instanceof Error ? e.message : String(e) },
      "could not checkout PR head; using diff only",
    );
    return fallbackSha;
  }
}

/** Escalate a PR to a human: flag it, stop touching it, and post to the escalation category. */
async function escalate(ctx: Ctx, pr: ReviewablePR, cat: string | null, reason: string): Promise<void> {
  await escalateToHuman(ctx.gh, ctx.owner, ctx.name, pr.number);
  await removeLabel(ctx.gh, ctx.owner, ctx.name, pr.number, KRITES_LABELS.reviewing);
  const escCat = await findCategoryId(ctx.gh, ctx.owner, ctx.name, ctx.cfg.coordination.escalationCategory);
  if (escCat) {
    await postDiscussion(
      ctx.gh,
      ctx.owner,
      ctx.name,
      escCat,
      `Krites escalation: PR #${pr.number}`,
      `🛑 Krites is handing PR #${pr.number} to a human and will not touch it again.\n\nReason: ${reason}\n\n${pr.url}`,
    );
  }
}

function reviewBody(v: VerdictResult, costUsd: number, runId: string): string {
  const note = v.parsed
    ? ""
    : "\n\n> ⚠️ The reviewer did not return a single clear verdict — defaulting to no approval.";
  return `${v.summary || "(no summary provided)"}${note}\n\n— 🤖 Krites \`${runId}\` · $${costUsd.toFixed(4)}`;
}

export function registerReview(program: Command): void {
  program
    .command("review [pr]")
    .description("Review a PR (by #number; default: the first reviewable) and enable gated auto-merge.")
    .action(async (target: string | undefined, _local: unknown, cmd: Command) => {
      const runId = ulid();
      const ctx = await context(globals(cmd), runId);
      const dryRun = Boolean(ctx.cfg.flags.dryRun ?? globals(cmd).dryRun);
      const emit = (text: string, exit?: number) => {
        process.stdout.write(`${text}\n`);
        if (exit) process.exitCode = exit;
      };

      if (await isHalted(ctx.gh, ctx.owner, ctx.name)) {
        return emit("boule:halt is active — refusing to review or merge.", 1);
      }

      const prs = await listReviewablePRs(ctx.gh, ctx.owner, ctx.name, ctx.cfg.review.trustedAuthor);
      const pr = pickTarget(prs, target);
      if (!pr)
        return emit(target ? `No reviewable PR matches "${target}".` : "No reviewable PRs.", target ? 2 : 0);

      const cat = await findCategoryId(ctx.gh, ctx.owner, ctx.name, ctx.cfg.coordination.category);
      if (!cat) return emit(`coordination category "${ctx.cfg.coordination.category}" not found.`, 2);

      // The PR must close a Boule-managed Task — verified server-side, never via a user-settable label.
      if (!pr.taskNumber) {
        if (!dryRun) await escalate(ctx, pr, cat, "PR does not link a Boule Task (no 'Closes #N').");
        return emit(`#${pr.number} links no Boule Task — escalated.`, 1);
      }
      const task = await getLinkedTask(ctx.gh, ctx.owner, ctx.name, pr.taskNumber);
      if (!task.managed || !task.isTask) {
        if (!dryRun)
          await escalate(ctx, pr, cat, `linked #${pr.taskNumber} is not a boule:managed kind:task.`);
        return emit(`#${pr.number}'s linked issue is not a managed Task — escalated.`, 1);
      }

      // Cooperative lock keyed by PR + head SHA: a force-push under the claim invalidates it.
      const claimKey = prClaimKey(pr.number, pr.headSha);
      const claims = await listClaims(ctx.gh, ctx.owner, ctx.name, cat);
      if (hasActiveClaim(claimKey, runId, claims, Date.now(), ctx.cfg.coordination.claimTtlMinutes)) {
        return emit(`PR ${claimKey} is already claimed by another run — skipping.`, 0);
      }

      emit(`Reviewing #${pr.number} ${pr.title}${dryRun ? " [dry-run]" : ""}`);

      if (!dryRun) {
        const ts = new Date().toISOString();
        await postDiscussion(
          ctx.gh,
          ctx.owner,
          ctx.name,
          cat,
          `Krites claim: #${pr.number} ${pr.title}`,
          `🤖 Krites run \`${runId}\` is reviewing #${pr.number}.\n\n${claimMarker(claimKey, runId, ts)}`,
        );
        await addLabels(ctx.gh, ctx.owner, ctx.name, pr.number, [KRITES_LABELS.reviewing]);
        const after = await listClaims(ctx.gh, ctx.owner, ctx.name, cat);
        if (hasActiveClaim(claimKey, runId, after, Date.now(), ctx.cfg.coordination.claimTtlMinutes)) {
          return emit(`Lost the claim race for ${claimKey} — yielding.`, 0);
        }
      }

      // Gather the review context. The CI conclusion is read for the reviewed head SHA.
      const requirements = await getRequirements(ctx.gh, ctx.owner, ctx.name, task.verifies);
      const diff = await getPrDiff(ctx.gh, ctx.owner, ctx.name, pr.number);
      const ciConclusion = await getCiConclusion(ctx.gh, ctx.owner, ctx.name, pr.headSha);
      const reviewedSha = dryRun ? pr.headSha : checkoutPrHead(pr.number, pr.headSha, ctx.log);
      const before = await getPrDetail(ctx.gh, ctx.owner, ctx.name, pr.number);

      const { outcome, result } = await reviewPR({
        cfg: ctx.cfg,
        pr,
        task,
        requirements,
        diff,
        ciConclusion,
        mergeable: before.mergeable,
        log: ctx.log,
      });

      if (!dryRun) {
        const posted = await postReview(
          ctx.gh,
          ctx.owner,
          ctx.name,
          pr.number,
          reviewEvent(result.verdict),
          reviewBody(result, outcome.costUsd, runId),
        );
        if (posted.secrets.length || posted.mentions.length) {
          ctx.log.warn({ secrets: posted.secrets, mentions: posted.mentions }, "sanitized review body");
        }
      }

      // Decide the merge against LIVE state: re-fetch the head + mergeable, and re-poll halt.
      const now = await getPrDetail(ctx.gh, ctx.owner, ctx.name, pr.number);
      const halted = await isHalted(ctx.gh, ctx.owner, ctx.name);
      const decision = canMerge({
        verdict: result.verdict,
        trustedAuthor: pr.author === ctx.cfg.review.trustedAuthor,
        ciConclusion,
        mergeable: now.mergeable,
        reviewedHeadSha: reviewedSha,
        currentHeadSha: now.headSha,
        halted,
        dryRun,
        mergesUsed: 0,
        maxMerges: ctx.cfg.review.maxMerges,
        requireCI: ctx.cfg.review.requireCI,
      });

      let action: LedgerAction = "skipped";
      if (decision.allow) {
        await enableAutoMerge(ctx.gh, now.nodeId, ctx.cfg.review.mergeMethod);
        await addLabels(ctx.gh, ctx.owner, ctx.name, pr.number, [KRITES_LABELS.approved]);
        await removeLabel(ctx.gh, ctx.owner, ctx.name, pr.number, KRITES_LABELS.reviewing);
        action = "auto-merge-enabled";
      } else if (!result.parsed) {
        if (!dryRun)
          await escalate(ctx, pr, cat, "reviewer returned no clear verdict (possible prompt injection).");
        action = "escalated";
      } else if (result.verdict === "request_changes") {
        if (!dryRun) {
          await addLabels(ctx.gh, ctx.owner, ctx.name, pr.number, [KRITES_LABELS.changesRequested]);
          await removeLabel(ctx.gh, ctx.owner, ctx.name, pr.number, KRITES_LABELS.reviewing);
        }
        action = "changes-requested";
      } else if (!dryRun) {
        await removeLabel(ctx.gh, ctx.owner, ctx.name, pr.number, KRITES_LABELS.reviewing);
      }

      const audit = recordMergeDecision(ctx.log, {
        runId,
        pr: pr.number,
        reviewedSha,
        verdict: result.verdict,
        verdictParsed: result.parsed,
        ciConclusion,
        mergeable: now.mergeable,
        decision,
        action,
        mergeMethod: ctx.cfg.review.mergeMethod,
        costUsd: outcome.costUsd,
      });
      if (!dryRun) await comment(ctx.gh, ctx.owner, ctx.name, pr.number, audit);

      emit(
        `${decision.allow ? "✓ auto-merge enabled" : `· ${action}`} — ${decision.reason} · $${outcome.costUsd.toFixed(4)} · ${outcome.numTurns} turns`,
        outcome.stopReason === "error_max_budget_usd" ? 4 : undefined,
      );
    });
}
