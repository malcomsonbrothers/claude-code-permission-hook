#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import chalk from "chalk";
import inquirer from "inquirer";
import { handlePermissionRequest } from "./permission-handler.js";
import {
  loadConfig,
  saveConfig,
  getConfigPath,
  getConfigDir,
} from "./config.js";
import {
  clearCache,
  clearCacheByDecision,
  clearCacheByKey,
  clearCacheByGrep,
  listCacheEntries,
  getCacheStats,
} from "./cache.js";
import { DEFAULT_SYSTEM_PROMPT } from "./types.js";
import { resolveProjectRoot } from "./project.js";

const program = new Command();

program
  .name("cc-approve")
  .description(
    "Claude Code Permission Hook - Intelligent auto-approval for Claude Code"
  )
  .version("0.1.0");

// Main permission handler command
program
  .command("permission")
  .description("Handle a PermissionRequest hook (reads from stdin)")
  .action(async () => {
    try {
      // Read input from stdin
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk);
      }
      const rawInput = Buffer.concat(chunks).toString("utf-8");
      const input = JSON.parse(rawInput);

      // Process the permission request
      const result = await handlePermissionRequest(input);

      // Handle passthrough: null means exit 0 with no output
      // This triggers Claude Code's native permission dialog
      if (result === null) {
        process.exit(0);
      }

      // Output result to stdout for allow/deny
      console.log(JSON.stringify(result));
    } catch (error) {
      // On any error, output a deny response
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      const denyResponse = {
        hookSpecificOutput: {
          hookEventName: "PermissionRequest",
          decision: {
            behavior: "deny",
            message: `Hook error: ${errorMessage}`,
          },
        },
      };
      console.log(JSON.stringify(denyResponse));
      process.exit(1);
    }
  });

// Install command
program
  .command("install")
  .description("Install the hook into Claude Code settings")
  .action(async () => {
    // Welcome message
    console.log(
      chalk.cyan(
        "╔══════════════════════════════════════════════════════════════╗"
      )
    );
    console.log(
      chalk.cyan(
        "║   Claude Code Permission Hook - Auto-approval for Claude    ║"
      )
    );
    console.log(
      chalk.cyan(
        "╚══════════════════════════════════════════════════════════════╝"
      )
    );
    console.log();
    console.log("This hook automatically approves safe development operations");
    console.log("and blocks destructive commands.");
    console.log();

    // Provider selection
    const { provider } = await inquirer.prompt([
      {
        type: "list",
        name: "provider",
        message: "Choose your LLM provider:",
        choices: [
          {
            name: "OpenRouter (recommended - lowest latency)",
            value: "openrouter",
          },
          { name: "OpenAI", value: "openai" },
          { name: "Anthropic", value: "anthropic" },
        ],
      },
    ]);

    // API key input
    const { apiKey } = await inquirer.prompt([
      {
        type: "password",
        name: "apiKey",
        message: "Enter your API key:",
        mask: "X",
        validate: (input: string) => {
          if (!input || input.trim() === "") {
            return "API key is required";
          }
          return true;
        },
      },
    ]);

    // Set provider-specific defaults
    let baseUrl: string | undefined;
    let model = "gpt-4o-mini";

    if (provider === "openrouter") {
      baseUrl = "https://openrouter.ai/api/v1";
    } else if (provider === "anthropic") {
      baseUrl = "https://api.anthropic.com/v1";
      model = "claude-3-5-sonnet-20241022";
    }

    // OpenAI uses default baseUrl (undefined)

    // Test API key
    console.log(chalk.gray("\nValidating API key..."));
    try {
      const OpenAI = (await import("openai")).default;
      const testClient = new OpenAI({
        apiKey: apiKey.trim(),
        baseURL: baseUrl,
      });

      await testClient.chat.completions.create({
        model,
        messages: [{ role: "user", content: "test" }],
        max_tokens: 1,
      });

      console.log(chalk.green("✓ API key validated"));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error";
      console.log(chalk.red("✗ API key validation failed: " + message));
      console.log(
        chalk.yellow("Please check your API key and try again.")
      );
      return;
    }

    // Save config
    const newConfig = {
      llm: {
        provider,
        apiKey: apiKey.trim(),
        model,
        baseUrl,
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
      },
      cache: {
        enabled: true,
        ttlHours: 168,
      },
      logging: {
        enabled: true,
        level: "info" as const,
      },
      customAllowPatterns: [] as string[],
      customDenyPatterns: [] as string[],
      customPassthroughPatterns: [] as string[],
    };
    saveConfig(newConfig);

    // Choose installation scope
    const { scope } = await inquirer.prompt([
      {
        type: "list",
        name: "scope",
        message: "Where should the hook be installed?",
        choices: [
          {
            name: "User (global - applies to all projects)",
            value: "user",
          },
          {
            name: "Project (shared - committed to repo via .claude/settings.json)",
            value: "project",
          },
          {
            name: "Project local (personal - gitignored via .claude/settings.local.json)",
            value: "local",
          },
        ],
      },
    ]);

    let settingsPath: string | null = null;

    if (scope === "user") {
      const settingsLocations = [
        join(homedir(), ".claude", "settings.json"),
        join(homedir(), "AppData", "Roaming", "Claude", "settings.json"),
      ];

      for (const loc of settingsLocations) {
        if (existsSync(loc)) {
          settingsPath = loc;
          break;
        }
      }

      if (!settingsPath) {
        settingsPath = settingsLocations[0];
        const dir = join(homedir(), ".claude");
        if (!existsSync(dir)) {
          const { mkdirSync } = await import("fs");
          mkdirSync(dir, { recursive: true });
        }
        writeFileSync(
          settingsPath,
          JSON.stringify({ hooks: {} }, null, 2)
        );
      }
    } else {
      const filename = scope === "project" ? "settings.json" : "settings.local.json";
      const dir = join(process.cwd(), ".claude");
      settingsPath = join(dir, filename);

      if (!existsSync(dir)) {
        const { mkdirSync } = await import("fs");
        mkdirSync(dir, { recursive: true });
      }

      if (!existsSync(settingsPath)) {
        writeFileSync(
          settingsPath,
          JSON.stringify({}, null, 2)
        );
      }
    }

    // Read and update settings
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    if (!settings.hooks) {
      settings.hooks = {};
    }

    settings.hooks.PermissionRequest = [
      {
        matcher: "*",
        hooks: [
          {
            type: "command",
            command: "cc-approve permission",
          },
        ],
      },
    ];

    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

    console.log();
    console.log(chalk.green("✓ Hook installed to " + settingsPath));
    console.log(
      chalk.green("✓ Configuration saved to " + getConfigPath())
    );
    console.log();
    console.log(chalk.gray("Run 'cc-approve doctor' to verify setup."));
  });

// Uninstall command
program
  .command("uninstall")
  .description("Remove the hook from Claude Code settings")
  .action(async () => {
    const settingsPath = join(homedir(), ".claude", "settings.json");
    if (!existsSync(settingsPath)) {
      console.log(chalk.yellow("Settings file not found"));
      return;
    }

    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    if (settings.hooks?.PermissionRequest) {
      delete settings.hooks.PermissionRequest;
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      console.log(chalk.green("✓ Uninstalled successfully!"));
    } else {
      console.log(chalk.yellow("Hook was not installed"));
    }
  });

// Config command
program
  .command("config")
  .description("Configure API keys and settings")
  .option("--model <model>", "Set the LLM model without running full interactive setup")
  .action(async (options: { model?: string }) => {
    // Quick model update
    if (options.model) {
      const config = loadConfig();
      const DEFAULT_MODEL = "gpt-4o-mini";
      const model = options.model === "default" ? DEFAULT_MODEL : options.model;
      config.llm.model = model;
      saveConfig(config);
      if (options.model === "default") {
        console.log(chalk.green(`✓ Model reset to default (${DEFAULT_MODEL})`));
      } else {
        console.log(chalk.green(`✓ Model set to ${model}`));
      }
      return;
    }

    const config = loadConfig();

    // Provider selection
    const { provider } = await inquirer.prompt([
      {
        type: "list",
        name: "provider",
        message: "Choose your LLM provider:",
        choices: [
          {
            name: "OpenRouter (recommended - lowest latency)",
            value: "openrouter",
          },
          { name: "OpenAI", value: "openai" },
          { name: "Anthropic", value: "anthropic" },
        ],
        default: config.llm.provider,
      },
    ]);

    // API key input
    const { apiKey } = await inquirer.prompt([
      {
        type: "password",
        name: "apiKey",
        message: "Enter your API key:",
        mask: "X",
        validate: (input: string) => {
          if (!input || input.trim() === "") {
            return "API key is required";
          }
          return true;
        },
      },
    ]);

    // Set provider-specific defaults
    let baseUrl: string | undefined;
    let model = "gpt-4o-mini";

    if (provider === "openrouter") {
      baseUrl = "https://openrouter.ai/api/v1";
    } else if (provider === "anthropic") {
      baseUrl = "https://api.anthropic.com/v1";
      model = "claude-3-5-sonnet-20241022";
    }

    // Test API key
    console.log(chalk.gray("\nValidating API key..."));
    try {
      const OpenAI = (await import("openai")).default;
      const testClient = new OpenAI({
        apiKey: apiKey.trim(),
        baseURL: baseUrl,
      });

      await testClient.chat.completions.create({
        model,
        messages: [{ role: "user", content: "test" }],
        max_tokens: 1,
      });

      console.log(chalk.green("✓ API key validated"));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error";
      console.log(chalk.red("✗ API key validation failed: " + message));
      console.log(
        chalk.yellow("Please check your API key and try again.")
      );
      return;
    }

    const newConfig = {
      llm: {
        provider,
        apiKey: apiKey.trim(),
        model,
        baseUrl,
        systemPrompt: config.llm?.systemPrompt || DEFAULT_SYSTEM_PROMPT,
      },
      cache: {
        enabled: true,
        ttlHours: 168,
      },
      logging: {
        enabled: true,
        level: "info" as const,
      },
      customAllowPatterns: config.customAllowPatterns || [],
      customDenyPatterns: config.customDenyPatterns || [],
      customPassthroughPatterns: config.customPassthroughPatterns || [],
    };
    saveConfig(newConfig);

    console.log(chalk.green("✓ Configuration saved!"));
    console.log(chalk.gray(`  Config file: ${getConfigPath()}`));
  });

// Clear cache command
program
  .command("clear-cache")
  .description("Clear cached decisions (all by default, or selectively)")
  .option("--deny-only", "Only clear entries with 'deny' decision")
  .option("--allow-only", "Only clear entries with 'allow' decision")
  .option("--key <hash>", "Clear a specific entry by its SHA256 key")
  .option(
    "--grep <substring>",
    "Clear entries matching a substring in toolName, reason, or input"
  )
  .action(
    (options: {
      denyOnly?: boolean;
      allowOnly?: boolean;
      key?: string;
      grep?: string;
    }) => {
      if (options.key) {
        const found = clearCacheByKey(options.key);
        if (found) {
          console.log(
            chalk.green(`✓ Cleared cache entry with key ${options.key}`)
          );
        } else {
          console.log(
            chalk.yellow(`No cache entry found with key ${options.key}`)
          );
        }
        return;
      }

      if (options.grep) {
        const count = clearCacheByGrep(options.grep);
        console.log(
          chalk.green(
            `✓ Cleared ${count} cached decisions matching "${options.grep}"`
          )
        );
        return;
      }

      if (options.denyOnly) {
        const count = clearCacheByDecision("deny");
        console.log(
          chalk.green(`✓ Cleared ${count} denied cached decisions`)
        );
        return;
      }

      if (options.allowOnly) {
        const count = clearCacheByDecision("allow");
        console.log(
          chalk.green(`✓ Cleared ${count} allowed cached decisions`)
        );
        return;
      }

      // Default: clear all
      const count = clearCache();
      console.log(chalk.green(`✓ Cleared ${count} cached decisions`));
    }
  );

// Cache list command
program
  .command("cache")
  .description("View cached decisions for the current project")
  .option("--page <number>", "Page number", "1")
  .option("--per-page <number>", "Entries per page", "20")
  .option("--all", "Show all projects, not just the current one")
  .action(
    (options: { page: string; perPage: string; all?: boolean }) => {
      const page = Math.max(1, parseInt(options.page, 10) || 1);
      const perPage = Math.max(1, parseInt(options.perPage, 10) || 20);

      const projectRoot = options.all
        ? undefined
        : resolveProjectRoot(process.cwd());
      const entries = listCacheEntries(projectRoot);

      if (entries.length === 0) {
        if (options.all) {
          console.log(chalk.yellow("No cached decisions found."));
        } else {
          console.log(
            chalk.yellow(
              `No cached decisions for project: ${projectRoot}`
            )
          );
          console.log(
            chalk.gray("Use --all to see entries for all projects.")
          );
        }
        return;
      }

      const totalPages = Math.ceil(entries.length / perPage);
      const start = (page - 1) * perPage;
      const pageEntries = entries.slice(start, start + perPage);

      if (!options.all) {
        console.log(chalk.bold(`Project: ${projectRoot}`));
      }
      console.log(
        chalk.bold(
          `Cache entries: ${entries.length} total (page ${page}/${totalPages})\n`
        )
      );

      for (const entry of pageEntries) {
        const age = formatAge(Date.now() - entry.timestamp);
        const decisionColor =
          entry.decision === "allow" ? chalk.green : chalk.red;

        console.log(
          `  ${decisionColor(entry.decision.toUpperCase().padEnd(5))}  ${chalk.cyan(entry.toolName)}  ${chalk.gray(age)}`
        );
        console.log(`         ${chalk.gray(entry.reason)}`);
        if (entry.toolInput) {
          const inputStr = summarizeInput(entry.toolInput);
          if (inputStr) {
            console.log(`         ${chalk.dim(inputStr)}`);
          }
        }
        if (options.all && entry.projectRoot) {
          console.log(
            `         ${chalk.dim("project: " + entry.projectRoot)}`
          );
        }
        console.log(`         ${chalk.dim("key: " + entry.key)}`);
        console.log();
      }

      if (totalPages > 1) {
        console.log(
          chalk.gray(
            `Page ${page} of ${totalPages}. Use --page ${page + 1} to see more.`
          )
        );
      }
    }
  );

// Doctor command
program
  .command("doctor")
  .description("Diagnose configuration and connectivity")
  .action(async () => {
    console.log(chalk.blue("Running diagnostics...\n"));

    // Check config
    console.log(chalk.bold("Configuration:"));
    const config = loadConfig();
    console.log(`  Provider: ${config.llm.provider}`);
    console.log(`  Model: ${config.llm.model}`);
    console.log(
      `  API Key: ${config.llm.apiKey ? "✓ Set in config" : "✗ Not in config"}`
    );
    console.log(`  Base URL: ${config.llm.baseUrl || "Default"}`);
    console.log(
      `  Cache: ${config.cache.enabled ? `Enabled (${config.cache.ttlHours}h TTL)` : "Disabled"}`
    );

    // Check cache stats
    console.log(chalk.bold("\nCache Stats:"));
    const cacheStats = getCacheStats();
    console.log(`  Entries: ${cacheStats.entries}`);
    if (cacheStats.oldestTimestamp) {
      const age = Math.round(
        (Date.now() - cacheStats.oldestTimestamp) / 1000 / 60 / 60
      );
      console.log(`  Oldest entry: ${age} hours ago`);
    }

    // Check settings installation across all locations
    console.log(chalk.bold("\nInstallation:"));
    const settingsLocations = [
      {
        label: "User settings",
        path: join(homedir(), ".claude", "settings.json"),
      },
      {
        label: "Project settings",
        path: join(process.cwd(), ".claude", "settings.json"),
      },
      {
        label: "Project local",
        path: join(process.cwd(), ".claude", "settings.local.json"),
      },
    ];

    let anyInstalled = false;
    for (const { label, path } of settingsLocations) {
      if (existsSync(path)) {
        try {
          const settings = JSON.parse(readFileSync(path, "utf-8"));
          const installed = settings.hooks?.PermissionRequest != null;
          if (installed) {
            console.log(
              `  ${label}: ${chalk.green("✓ Hook configured")}`
            );
            anyInstalled = true;
          } else {
            console.log(
              `  ${label}: ${chalk.yellow("File exists, hook not configured")}`
            );
          }
          console.log(chalk.gray(`    ${path}`));
        } catch {
          console.log(
            `  ${label}: ${chalk.red("✗ File exists but could not be parsed")}`
          );
          console.log(chalk.gray(`    ${path}`));
        }
      } else {
        console.log(`  ${label}: ${chalk.gray("- File not found")}`);
        console.log(chalk.gray(`    ${path}`));
      }
    }

    if (!anyInstalled) {
      console.log(
        chalk.yellow(
          "\n  ⚠ Hook not found in any settings file. Run 'cc-approve install' to set up."
        )
      );
    }

    // Check API connectivity
    console.log(chalk.bold("\nConnectivity:"));
    const { getApiKey } = await import("./config.js");
    const apiKey = getApiKey();
    console.log(`  API Key available: ${apiKey ? "✓ Yes" : "✗ No"}`);

    console.log(chalk.bold("\nPaths:"));
    console.log(`  Config dir: ${getConfigDir()}`);
    console.log(`  Config file: ${getConfigPath()}`);
  });

// Status command (show current config)
program
  .command("status")
  .description("Show current configuration status")
  .action(() => {
    const config = loadConfig();
    console.log(chalk.blue("Claude Code Permission Hook Status\n"));
    console.log(JSON.stringify(config, null, 2));
  });

function formatAge(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function summarizeInput(toolInput: Record<string, unknown>): string {
  const command = toolInput.command;
  if (typeof command === "string") {
    const truncated =
      command.length > 100 ? command.slice(0, 100) + "..." : command;
    return `$ ${truncated}`;
  }
  const filePath = toolInput.file_path || toolInput.filePath;
  if (typeof filePath === "string") {
    return filePath;
  }
  return "";
}

program.parse();
