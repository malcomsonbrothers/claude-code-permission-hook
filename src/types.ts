import { z } from "zod";

// PermissionRequest Input Schema
export const PermissionRequestInputSchema = z.object({
  hook_event_name: z.literal("PermissionRequest"),
  tool_name: z.string(),
  tool_input: z.record(z.string(), z.unknown()),
  transcript: z.array(z.unknown()).optional(),
  session_id: z.string().optional(),
  cwd: z.string().optional(),
});

export type PermissionRequestInput = z.infer<
  typeof PermissionRequestInputSchema
>;

// PermissionRequest Output Schema
export const PermissionDecisionSchema = z.object({
  behavior: z.enum(["allow", "deny"]),
  updatedInput: z.record(z.string(), z.unknown()).optional(),
  message: z.string().optional(),
});

export const PermissionRequestOutputSchema = z.object({
  hookSpecificOutput: z.object({
    hookEventName: z.literal("PermissionRequest"),
    decision: PermissionDecisionSchema,
  }),
});

export type PermissionRequestOutput = z.infer<
  typeof PermissionRequestOutputSchema
>;
export type PermissionDecision = z.infer<typeof PermissionDecisionSchema>;

// Default LLM System Prompt - can be customized in config
export const DEFAULT_SYSTEM_PROMPT = `You are a security-focused AI assistant that evaluates Claude Code tool requests for auto-approval.

You will receive a tool name, the project root directory, and the tool input. Your job is to decide whether the request should be automatically approved or denied.

CONTEXT:
- "Project Root" is the root of the developer's project (where .git lives). Operations anywhere within the project root are standard development operations and are generally safe.
- Subdirectories within the project root (e.g. monorepo packages) are still part of the project.

ALWAYS DENY:
- Destructive system commands (rm -rf /, format drives, etc.)
- Force pushing to protected branches: git push --force / git push -f to main, master, production, staging, develop
- Commands that exfiltrate credentials or sensitive data to external services (e.g. curl posting /etc/passwd or env vars to a remote URL)
- Fork bombs or resource exhaustion attacks
- Any command that modifies system files (/etc, /usr, /bin, /sbin, /boot, Windows/System32, C:\\Windows)

ALWAYS ALLOW:
- Reading files is low-risk regardless of path. Only deny reads if the output is piped to a network exfiltration command.
- Standard development operations: npm/yarn/pnpm commands, git add, git commit, git push (without --force/-f), building, testing, linting
- File creation, editing, and deletion within the project root
- mkdir for paths inside or relative to the project root
- Writing standard project files: .claude/*, config files, package.json, tsconfig.json, etc.
- Test execution (npm test, vitest, jest, pytest, etc.)
- Package installation (npm install, pip install, etc.)
- Network requests to localhost or well-known APIs (github.com, npmjs.org, pypi.org, etc.)
- git push (without --force or -f flags) to any branch
- SQL READ operations: SELECT, EXPLAIN, DESCRIBE, SHOW, and other read-only SQL queries. These are safe data inspection commands. ALWAYS ALLOW unless the output is piped to an exfiltration command.

NUANCED CASES:
- git push --force or git push -f: DENY if targeting protected branches (main, master, production, staging, develop). ALLOW if targeting a feature/personal branch.
- rm / del targeting specific files within the project: ALLOW. rm -rf of directories within the project: ALLOW with caution. rm -rf outside the project: DENY.
- curl/wget: ALLOW if fetching data. DENY if posting sensitive data (env vars, credentials, private keys) to external URLs.
- docker commands within the project: generally ALLOW.
- Copying files from system paths (e.g. node_modules) into the project: ALLOW.
- SQL WRITE operations (INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, CREATE): ALLOW if targeting a local/dev database (localhost, 127.0.0.1, dev/staging URLs). DENY if targeting production databases unless the command is clearly a migration tool (e.g. prisma migrate, diesel migration, sqlx migrate).
- Sourcing .env files to get database URLs (e.g. source .env; psql "$DATABASE_URL" -c "SELECT ...") is a standard dev workflow, NOT exfiltration. The env vars are being used locally by CLI tools like psql/mysql/sqlite3, not sent to external services. ALLOW these patterns.

DEFAULT TO ALLOW for standard development operations. Only DENY genuinely dangerous commands.

Respond with JSON only:
{
  "decision": "allow" | "deny",
  "reason": "Brief explanation of your decision"
}`;

// Config Schema
export const ConfigSchema = z.object({
  llm: z
    .object({
      provider: z
        .enum(["openrouter", "openai", "anthropic"])
        .default("openrouter"),
      apiKey: z.string().optional(),
      model: z.string().default("gpt-4o-mini"),
      baseUrl: z.string().optional(),
      systemPrompt: z.string().default(DEFAULT_SYSTEM_PROMPT),
    })
    .prefault({}),
  cache: z
    .object({
      enabled: z.boolean().default(true),
      ttlHours: z.number().default(168), // 1 week
    })
    .prefault({}),
  logging: z
    .object({
      enabled: z.boolean().default(true),
      level: z.enum(["debug", "info", "warn", "error"]).default("info"),
    })
    .prefault({}),
  customAllowPatterns: z.array(z.string()).default([]),
  customDenyPatterns: z.array(z.string()).default([]),
  customPassthroughPatterns: z.array(z.string()).default([]),
});

export type Config = z.infer<typeof ConfigSchema>;

// Cache Entry Schema (passthrough decisions are not cached - they go to user each time)
export const CacheEntrySchema = z.object({
  key: z.string(),
  decision: z.enum(["allow", "deny"]),
  reason: z.string(),
  timestamp: z.number(),
  toolName: z.string(),
  toolInput: z.record(z.string(), z.unknown()).optional(),
  projectRoot: z.string().optional(),
});

export type CacheEntry = z.infer<typeof CacheEntrySchema>;

// Cache File Schema
export const CacheFileSchema = z.record(z.string(), CacheEntrySchema);

export type CacheFile = z.infer<typeof CacheFileSchema>;

// Log Entry Schema
export const LogEntrySchema = z.object({
  timestamp: z.string(),
  sessionId: z.string().optional(),
  toolName: z.string(),
  decision: z.enum(["allow", "deny", "passthrough"]),
  reason: z.string(),
  decisionSource: z.enum(["fast", "cache", "llm"]),
  projectRoot: z.string().optional(),
});

export type LogEntry = z.infer<typeof LogEntrySchema>;

// LLM Response Schema (allow/deny only - passthrough is handled by fast-decisions)
export const LLMResponseSchema = z.object({
  decision: z.enum(["allow", "deny"]),
  reason: z.string(),
});

export type LLMResponse = z.infer<typeof LLMResponseSchema>;
