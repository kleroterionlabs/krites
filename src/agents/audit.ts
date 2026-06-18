// src/agents/audit.ts — a logging-only PreToolUse hook so a reviewer run's tool calls are traceable.
// The reviewer is read-only; this hook only OBSERVES, never denies. One "tool invocation" log line per
// tool call, so a review is no longer a black box between "started" and "finished".
import type { HookCallback } from "@anthropic-ai/claude-agent-sdk";
import type { Logger } from "@kleroterion/koine";

/** PreToolUse hook that logs every tool invocation and always continues. */
export function makeAuditHook(log: Logger): HookCallback {
  return async (input) => {
    const tool = "tool_name" in input ? input.tool_name : input.hook_event_name;
    log.info({ event: "pre_tool_use", tool }, "tool invocation");
    return { continue: true };
  };
}
