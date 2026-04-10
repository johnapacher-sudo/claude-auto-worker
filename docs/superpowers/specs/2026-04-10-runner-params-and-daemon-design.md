# Runner Extension Params & Daemon Mode Design

## Background

Current `ClaudeRunner` hardcodes `claude -p <prompt> --output-format json` with no support for additional CLI parameters. The `start` command also blocks the terminal, preventing background operation.

## Feature 1: Per-Task Claude CLI Parameters

### Supported Parameters

| CLI Flag | Claude CLI Equivalent | Type | Default |
|----------|----------------------|------|---------|
| `--model` | `--model` | string | none (Claude default) |
| `--permission-mode` | `--permission-mode` | string | none (Claude default) |
| `--allowedTools` | `--allowedTools` | string | none (Claude default) |
| `--max-turns` | `--max-turns` | number | none (Claude default) |

### Data Model Change

Add `claudeArgs` field to `Task`:

```typescript
interface ClaudeArgs {
  model?: string;
  permissionMode?: string;
  allowedTools?: string[];
  maxTurns?: number;
}

interface Task {
  // ... existing fields
  claudeArgs: ClaudeArgs | null;
}
```

### CLI Usage

```bash
auto-worker add "Refactor utils" --model opus --max-turns 5 --allowedTools "Bash,Edit"
auto-worker add "Quick fix" --model haiku --permission-mode bypassPermissions
auto-worker add "Simple task"  # no extra args, uses Claude defaults
```

### Execution

`ClaudeRunner.run()` receives `claudeArgs` and translates them to CLI flags:

```typescript
const args = ["-p", prompt, "--output-format", "json"];
if (claudeArgs?.model) args.push("--model", claudeArgs.model);
if (claudeArgs?.permissionMode) args.push("--permission-mode", claudeArgs.permissionMode);
if (claudeArgs?.allowedTools?.length) args.push("--allowedTools", ...claudeArgs.allowedTools);
if (claudeArgs?.maxTurns) args.push("--max-turns", String(claudeArgs.maxTurns));
```

### Files Changed

- `src/types.ts` — add `ClaudeArgs` interface, add `claudeArgs` field to `Task`
- `src/claude-runner.ts` — `RunOptions` gains `claudeArgs`, `run()` translates to spawn args
- `src/task-store.ts` — `addTask()` accepts and persists `claudeArgs`
- `src/index.ts` — `add` command gains `--model`, `--permission-mode`, `--allowedTools`, `--max-turns` options

### Backward Compatibility

- `claudeArgs` is nullable — existing tasks without it work unchanged
- `ClaudeRunner` only appends flags when values are provided
- No migration needed for existing `tasks.json` files

## Feature 2: Background Daemon Mode

### CLI Usage

```bash
auto-worker start -d              # start in background (detached)
auto-worker start --detach        # same as -d
auto-worker start                 # foreground (existing behavior unchanged)
auto-worker stop                  # stops background scheduler
auto-worker logs                  # tail scheduler log
auto-worker logs -f               # follow (stream) scheduler log
```

### Implementation

When `--detach` is passed:

1. Parent process spawns a child: `node dist/index.js start --detached` (internal flag)
2. Child has `detached: true`, `stdio` redirected to log file
3. Parent writes child PID to PID file, prints confirmation, exits
4. Child runs normal `startLoop()`, logging to `data/logs/scheduler.log`

```
Terminal: auto-worker start -d
  |
  +-- spawn("node", ["dist/index.js", "start", "--detached"],
             { detached: true, stdio: ["ignore", logStream, logStream] })
  +-- write PID file
  +-- print "Scheduler started in background (PID 1234, log: data/logs/scheduler.log)"
  +-- parent exits

Background child:
  +-- normal startLoop()
  +-- console.log/error writes to data/logs/scheduler.log
```

### Log File

- Path: `data/logs/scheduler.log`
- All `console.log` / `console.error` output from scheduler goes to this file
- In foreground mode, output still goes to terminal (no log file)
- `auto-worker logs` reads the last N lines from this file
- `auto-worker logs -f` streams the file (like `tail -f`)

### Files Changed

- `src/index.ts` — `start` command adds `--detach` flag; spawns child when set; adds `logs` command
- `src/scheduler.ts` — no change needed (logging via console is already sufficient; stdio redirect handles file output at spawn level)

### Error Handling

- If PID file already exists and process is alive, refuse to start (print error)
- If PID file exists but process is dead, warn and clean up stale PID file before starting
- Log file directory (`data/logs/`) created automatically

## Out of Scope

- `--max-budget-usd` per task (not selected by user, can add later)
- `--system-prompt` / `--append-system-prompt` per task
- systemd / launchd integration
- Log rotation
