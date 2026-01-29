# Claude Code Permission Hook

Intelligent auto-approval for Claude Code that reduces friction and maintains security.

- Auto-approve safe dev operations (less clicking, more coding)
- Block destructive commands automatically (no LLM needed)
- Uses the new PermissionRequest hook type
- Cache decisions to minimize API costs

> **Cost**: Using GPT-4o-mini via OpenRouter, **$1 USD = ~5,000+ LLM decisions**. Most operations use fast allow/deny (no LLM), so $1 can last 6+ months of heavy use.

---

## Quick Start

```bash
npm install -g @malcomsonbrothers/claude-code-permission-hook
cc-approve install
cc-approve config
```

## Installation

**Prerequisites**: Node.js 18+ and Claude Code installed

```bash
# Step 1: Install globally
npm install -g @malcomsonbrothers/claude-code-permission-hook

# Step 2: Run the install command to set up the hook
cc-approve install

# Step 3: Configure your API key
cc-approve config
```

The `cc-approve install` command will:
1. Locate your Claude Code settings
2. Add the PermissionRequest hook automatically
3. Verify the setup works

### Manual Installation

If you prefer to add the hook manually, add this to your Claude Code `settings.json`:

```json
{
  "hooks": {
    "PermissionRequest": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "cc-approve permission"
          }
        ]
      }
    ]
  }
}
```

Settings file locations:
- **User settings**: `~/.claude/settings.json`
- **Project settings**: `.claude/settings.json`
- **Project local**: `.claude/settings.local.json`

## How It Works

This hook uses Claude Code's PermissionRequest hook to intercept tool calls before execution:

```
Claude Code Tool Request → cc-approve → Decision → Execute/Block
```

### Three-Tier Decision System

1. **Fast approval** for obviously safe operations (Read, Write, Glob, Edit)
2. **Fast deny** for destructive patterns (rm -rf /, force push to protected branches)
3. **LLM analysis** for complex operations with intelligent caching

### Authentication Options

- **OpenRouter** (recommended for latency/speed)
- **OpenAI API** (direct or compatible endpoints)
- **Anthropic API** (direct Claude access)

## Configuration

### Quick Setup

```bash
# Interactive configuration
cc-approve config

# Check current setup
cc-approve doctor
```

### Manual Configuration

Config is stored at `~/.cc-approve/config.json`:

```json
{
  "llm": {
    "provider": "openai",
    "model": "gpt-4o-mini",
    "apiKey": "sk-...",
    "baseUrl": "https://openrouter.ai/api/v1"
  },
  "cache": {
    "enabled": true,
    "ttlHours": 168
  },
  "logging": {
    "enabled": true,
    "level": "info"
  }
}
```

### OpenRouter Setup (Recommended)

```json
{
  "llm": {
    "provider": "openai",
    "model": "openai/gpt-4o-mini",
    "apiKey": "sk-or-v1-your-key",
    "baseUrl": "https://openrouter.ai/api/v1"
  },
  "cache": {
    "enabled": true,
    "ttlHours": 168
  }
}
```

### Environment Variables

You can also use environment variables instead of config file:

```bash
export OPENAI_API_KEY=sk-your-key
export OPENAI_BASE_URL=https://openrouter.ai/api/v1
```

## What Gets Auto-Approved?

### Always Allowed (No LLM call)
- **Read operations**: Read, Glob, Grep, LS, WebFetch, WebSearch
- **Write operations**: Write, Edit, MultiEdit, NotebookEdit
- **Interaction tools**: TodoWrite, Task, AskUserQuestion
- **MCP tools**: All `mcp__*` prefixed tools

### Always Blocked (No LLM call)
- **System destruction**: `rm -rf /`, `rm -rf /usr`, `rm -rf ~`
- **Protected git branches**: `git push --force origin main/master/production/staging/develop`
- **Disk operations**: `mkfs`, `fdisk --delete`, `dd` to raw devices, `format C:`
- **Windows destruction**: `rmdir /s /q C:\`, `del /f /s /q C:\`
- **Malicious patterns**: Fork bombs, credential theft attempts

### LLM Analysis Required
- **Bash commands**: npm, git (non-force), docker, curl, etc.
- **Unknown tools**: Any tool not in the allow/deny lists

## CLI Commands

```bash
cc-approve permission       # Handle PermissionRequest hook (reads stdin)
cc-approve install          # Add hook to Claude Code settings
cc-approve uninstall        # Remove hook from settings
cc-approve config           # Interactive configuration
cc-approve config --model   # Set LLM model without interactive setup
cc-approve doctor           # Diagnose configuration and connectivity
cc-approve status           # Show current configuration
cc-approve cache            # View cached decisions for the current project
cc-approve cache --all      # View cached decisions across all projects
cc-approve clear-cache      # Clear all cached decisions
cc-approve clear-cache --deny-only   # Clear only deny decisions
cc-approve clear-cache --allow-only  # Clear only allow decisions
cc-approve clear-cache --key <hash>  # Clear a specific entry by SHA256 key
cc-approve clear-cache --grep <str>  # Clear entries matching a substring
```

## Caching Behavior

- **Enabled by default** for optimal performance
- **Working directory scoped** for safety across projects
- **TTL expiration** (default 168 hours / 1 week)
- **Caches only definitive decisions** (allow/deny from LLM)
- **Instant responses** for repeated operations

```bash
# View cached decisions for this project
cc-approve cache

# View all cached decisions (paginated)
cc-approve cache --all --page 2 --per-page 10

# Clear all cached decisions
cc-approve clear-cache

# Selectively clear cache
cc-approve clear-cache --deny-only
cc-approve clear-cache --grep "docker"
cc-approve clear-cache --key <sha256-hash>

# Disable caching in config
{
  "cache": {
    "enabled": false
  }
}
```

## License

MIT License - see [LICENSE](LICENSE) file for details.

---

```bash
npm install -g @malcomsonbrothers/claude-code-permission-hook && cc-approve install && cc-approve config
```
