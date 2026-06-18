// src/config/schema.ts — zod schema for Krites config (env + CLI flags merged in load.ts).
import { DISCUSSION_CATEGORIES } from "@kleroterion/koine";
import { z } from "zod";

export const ConfigSchema = z.object({
  repo: z.string().regex(/^[^/]+\/[^/]+$/, "repo must be 'owner/name'"),
  projectNumber: z.number().int().positive().optional(),
  models: z
    .object({
      // The reviewer/critic. Opus for careful judgement; drop to a cheaper model for lighter runs.
      reviewer: z.string().default("claude-opus-4-8"),
      fast: z.string().default("claude-haiku-4-5"),
      effort: z.enum(["low", "medium", "high", "xhigh"]).default("high"),
    })
    .default({}),
  budgets: z
    .object({
      // Reviewing is read-only and cheaper than implementing — a smaller cap than Praktor's.
      usdPerRun: z.number().positive().default(5),
      maxTurns: z.number().int().positive().default(120),
    })
    .default({}),
  review: z
    .object({
      // Only PRs authored by THIS login are eligible for auto-merge (verified by login, not a label).
      trustedAuthor: z.string().default("praktorai[bot]"),
      mergeMethod: z.enum(["squash", "merge", "rebase"]).default("squash"),
      // Belt-and-suspenders over GitHub branch protection: refuse to enable merge unless CI is green.
      requireCI: z.boolean().default(true),
      // Blast-radius cap: the maximum number of auto-merges a single run may enable.
      maxMerges: z.number().int().positive().default(1),
    })
    .default({}),
  coordination: z
    .object({
      // Discussion category Krites posts claims/handoffs to. Must already exist in the repo.
      category: z.string().default(DISCUSSION_CATEGORIES.handoff),
      // Where Krites escalates PRs that need a human (repeated request-changes, suspected injection).
      escalationCategory: z.string().default(DISCUSSION_CATEGORIES.designReview),
      // A claim older than this (minutes) is considered stale and the PR may be re-grabbed.
      claimTtlMinutes: z.number().int().positive().default(60),
    })
    .default({}),
  flags: z
    .object({
      dryRun: z.boolean().default(false),
    })
    .default({}),
  log: z.object({ level: z.string().default("info") }).default({}),
});

export type Config = z.infer<typeof ConfigSchema>;
