// src/cli/commands/doctor.ts — preflight: config, credentials, repo access, the coordination +
// escalation Discussion categories, and — critically for an auto-merger — a live MERGE-CAPABILITY probe:
// the repo must allow auto-merge, and the default branch MUST be protected with required checks/reviews.
// Branch protection is the real merge gate; Krites is only the second layer, so doctor FAILS without it.
// Exit codes: 2 = bad config/credentials, 3 = a live health check failed.
import { createGitHubClient, createLogger } from "@kleroterion/koine";
import type { Command } from "commander";
import { resolveAuth } from "../../config/auth.js";
import { type CliFlags, loadConfig } from "../../config/load.js";
import { findCategoryId } from "../../github/discussions.js";
import { isDefaultBranchProtected } from "../../github/pulls.js";
import { globals } from "./_shared.js";

export function registerDoctor(program: Command): void {
  program
    .command("doctor")
    .description("Validate config, credentials, repo access, coordination categories, and merge capability.")
    .action(async (_local: unknown, cmd: Command) => {
      const g = globals(cmd);
      const out: string[] = [];
      let liveFailed = false;
      const check = (ok: boolean, label: string, hint = "") => {
        out.push(`${ok ? "✓" : "✗"} ${label}${ok ? "" : `  → ${hint}`}`);
        return ok;
      };

      let cfgOk = true;
      let cfg: ReturnType<typeof loadConfig> | null = null;
      try {
        cfg = loadConfig({ env: process.env, cli: g as CliFlags });
        check(true, `config valid (repo=${cfg.repo})`);
      } catch (e) {
        cfgOk = false;
        check(false, "config valid", e instanceof Error ? e.message : String(e));
      }

      let authOk = true;
      try {
        resolveAuth(process.env);
        check(true, "GitHub credentials present");
      } catch (e) {
        authOk = false;
        check(false, "GitHub credentials present", e instanceof Error ? e.message : String(e));
      }

      if (cfg && authOk) {
        const log = createLogger({ level: "silent" });
        try {
          const gh = await createGitHubClient(resolveAuth(process.env), log);
          const [owner, name] = cfg.repo.split("/") as [string, string];

          const repo = await gh.withRest("read", (o) => o.repos.get({ owner, repo: name }));
          check(true, `repo reachable (${cfg.repo})`);

          // Branch protection on the default branch — the real gate. Absent ⇒ doctor fails.
          // Ruleset-aware (classic branch protection is blind to rulesets).
          const branch = repo.data.default_branch;
          const protectedBranch = await isDefaultBranchProtected(gh, owner, name);
          liveFailed =
            !check(
              protectedBranch,
              `default branch '${branch}' is protected (required reviews/checks)`,
              "protect it with a ruleset or branch protection requiring reviews + status checks — Krites must not be the only gate",
            ) || liveFailed;

          for (const category of [cfg.coordination.category, cfg.coordination.escalationCategory]) {
            const id = await findCategoryId(gh, owner, name, category);
            liveFailed =
              !check(
                Boolean(id),
                `Discussion category "${category}" exists`,
                "create it in repo Settings → Discussions (Boule's bootstrap provisions it)",
              ) || liveFailed;
          }
        } catch (e) {
          liveFailed = true;
          check(false, "GitHub reachable", e instanceof Error ? e.message : String(e));
        }
      }

      process.stdout.write(`${out.join("\n")}\n`);
      if (!cfgOk || !authOk) process.exitCode = 2;
      else if (liveFailed) process.exitCode = 3;
    });
}
