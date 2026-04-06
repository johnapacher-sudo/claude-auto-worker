# Claude Auto Worker

Run Claude Code as an unattended task worker — automatically execute a queue of tasks, collect results, and generate daily reports.

## How It Works

Claude Auto Worker is a Node.js daemon that:

1. **Polls** a local task file (`data/tasks.json`) for pending tasks
2. **Executes** each task sequentially via `claude -p` subprocess
3. **Collects** results and generates daily JSON reports
4. **Repeats** until all tasks are done, then idles and waits for new ones

Each task runs in a fresh Claude Code subprocess — no context leakage between tasks.

## Quick Start

```bash
# Install dependencies
npm install

# Start the worker daemon
npx auto-worker start

# Add tasks manually
npx auto-worker add "Implement user login with JWT auth" --cwd /path/to/project
npx auto-worker add "Fix the failing tests in src/auth" --priority 1

# Check task queue
npx auto-worker list

# View daily report
npx auto-worker report
```

## Task File Format

Tasks are stored in `data/tasks.json`:

```json
{
  "tasks": [
    {
      "id": "task-001",
      "title": "Implement user login",
      "prompt": "Implement user login with JWT authentication...",
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

### Task States

| State | Description |
|-------|-------------|
| `pending` | Queued, waiting to be executed |
| `running` | Claude subprocess is active |
| `completed` | Finished successfully |
| `failed` | Finished with error or timeout |

## CLI Commands

| Command | Description |
|---------|-------------|
| `auto-worker start` | Start the scheduler daemon |
| `auto-worker add <prompt>` | Add a task to the queue |
| `auto-worker list` | Show all tasks and their status |
| `auto-worker report [date]` | Show daily execution report |
| `auto-worker stop` | Stop the running scheduler |

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--cwd <path>` | Current directory | Working directory for task execution |
| `--priority <n>` | 5 | Task priority (lower = higher priority) |
| `--title <text>` | Auto-generated | Task title |
| `--poll-interval <sec>` | 10 | Seconds between polls |
| `--timeout <sec>` | 600 | Max execution time per task |

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  Scheduler                       │
│  (polls tasks.json every N seconds)             │
└──────────┬──────────────────────┬───────────────┘
           │                      │
           ▼                      ▼
    ┌─────────────┐      ┌───────────────┐
    │  Task Store  │      │ Claude Runner  │
    │ (tasks.json) │      │ (claude -p)   │
    └─────────────┘      └───────┬───────┘
                                  │
                                  ▼
                         ┌───────────────┐
                         │    Report      │
                         │  Generator     │
                         └───────────────┘
```

## Phase Roadmap

### Phase 1: Local MVP (Current)

- Local task file management
- Single-process scheduler
- Claude subprocess execution
- Daily JSON reports

### Phase 2: Feishu Integration

- Feishu bot webhook for task creation
- AI-based message classification
- Status notifications back to Feishu

### Phase 3: Report Deployment

- HTML report conversion
- Vercel auto-deployment
- Web-accessible daily reports

## Prerequisites

- Node.js >= 18
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (`npm install -g @anthropic-ai/claude-code`)

## License

MIT
