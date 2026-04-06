# Claude Auto Worker - Design Spec

## Summary

Claude Auto Worker is a Node.js-based task automation tool that runs Claude Code as an unattended worker. It reads tasks from a local JSON file, executes them sequentially via `claude -p` subprocess calls, collects results, and generates daily reports. Designed as a single-process scheduler for simplicity, with phased expansion to Feishu integration and Vercel-deployed reports.

## Problem Statement

Manual Claude Code usage requires constant human attention. When multiple tasks need execution (e.g., batch code generation, automated fixes, scheduled investigations), a human must start each session individually. Claude Auto Worker eliminates this bottleneck by creating an autonomous task execution loop.

## Architecture

### Core Flow

```
tasks.json (poll) → Scheduler → claude -p subprocess → Result collection → Daily report
```

### Single-Process Scheduler (Phase 1)

One Node.js process handles everything:

1. **Poll** tasks.json every N seconds
2. **Pick** the highest-priority pending task
3. **Execute** via `claude -p "prompt" --output-format json --cwd <path>`
4. **Collect** stdout/stderr, parse structured output
5. **Update** task status and results in tasks.json
6. **Append** to daily report file
7. **Repeat** until no pending tasks remain, then idle-poll

Each task runs in a fresh subprocess — context isolation is inherent.

### Project Structure

```
claude-auto-worker/
├── src/
│   ├── index.ts              # Entry point, CLI bootstrap
│   ├── scheduler.ts          # Core scheduling loop
│   ├── task-store.ts         # Task file read/write operations
│   ├── claude-runner.ts      # claude -p subprocess executor
│   ├── report-generator.ts   # Daily report generation
│   └── types.ts              # TypeScript type definitions
├── data/
│   ├── tasks.json            # Task queue file (auto-created)
│   └── reports/              # Daily report storage
│       └── 2026-04-06.json
├── docs/
│   └── superpowers/
│       └── specs/
│           └── 2026-04-06-claude-auto-worker-design.md
├── package.json
├── tsconfig.json
├── .gitignore
└── README.md
```

## Data Model

### Task (tasks.json)

```typescript
interface Task {
  id: string;                  // Unique task ID (e.g., "task-001")
  title: string;               // Human-readable task title
  prompt: string;              // Full prompt for claude -p
  cwd: string;                 // Working directory for execution
  status: "pending" | "running" | "completed" | "failed";
  priority: number;            // Lower number = higher priority
  createdAt: string;           // ISO 8601 timestamp
  startedAt: string | null;    // ISO 8601 timestamp
  completedAt: string | null;  // ISO 8601 timestamp
  result: TaskResult | null;   // Execution result
}

interface TaskResult {
  exitCode: number;            // Process exit code
  stdout: string;              // Raw claude output
  stderr: string;              // Error output
  parsedOutput: any;           // Parsed JSON from --output-format json
  duration: number;            // Execution time in seconds
}
```

### Task File Schema

```json
{
  "tasks": [
    {
      "id": "task-001",
      "title": "Implement user login",
      "prompt": "Implement user login functionality with JWT authentication...",
      "cwd": "/path/to/project",
      "status": "pending",
      "priority": 1,
      "createdAt": "2026-04-06T10:00:00Z",
      "startedAt": null,
      "completedAt": null,
      "result": null
    }
  ]
}
```

### Daily Report

```typescript
interface DailyReport {
  date: string;                // YYYY-MM-DD
  tasks: TaskReport[];
  summary: {
    total: number;
    completed: number;
    failed: number;
    totalDuration: number;     // Total execution time in seconds
  };
}

interface TaskReport {
  id: string;
  title: string;
  status: "completed" | "failed";
  startedAt: string;
  completedAt: string;
  duration: number;
  resultSummary: string;       // Extracted summary from claude output
  fullOutput: string;          // Complete output for reference
}
```

## Module Design

### scheduler.ts — Core Scheduling Loop

- Poll interval: configurable, default 10 seconds
- Task selection: filter `status === "pending"`, sort by `priority` ascending
- Sequential execution: one task at a time, next starts only after previous completes
- Idle behavior: when no pending tasks, sleep and re-poll
- Graceful shutdown: SIGINT/SIGTERM sets a flag, waits for current task to finish

### claude-runner.ts — Claude Subprocess Executor

- Command: `claude -p "<prompt>" --output-format json --cwd <path>`
- Each invocation is a fresh subprocess (no context leakage between tasks)
- Stdout captured and parsed as JSON
- Stderr captured for error reporting
- Timeout: configurable, default 10 minutes per task
- Process killed on timeout, task marked as failed

### task-store.ts — Task File Operations

- Read/write tasks.json with file locking to prevent corruption
- `addTask(task)`: Append a new task
- `updateTask(id, updates)`: Update task fields
- `getNextPending()`: Get highest-priority pending task
- `getTasksByStatus(status)`: Query by status

### report-generator.ts — Daily Report Builder

- Report file: `data/reports/YYYY-MM-DD.json`
- `appendTaskResult(task, result)`: Add completed task to today's report
- `getReport(date)`: Read a specific day's report
- `generateSummary(report)`: Compute totals and summaries
- Phase 3: add HTML conversion using existing html-converter tool

### index.ts — CLI Entry Point

Commands:

```
auto-worker start              # Start the scheduler daemon
auto-worker add <prompt>       # Add a task manually
  --cwd <path>                 # Working directory (default: cwd)
  --priority <n>               # Priority (default: 5)
  --title <text>               # Task title
auto-worker list               # List all tasks
auto-worker report [date]      # Show daily report
auto-worker stop               # Stop the running scheduler
```

## Task State Machine

```
pending → running → completed
                  → failed
```

- `pending`: Task is queued, waiting to be picked up
- `running`: claude subprocess is active
- `completed`: Task finished successfully (exit code 0)
- `failed`: Task finished with error or timeout

Transitions are atomic writes to tasks.json.

## Error Handling

- **Subprocess crash**: Mark task as failed, log stderr, continue to next task
- **Timeout**: Kill subprocess after configurable timeout, mark as failed
- **Corrupt tasks.json**: Log error, skip poll cycle, retry next interval
- **Disk full**: Log error, stop scheduler, alert via stderr

## Configuration

No config file needed for Phase 1. All options via CLI flags and defaults:

| Option | Default | Description |
|--------|---------|-------------|
| `--poll-interval` | 10s | Seconds between polls |
| `--timeout` | 600s | Max seconds per task |
| `--tasks-file` | `data/tasks.json` | Path to task file |
| `--reports-dir` | `data/reports/` | Path to reports directory |

## Technology Choices

| Choice | Selection | Rationale |
|--------|-----------|-----------|
| Language | TypeScript | Type safety, Node.js ecosystem |
| Runtime | Node.js >= 18 | Native child_process for claude CLI |
| CLI Framework | Commander.js | Simple, well-known |
| Build | tsx | Zero-config TypeScript execution |
| No external DB | Local JSON files | MVP simplicity |

## Phase Roadmap

### Phase 1: Local MVP (Current)

- Task file management (CRUD)
- Single-process scheduler with polling
- Claude subprocess executor
- Daily report generation (JSON)
- CLI commands: start, add, list, report

### Phase 2: Feishu Integration

- Lightweight HTTP server (Express or Hono)
- Feishu bot webhook endpoint
- AI-based message classification (task vs. question vs. investigation)
- Auto-create tasks from Feishu @mentions
- Task status notifications back to Feishu

### Phase 3: Report Deployment

- HTML report conversion (integrate existing html-converter)
- Vercel deployment automation (integrate existing reports-site)
- Web-accessible daily report dashboard
- Report sharing via URL

## Key Design Decisions

1. **Sequential execution** over parallel: Simpler error handling, no resource conflicts, easier to debug. Parallel execution can be added later as an option.

2. **Fresh subprocess per task** over persistent session: Each `claude -p` invocation starts clean. No context pollution between tasks. This matches the user's requirement of clearing context between tasks.

3. **Local JSON files** over database: Zero dependencies, human-readable, easy to debug. Migration to SQLite or Redis is straightforward if needed.

4. **File polling** over file watching: More reliable across platforms, easier to reason about, negligible overhead for a single file.

5. **Phase-gated delivery**: Each phase is independently useful. Phase 1 is a complete tool. Phases 2-3 add integrations without breaking Phase 1 functionality.
