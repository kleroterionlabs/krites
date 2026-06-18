// src/cli/index.ts — build the commander program (testable; bin.ts wires it to argv/process).
import { Command } from "commander";
import { registerDoctor } from "./commands/doctor.js";
import { registerNext } from "./commands/next.js";
import { registerReview } from "./commands/review.js";
import { registerStatus } from "./commands/status.js";

/** Map a thrown error to a process exit code (UsageError ⇒ 2, budget ⇒ 4, else 1). */
export function exitCodeFor(err: unknown): number {
  const name = err instanceof Error ? err.name : "";
  if (name === "UsageError") return 2;
  if (name === "BudgetError") return 4;
  return 1;
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("krites")
    .description("Autonomous reviewer/merger that reviews Praktor's PRs and enables gated auto-merge.")
    .option("--repo <owner/repo>", "target repository")
    .option("--project <number>", "Projects v2 number", (v) => Number(v))
    .option("--budget <usd>", "hard cost cap (USD)", (v) => Number(v))
    .option("--max-turns <n>", "max agentic turns", (v) => Number(v))
    .option("--dry-run", "review only; never enable merge or write state", false)
    .option("--json", "machine-readable output", false)
    .option("-v, --verbose", "verbose logging", false);

  for (const register of [registerDoctor, registerNext, registerStatus, registerReview]) {
    register(program);
  }
  return program;
}
