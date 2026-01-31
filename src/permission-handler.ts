import {
  PermissionRequestInputSchema,
  PermissionRequestOutput,
  DEFAULT_SYSTEM_PROMPT,
  CURRENT_SYSTEM_PROMPT_VERSION,
} from "./types.js";
import { checkFastDecision } from "./fast-decisions.js";
import { getCachedDecision, setCachedDecision, clearCache } from "./cache.js";
import { loadConfig, saveConfig } from "./config.js";
import { queryLLM } from "./llm-client.js";
import { logDecision } from "./logger.js";
import { resolveProjectRoot } from "./project.js";

let promptUpgradeChecked = false;

/**
 * Lazily upgrade the system prompt if stale.
 * Runs once per process — just an integer comparison on subsequent calls.
 */
function ensurePromptUpToDate(): void {
  if (promptUpgradeChecked) return;
  promptUpgradeChecked = true;

  const config = loadConfig();
  if (
    config.autoUpdateSystemPrompt &&
    config.llm.systemPromptVersion < CURRENT_SYSTEM_PROMPT_VERSION
  ) {
    config.llm.systemPrompt = DEFAULT_SYSTEM_PROMPT;
    config.llm.systemPromptVersion = CURRENT_SYSTEM_PROMPT_VERSION;
    saveConfig(config);
    clearCache();
  }
}

/** Core decision result shared by both PermissionRequest and PreToolUse handlers */
export type DecisionResult =
  | { decision: "allow"; reason: string }
  | { decision: "deny"; reason: string }
  | { decision: "passthrough"; reason: string };

/**
 * Core decision logic shared by both PermissionRequest and PreToolUse handlers.
 * Runs fast-decisions, cache, and LLM tiers.
 */
export async function resolveDecision(
  toolName: string,
  toolInput: Record<string, unknown>,
  cwd?: string,
  sessionId?: string
): Promise<DecisionResult> {
  ensurePromptUpToDate();

  const projectRoot = cwd ? resolveProjectRoot(cwd) : undefined;

  // Tier 1: Check fast decisions (hardcoded patterns)
  const fastResult = checkFastDecision(toolName, toolInput);

  if (fastResult.decision === "allow") {
    logDecision({
      toolName,
      decision: "allow",
      reason: fastResult.reason || "Fast allow",
      decisionSource: "fast",
      sessionId,
      projectRoot,
    });
    return { decision: "allow", reason: fastResult.reason || "Fast allow" };
  }

  if (fastResult.decision === "deny") {
    logDecision({
      toolName,
      decision: "deny",
      reason: fastResult.reason || "Fast deny",
      decisionSource: "fast",
      sessionId,
      projectRoot,
    });
    return {
      decision: "deny",
      reason: fastResult.reason || "Blocked by security pattern",
    };
  }

  if (fastResult.decision === "passthrough") {
    logDecision({
      toolName,
      decision: "passthrough",
      reason: fastResult.reason || "Fast passthrough",
      decisionSource: "fast",
      sessionId,
      projectRoot,
    });
    return {
      decision: "passthrough",
      reason: fastResult.reason || "Fast passthrough",
    };
  }

  // Tier 2: Check cache
  const cached = getCachedDecision(toolName, toolInput, projectRoot);
  if (cached) {
    logDecision({
      toolName,
      decision: cached.decision,
      reason: `Cached: ${cached.reason}`,
      decisionSource: "cache",
      sessionId,
      projectRoot,
    });
    return { decision: cached.decision, reason: cached.reason };
  }

  // Tier 3: Query LLM
  const llmResult = await queryLLM(toolName, toolInput, projectRoot);

  setCachedDecision(
    toolName,
    toolInput,
    llmResult.decision,
    llmResult.reason,
    projectRoot
  );

  logDecision({
    toolName,
    decision: llmResult.decision,
    reason: llmResult.reason,
    decisionSource: "llm",
    sessionId,
    projectRoot,
  });

  return { decision: llmResult.decision, reason: llmResult.reason };
}

/**
 * Handle a PermissionRequest hook from Claude Code.
 * Returns PermissionRequestOutput for allow/deny, or null for passthrough.
 */
export async function handlePermissionRequest(
  rawInput: unknown
): Promise<PermissionRequestOutput | null> {
  let input;
  try {
    input = PermissionRequestInputSchema.parse(rawInput);
  } catch {
    return createPermissionDenyResponse("Invalid permission request input");
  }

  const result = await resolveDecision(
    input.tool_name,
    input.tool_input,
    input.cwd,
    input.session_id
  );

  if (result.decision === "allow") {
    return createPermissionAllowResponse();
  }
  if (result.decision === "deny") {
    return createPermissionDenyResponse(result.reason);
  }
  // passthrough
  return null;
}

/** PreToolUse output type */
export interface PreToolUseOutput {
  hookSpecificOutput: {
    hookEventName: "PreToolUse";
    permissionDecision: "allow" | "deny";
    permissionDecisionReason: string;
  };
}

/**
 * Handle a PreToolUse hook from Claude Code.
 * Returns PreToolUseOutput for allow/deny, or null for passthrough.
 * This enables cc-approve to work with background agents where
 * PermissionRequest hooks never fire.
 */
export async function handlePreToolUse(
  rawInput: unknown
): Promise<PreToolUseOutput | null> {
  const input = rawInput as Record<string, unknown>;
  const toolName = input.tool_name as string;
  const toolInput = (input.tool_input as Record<string, unknown>) || {};
  const cwd = input.cwd as string | undefined;
  const sessionId = input.session_id as string | undefined;

  if (!toolName) {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "Invalid PreToolUse input: missing tool_name",
      },
    };
  }

  const result = await resolveDecision(toolName, toolInput, cwd, sessionId);

  if (result.decision === "allow") {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        permissionDecisionReason: result.reason,
      },
    };
  }

  if (result.decision === "deny") {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: result.reason,
      },
    };
  }

  // passthrough: exit 0 with no output
  return null;
}

function createPermissionAllowResponse(): PermissionRequestOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: {
        behavior: "allow",
      },
    },
  };
}

function createPermissionDenyResponse(
  message: string
): PermissionRequestOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: {
        behavior: "deny",
        message,
      },
    },
  };
}
