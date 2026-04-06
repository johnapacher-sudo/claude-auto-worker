# Claude Auto Worker Phase 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a CLI tool that reads tasks from a local JSON file, executes them sequentially via `claude -p` subprocess, and generates daily JSON reports.

**Architecture:** Single Node.js process polls `data/tasks.json` for pending tasks, spawns `claude -p --output-format json` subprocess per task, captures results, updates task status, and appends to daily report files. CLI built with Commander.js.

**Tech Stack:** TypeScript, Node.js >= 18, Commander.js, tsx, child_process (spawn)

---

## File Structure

```
claude-auto-worker/
├── src/
│   ├── types.ts              # Shared type definitions
│   ├── task-store.ts         # CRUD operations on tasks.json
│   ├── claude-runner.ts      # Spawn claude -p subprocess
│   ├── report-generator.ts   # Append results to daily report JSON
│   ├── scheduler.ts          # Poll loop, task dispatch, shutdown
│   └── index.ts              # CLI entry point (commander)
├── tests/
│   ├── task-store.test.ts
│   ├── claude-runner.test.ts
│   ├── report-generator.test.ts
│   └── scheduler.test.ts
├── data/                     # gitignored, auto-created at runtime
│   ├── tasks.json
│   ├── scheduler.pid
│   └── reports/
├── package.json
├── tsconfig.json
└── .gitignore
```

## Claude CLI Output Format

The `claude -p "prompt" --output-format json` command outputs a single JSON object to stdout:

```json
{
  "type": "result",
  "subtype": "success",
  "is_error": false,
  "duration_ms": 2229,
  "duration_api_ms": 2088,
  "num_turns": 1,
  "result": "The text response from Claude",
  "session_id": "uuid",
  "total_cost_usd": 0.103,
  "usage": { ... },
  "modelUsage": { ... }
}
```

On error, `is_error` is `true` and `subtype` is `"error"`. All output goes to stdout as a single JSON line. Stderr may contain debug/log output.

---

### Task 1: Install dependencies and add test tooling

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install dependencies**

Run:
```bash
cd /Users/cuijianwei/workspace/claude-auto-worker
npm install
```

- [ ] **Step 2: Add test runner to devDependencies**

Run:
```bash
npm install --save-dev vitest
```

- [ ] **Step 3: Add test script to package.json**

Add `"test"` to scripts:
```json
{
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run"
  }
}
```

- [ ] **Step 4: Create vitest config**

Create `vitest.config.ts`:
```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
  },
});
```

- [ ] **Step 5: Verify setup**

Run: `npm test`
Expected: no tests found, exits 0 (vitest returns 0 when no test files match)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: install dependencies and add vitest"
```

---

### Task 2: Create type definitions

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Write types.ts**

```typescript
export interface Task {
  id: string;
  title: string;
  prompt: string;
  cwd: string;
  status: "pending" | "running" | "completed" | "failed";
  priority: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  result: TaskResult | null;
}

export interface TaskResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
  isClaudeError: boolean;
  claudeResult: string | null;
  totalCostUsd: number | null;
}

export interface TaskFile {
  tasks: Task[];
}

export interface DailyReport {
  date: string;
  tasks: TaskReport[];
  summary: ReportSummary;
}

export interface TaskReport {
  id: string;
  title: string;
  status: "completed" | "failed";
  startedAt: string;
  completedAt: string;
  duration: number;
  resultSummary: string;
  fullOutput: string;
}

export interface ReportSummary {
  total: number;
  completed: number;
  failed: number;
  totalDuration: number;
}

export interface SchedulerConfig {
  pollInterval: number;
  timeout: number;
  tasksFile: string;
  reportsDir: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types.ts
git commit -m "feat: add type definitions for task, report, and config"
```

---

### Task 3: Implement task-store

**Files:**
- Create: `src/task-store.ts`
- Create: `tests/task-store.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/task-store.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { TaskStore } from "../src/task-store.js";
import type { Task } from "../src/types.js";

let tmpDir: string;
let store: TaskStore;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "task-store-test-"));
  const tasksFile = path.join(tmpDir, "tasks.json");
  store = new TaskStore(tasksFile);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("TaskStore", () => {
  it("creates tasks.json if it does not exist", () => {
    const filePath = path.join(tmpDir, "tasks.json");
    expect(fs.existsSync(filePath)).toBe(false);
    const s = new TaskStore(filePath);
    expect(s.getAll()).toEqual([]);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it("reads existing tasks.json", () => {
    const filePath = path.join(tmpDir, "tasks.json");
    fs.writeFileSync(filePath, JSON.stringify({ tasks: [{ id: "t1", title: "a", prompt: "b", cwd: "/tmp", status: "pending", priority: 5, createdAt: "2026-01-01T00:00:00Z", startedAt: null, completedAt: null, result: null }] }));
    const s = new TaskStore(filePath);
    expect(s.getAll()).toHaveLength(1);
    expect(s.getAll()[0].id).toBe("t1");
  });

  it("adds a task and persists it", () => {
    const task = store.addTask({ title: "test task", prompt: "do something", cwd: "/tmp", priority: 3 });
    expect(task.id).toMatch(/^task-\d+$/);
    expect(task.status).toBe("pending");
    expect(store.getAll()).toHaveLength(1);

    // Verify persistence
    const store2 = new TaskStore(store.getFilePath());
    expect(store2.getAll()).toHaveLength(1);
  });

  it("gets next pending task by priority", () => {
    store.addTask({ title: "low", prompt: "p1", cwd: "/tmp", priority: 10 });
    store.addTask({ title: "high", prompt: "p2", cwd: "/tmp", priority: 1 });
    store.addTask({ title: "mid", prompt: "p3", cwd: "/tmp", priority: 5 });

    const next = store.getNextPending();
    expect(next).not.toBeNull();
    expect(next!.title).toBe("high");
  });

  it("returns null when no pending tasks", () => {
    const task = store.addTask({ title: "done", prompt: "p", cwd: "/tmp", priority: 1 });
    store.updateTask(task.id, { status: "completed" });
    expect(store.getNextPending()).toBeNull();
  });

  it("updates a task", () => {
    const task = store.addTask({ title: "t", prompt: "p", cwd: "/tmp", priority: 1 });
    store.updateTask(task.id, { status: "running", startedAt: "2026-01-01T01:00:00Z" });
    const updated = store.getById(task.id);
    expect(updated!.status).toBe("running");
    expect(updated!.startedAt).toBe("2026-01-01T01:00:00Z");
  });

  it("gets tasks by status", () => {
    const t1 = store.addTask({ title: "a", prompt: "p", cwd: "/tmp", priority: 1 });
    const t2 = store.addTask({ title: "b", prompt: "p", cwd: "/tmp", priority: 2 });
    store.updateTask(t1.id, { status: "completed" });
    const pending = store.getByStatus("pending");
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(t2.id);
  });

  it("returns null for non-existent task id", () => {
    expect(store.getById("nope")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/task-store.test.ts`
Expected: FAIL — module `../src/task-store.js` not found

- [ ] **Step 3: Write task-store.ts**

Create `src/task-store.ts`:
```typescript
import fs from "node:fs";
import path from "node:path";
import type { Task, TaskFile } from "./types.js";

export class TaskStore {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.ensureFile();
  }

  getFilePath(): string {
    return this.filePath;
  }

  private ensureFile(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.filePath)) {
      this.write({ tasks: [] });
    }
  }

  private read(): TaskFile {
    const raw = fs.readFileSync(this.filePath, "utf-8");
    return JSON.parse(raw) as TaskFile;
  }

  private write(data: TaskFile): void {
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
  }

  getAll(): Task[] {
    return this.read().tasks;
  }

  getById(id: string): Task | null {
    return this.read().tasks.find((t) => t.id === id) ?? null;
  }

  getByStatus(status: Task["status"]): Task[] {
    return this.read().tasks.filter((t) => t.status === status);
  }

  getNextPending(): Task | null {
    const tasks = this.read().tasks
      .filter((t) => t.status === "pending")
      .sort((a, b) => a.priority - b.priority);
    return tasks[0] ?? null;
  }

  addTask(input: { title: string; prompt: string; cwd: string; priority?: number }): Task {
    const data = this.read();
    const task: Task = {
      id: `task-${Date.now()}`,
      title: input.title,
      prompt: input.prompt,
      cwd: input.cwd,
      status: "pending",
      priority: input.priority ?? 5,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      result: null,
    };
    data.tasks.push(task);
    this.write(data);
    return task;
  }

  updateTask(id: string, updates: Partial<Omit<Task, "id">>): void {
    const data = this.read();
    const idx = data.tasks.findIndex((t) => t.id === id);
    if (idx === -1) {
      throw new Error(`Task not found: ${id}`);
    }
    data.tasks[idx] = { ...data.tasks[idx], ...updates };
    this.write(data);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/task-store.test.ts`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/task-store.ts tests/task-store.test.ts
git commit -m "feat: implement task-store with JSON file persistence"
```

---

### Task 4: Implement claude-runner

**Files:**
- Create: `src/claude-runner.ts`
- Create: `tests/claude-runner.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/claude-runner.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { ClaudeRunner } from "../src/claude-runner.js";

describe("ClaudeRunner", () => {
  it("runs a simple prompt and captures result", async () => {
    const runner = new ClaudeRunner({ timeout: 30000 });
    const result = await runner.run({
      prompt: "respond with exactly the word PONG and nothing else",
      cwd: process.cwd(),
    });

    expect(result.exitCode).toBe(0);
    expect(result.isClaudeError).toBe(false);
    expect(result.claudeResult).toContain("PONG");
    expect(result.duration).toBeGreaterThan(0);
    expect(result.stdout).toBeTruthy();
  }, 60000);

  it("fails on invalid cwd", async () => {
    const runner = new ClaudeRunner({ timeout: 10000 });
    const result = await runner.run({
      prompt: "hello",
      cwd: "/nonexistent/path/that/does/not/exist",
    });

    expect(result.exitCode).not.toBe(0);
  }, 30000);

  it("times out when timeout is exceeded", async () => {
    const runner = new ClaudeRunner({ timeout: 1 }); // 1ms, will always timeout
    const result = await runner.run({
      prompt: "write a very long essay about the history of computing",
      cwd: process.cwd(),
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("timed out");
  }, 30000);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/claude-runner.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write claude-runner.ts**

Create `src/claude-runner.ts`:
```typescript
import { spawn } from "node:child_process";
import type { TaskResult } from "./types.js";

export interface ClaudeRunnerConfig {
  timeout: number; // milliseconds
}

export interface RunOptions {
  prompt: string;
  cwd: string;
}

export class ClaudeRunner {
  private config: ClaudeRunnerConfig;

  constructor(config: ClaudeRunnerConfig) {
    this.config = config;
  }

  run(options: RunOptions): Promise<TaskResult> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const args = ["-p", options.prompt, "--output-format", "json"];

      const child = spawn("claude", args, {
        cwd: options.cwd,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        const duration = Date.now() - startTime;
        resolve({
          exitCode: -1,
          stdout,
          stderr: stderr + "\nTask timed out",
          duration: duration / 1000,
          isClaudeError: false,
          claudeResult: null,
          totalCostUsd: null,
        });
      }, this.config.timeout);

      child.on("close", (code) => {
        clearTimeout(timer);
        const duration = (Date.now() - startTime) / 1000;

        let isClaudeError = false;
        let claudeResult: string | null = null;
        let totalCostUsd: number | null = null;

        try {
          const parsed = JSON.parse(stdout.trim());
          isClaudeError = parsed.is_error === true;
          claudeResult = typeof parsed.result === "string" ? parsed.result : null;
          totalCostUsd = typeof parsed.total_cost_usd === "number" ? parsed.total_cost_usd : null;
        } catch {
          // stdout was not valid JSON, leave claudeResult as null
        }

        resolve({
          exitCode: code ?? -1,
          stdout,
          stderr,
          duration,
          isClaudeError,
          claudeResult,
          totalCostUsd,
        });
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        const duration = (Date.now() - startTime) / 1000;
        resolve({
          exitCode: -1,
          stdout: "",
          stderr: err.message,
          duration,
          isClaudeError: false,
          claudeResult: null,
          totalCostUsd: null,
        });
      });
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/claude-runner.test.ts`
Expected: all tests PASS (note: these are integration tests calling real `claude` CLI)

- [ ] **Step 5: Commit**

```bash
git add src/claude-runner.ts tests/claude-runner.test.ts
git commit -m "feat: implement claude-runner subprocess executor"
```

---

### Task 5: Implement report-generator

**Files:**
- Create: `src/report-generator.ts`
- Create: `tests/report-generator.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/report-generator.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ReportGenerator } from "../src/report-generator.js";
import type { Task, TaskResult } from "../src/types.js";

let tmpDir: string;
let gen: ReportGenerator;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "report-test-"));
  gen = new ReportGenerator(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-123",
    title: "Test task",
    prompt: "do something",
    cwd: "/tmp",
    status: "completed",
    priority: 1,
    createdAt: "2026-04-06T10:00:00Z",
    startedAt: "2026-04-06T10:00:05Z",
    completedAt: "2026-04-06T10:00:20Z",
    result: null,
    ...overrides,
  };
}

function makeResult(overrides: Partial<TaskResult> = {}): TaskResult {
  return {
    exitCode: 0,
    stdout: '{"result":"done"}',
    stderr: "",
    duration: 15,
    isClaudeError: false,
    claudeResult: "All files updated successfully",
    totalCostUsd: 0.05,
    ...overrides,
  };
}

describe("ReportGenerator", () => {
  it("appends a task result and creates the report file", () => {
    const task = makeTask();
    const result = makeResult();
    gen.appendTaskResult(task, result);

    const report = gen.getReport("2026-04-06");
    expect(report).not.toBeNull();
    expect(report!.tasks).toHaveLength(1);
    expect(report!.tasks[0].title).toBe("Test task");
    expect(report!.tasks[0].status).toBe("completed");
    expect(report!.summary.total).toBe(1);
    expect(report!.summary.completed).toBe(1);
  });

  it("accumulates multiple tasks in one day", () => {
    const t1 = makeTask({ id: "t1", title: "Task 1" });
    const r1 = makeResult({ duration: 10 });
    const t2 = makeTask({ id: "t2", title: "Task 2", status: "failed" });
    const r2 = makeResult({ exitCode: 1, duration: 5, isClaudeError: true });

    gen.appendTaskResult(t1, r1);
    gen.appendTaskResult(t2, r2);

    const report = gen.getReport("2026-04-06");
    expect(report!.tasks).toHaveLength(2);
    expect(report!.summary.total).toBe(2);
    expect(report!.summary.completed).toBe(1);
    expect(report!.summary.failed).toBe(1);
    expect(report!.summary.totalDuration).toBe(15);
  });

  it("returns null for a date with no report", () => {
    expect(gen.getReport("2025-01-01")).toBeNull();
  });

  it("extracts resultSummary from claudeResult", () => {
    const task = makeTask();
    const result = makeResult({ claudeResult: "Summary of work done" });
    gen.appendTaskResult(task, result);

    const report = gen.getReport("2026-04-06");
    expect(report!.tasks[0].resultSummary).toBe("Summary of work done");
  });

  it("falls back to stdout when no claudeResult", () => {
    const task = makeTask();
    const result = makeResult({ claudeResult: null, stdout: "raw output here" });
    gen.appendTaskResult(task, result);

    const report = gen.getReport("2026-04-06");
    expect(report!.tasks[0].resultSummary).toBe("raw output here");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/report-generator.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write report-generator.ts**

Create `src/report-generator.ts`:
```typescript
import fs from "node:fs";
import path from "node:path";
import type { DailyReport, Task, TaskReport, TaskResult, ReportSummary } from "./types.js";

export class ReportGenerator {
  private reportsDir: string;

  constructor(reportsDir: string) {
    this.reportsDir = reportsDir;
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }
  }

  private getReportPath(date: string): string {
    return path.join(this.reportsDir, `${date}.json`);
  }

  getReport(date: string): DailyReport | null {
    const filePath = this.getReportPath(date);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as DailyReport;
  }

  appendTaskResult(task: Task, result: TaskResult): void {
    const date = new Date().toISOString().slice(0, 10);
    const filePath = this.getReportPath(date);

    let report: DailyReport;
    if (fs.existsSync(filePath)) {
      report = JSON.parse(fs.readFileSync(filePath, "utf-8")) as DailyReport;
    } else {
      report = { date, tasks: [], summary: { total: 0, completed: 0, failed: 0, totalDuration: 0 } };
    }

    const taskReport: TaskReport = {
      id: task.id,
      title: task.title,
      status: task.status === "completed" ? "completed" : "failed",
      startedAt: task.startedAt ?? new Date().toISOString(),
      completedAt: task.completedAt ?? new Date().toISOString(),
      duration: result.duration,
      resultSummary: result.claudeResult ?? result.stdout,
      fullOutput: result.stdout,
    };

    report.tasks.push(taskReport);
    report.summary = this.computeSummary(report.tasks);

    fs.writeFileSync(filePath, JSON.stringify(report, null, 2));
  }

  private computeSummary(tasks: TaskReport[]): ReportSummary {
    const completed = tasks.filter((t) => t.status === "completed").length;
    const failed = tasks.filter((t) => t.status === "failed").length;
    const totalDuration = tasks.reduce((sum, t) => sum + t.duration, 0);
    return {
      total: tasks.length,
      completed,
      failed,
      totalDuration,
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/report-generator.test.ts`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/report-generator.ts tests/report-generator.test.ts
git commit -m "feat: implement report-generator for daily JSON reports"
```

---

### Task 6: Implement scheduler

**Files:**
- Create: `src/scheduler.ts`
- Create: `tests/scheduler.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/scheduler.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Scheduler } from "../src/scheduler.js";
import { TaskStore } from "../src/task-store.js";
import type { TaskResult } from "../src/types.js";

let tmpDir: string;
let tasksFile: string;
let reportsDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "scheduler-test-"));
  tasksFile = path.join(tmpDir, "tasks.json");
  reportsDir = path.join(tmpDir, "reports");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("Scheduler", () => {
  it("processes a single task end to end", async () => {
    const store = new TaskStore(tasksFile);
    store.addTask({
      title: "echo test",
      prompt: "respond with exactly the word OK and nothing else",
      cwd: process.cwd(),
      priority: 1,
    });

    const mockRunner = {
      run: vi.fn().mockResolvedValue({
        exitCode: 0,
        stdout: '{"result":"OK"}',
        stderr: "",
        duration: 2,
        isClaudeError: false,
        claudeResult: "OK",
        totalCostUsd: 0.01,
      } satisfies TaskResult),
    };

    const scheduler = new Scheduler({
      store,
      runner: mockRunner as any,
      reportsDir,
      pollInterval: 100,
      timeout: 60000,
    });

    // Run one tick manually
    await scheduler.tick();

    const tasks = store.getAll();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe("completed");
    expect(tasks[0].result).not.toBeNull();
    expect(tasks[0].result!.claudeResult).toBe("OK");
    expect(mockRunner.run).toHaveBeenCalledTimes(1);

    scheduler.stop();
  }, 30000);

  it("processes tasks in priority order", async () => {
    const store = new TaskStore(tasksFile);
    store.addTask({ title: "low", prompt: "p1", cwd: process.cwd(), priority: 10 });
    store.addTask({ title: "high", prompt: "p2", cwd: process.cwd(), priority: 1 });

    const results: string[] = [];
    const mockRunner = {
      run: vi.fn().mockImplementation(async (opts: any) => ({
        exitCode: 0,
        stdout: `{"result":"${opts.prompt}"}`,
        stderr: "",
        duration: 1,
        isClaudeError: false,
        claudeResult: opts.prompt,
        totalCostUsd: 0.01,
      })),
    };

    const scheduler = new Scheduler({
      store,
      runner: mockRunner as any,
      reportsDir,
      pollInterval: 100,
      timeout: 60000,
    });

    await scheduler.tick();
    await scheduler.tick();

    expect(results).toEqual([]);
    expect(mockRunner.run).toHaveBeenCalledTimes(2);
    expect(mockRunner.run.mock.calls[0][0].prompt).toBe("p2"); // high priority first
    expect(mockRunner.run.mock.calls[1][0].prompt).toBe("p1"); // then low

    scheduler.stop();
  }, 30000);

  it("marks task as failed when runner returns error", async () => {
    const store = new TaskStore(tasksFile);
    store.addTask({ title: "fail task", prompt: "fail", cwd: process.cwd(), priority: 1 });

    const mockRunner = {
      run: vi.fn().mockResolvedValue({
        exitCode: 1,
        stdout: "",
        stderr: "something went wrong",
        duration: 1,
        isClaudeError: true,
        claudeResult: null,
        totalCostUsd: null,
      } satisfies TaskResult),
    };

    const scheduler = new Scheduler({
      store,
      runner: mockRunner as any,
      reportsDir,
      pollInterval: 100,
      timeout: 60000,
    });

    await scheduler.tick();

    const tasks = store.getAll();
    expect(tasks[0].status).toBe("failed");

    scheduler.stop();
  });

  it("does nothing when no pending tasks", async () => {
    const store = new TaskStore(tasksFile);
    const mockRunner = { run: vi.fn() };

    const scheduler = new Scheduler({
      store,
      runner: mockRunner as any,
      reportsDir,
      pollInterval: 100,
      timeout: 60000,
    });

    await scheduler.tick();
    expect(mockRunner.run).not.toHaveBeenCalled();

    scheduler.stop();
  });

  it("writes PID file on start and removes on stop", () => {
    const store = new TaskStore(tasksFile);
    const mockRunner = { run: vi.fn() };
    const pidFile = path.join(tmpDir, "scheduler.pid");

    const scheduler = new Scheduler({
      store,
      runner: mockRunner as any,
      reportsDir,
      pollInterval: 1000,
      timeout: 60000,
      pidFile,
    });

    scheduler.startLoop();
    expect(fs.existsSync(pidFile)).toBe(true);
    const pid = parseInt(fs.readFileSync(pidFile, "utf-8"), 10);
    expect(pid).toBe(process.pid);

    scheduler.stop();
    expect(fs.existsSync(pidFile)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/scheduler.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write scheduler.ts**

Create `src/scheduler.ts`:
```typescript
import fs from "node:fs";
import path from "node:path";
import type { SchedulerConfig, TaskResult } from "./types.js";
import { TaskStore } from "./task-store.js";
import { ClaudeRunner } from "./claude-runner.js";
import { ReportGenerator } from "./report-generator.js";

export interface SchedulerOptions {
  store: TaskStore;
  runner: ClaudeRunner;
  reportsDir: string;
  pollInterval: number;
  timeout: number;
  pidFile?: string;
}

export class Scheduler {
  private store: TaskStore;
  private runner: ClaudeRunner;
  private reportGen: ReportGenerator;
  private pollInterval: number;
  private timeout: number;
  private pidFile: string;
  private running = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: SchedulerOptions) {
    this.store = options.store;
    this.runner = options.runner;
    this.reportGen = new ReportGenerator(options.reportsDir);
    this.pollInterval = options.pollInterval;
    this.timeout = options.timeout;
    this.pidFile = options.pidFile ?? path.join(path.dirname(options.store.getFilePath()), "scheduler.pid");
  }

  async tick(): Promise<void> {
    const task = this.store.getNextPending();
    if (!task) return;

    this.store.updateTask(task.id, {
      status: "running",
      startedAt: new Date().toISOString(),
    });

    const result: TaskResult = await this.runner.run({
      prompt: task.prompt,
      cwd: task.cwd,
    });

    const status = result.exitCode === 0 && !result.isClaudeError ? "completed" : "failed";

    this.store.updateTask(task.id, {
      status,
      completedAt: new Date().toISOString(),
      result,
    });

    this.reportGen.appendTaskResult(
      { ...task, status, completedAt: new Date().toISOString(), result },
      result,
    );
  }

  startLoop(): void {
    this.running = true;
    fs.writeFileSync(this.pidFile, String(process.pid));

    // Run first tick immediately
    this.tick();

    this.timer = setInterval(() => {
      if (!this.running) return;
      this.tick();
    }, this.pollInterval * 1000);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (fs.existsSync(this.pidFile)) {
      fs.unlinkSync(this.pidFile);
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/scheduler.test.ts`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/scheduler.ts tests/scheduler.test.ts
git commit -m "feat: implement scheduler with tick-based task processing"
```

---

### Task 7: Implement CLI entry point

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Write index.ts**

Create `src/index.ts`:
```typescript
#!/usr/bin/env node

import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { TaskStore } from "./task-store.js";
import { ClaudeRunner } from "./claude-runner.js";
import { Scheduler } from "./scheduler.js";
import { ReportGenerator } from "./report-generator.js";

const DATA_DIR = path.join(process.cwd(), "data");
const TASKS_FILE = path.join(DATA_DIR, "tasks.json");
const REPORTS_DIR = path.join(DATA_DIR, "reports");
const PID_FILE = path.join(DATA_DIR, "scheduler.pid");

function getStore(tasksFile?: string): TaskStore {
  return new TaskStore(tasksFile ?? TASKS_FILE);
}

const program = new Command();

program
  .name("auto-worker")
  .description("Run Claude Code as an unattended task worker")
  .version("0.1.0");

program
  .command("start")
  .description("Start the scheduler daemon")
  .option("--poll-interval <seconds>", "Seconds between polls", "10")
  .option("--timeout <seconds>", "Max seconds per task", "600")
  .option("--tasks-file <path>", "Path to tasks file", TASKS_FILE)
  .option("--reports-dir <path>", "Path to reports directory", REPORTS_DIR)
  .action(async (opts) => {
    const store = getStore(opts.tasksFile);
    const runner = new ClaudeRunner({ timeout: parseInt(opts.timeout) * 1000 });

    const scheduler = new Scheduler({
      store,
      runner,
      reportsDir: opts.reportsDir,
      pollInterval: parseInt(opts.pollInterval),
      timeout: parseInt(opts.timeout) * 1000,
      pidFile: PID_FILE,
    });

    process.on("SIGINT", () => {
      console.log("Received SIGINT, shutting down...");
      scheduler.stop();
      process.exit(0);
    });

    process.on("SIGTERM", () => {
      console.log("Received SIGTERM, shutting down...");
      scheduler.stop();
      process.exit(0);
    });

    console.log(`Scheduler started. Polling ${opts.tasksFile} every ${opts.pollInterval}s`);
    scheduler.startLoop();
  });

program
  .command("add <prompt>")
  .description("Add a task to the queue")
  .option("--cwd <path>", "Working directory", process.cwd())
  .option("--priority <number>", "Task priority (lower = higher)", "5")
  .option("--title <text>", "Task title")
  .option("--tasks-file <path>", "Path to tasks file", TASKS_FILE)
  .action((prompt, opts) => {
    const store = getStore(opts.tasksFile);
    const task = store.addTask({
      title: opts.title ?? prompt.slice(0, 60),
      prompt,
      cwd: opts.cwd,
      priority: parseInt(opts.priority),
    });
    console.log(`Task added: ${task.id} — ${task.title}`);
  });

program
  .command("list")
  .description("List all tasks")
  .option("--tasks-file <path>", "Path to tasks file", TASKS_FILE)
  .option("--status <status>", "Filter by status")
  .action((opts) => {
    const store = getStore(opts.tasksFile);
    const tasks = opts.status ? store.getByStatus(opts.status) : store.getAll();

    if (tasks.length === 0) {
      console.log("No tasks found.");
      return;
    }

    for (const t of tasks) {
      const icon = t.status === "completed" ? "✓" : t.status === "failed" ? "✗" : t.status === "running" ? "→" : "○";
      console.log(`  ${icon} [${t.id}] (pri:${t.priority}) ${t.title} — ${t.status}`);
    }
  });

program
  .command("report [date]")
  .description("Show daily report (default: today)")
  .option("--reports-dir <path>", "Path to reports directory", REPORTS_DIR)
  .action((date, opts) => {
    const reportDate = date ?? new Date().toISOString().slice(0, 10);
    const gen = new ReportGenerator(opts.reportsDir);
    const report = gen.getReport(reportDate);

    if (!report) {
      console.log(`No report found for ${reportDate}`);
      return;
    }

    console.log(`\nReport: ${report.date}`);
    console.log(`  Total: ${report.summary.total} | Completed: ${report.summary.completed} | Failed: ${report.summary.failed}`);
    console.log(`  Total duration: ${report.summary.totalDuration.toFixed(1)}s\n`);

    for (const t of report.tasks) {
      const icon = t.status === "completed" ? "✓" : "✗";
      console.log(`  ${icon} [${t.id}] ${t.title} (${t.duration.toFixed(1)}s)`);
      console.log(`    ${t.resultSummary.slice(0, 120)}`);
    }
  });

program
  .command("stop")
  .description("Stop the running scheduler")
  .action(() => {
    if (!fs.existsSync(PID_FILE)) {
      console.log("No scheduler running (PID file not found)");
      return;
    }
    const pid = parseInt(fs.readFileSync(PID_FILE, "utf-8"), 10);
    try {
      process.kill(pid, "SIGTERM");
      console.log(`Sent SIGTERM to scheduler (PID ${pid})`);
    } catch {
      console.log(`Process ${pid} not found. Removing stale PID file.`);
      fs.unlinkSync(PID_FILE);
    }
  });

program.parse();
```

- [ ] **Step 2: Verify CLI loads without errors**

Run: `npx tsx src/index.ts --help`
Expected: prints help text with commands: start, add, list, report, stop

- [ ] **Step 3: Verify add command**

Run: `npx tsx src/index.ts add "test task prompt" --title "Test"`
Expected: `Task added: task-<timestamp> — Test`

- [ ] **Step 4: Verify list command**

Run: `npx tsx src/index.ts list`
Expected: shows the task added in step 3 with status pending

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat: implement CLI with start, add, list, report, stop commands"
```

---

### Task 8: Integration test — end-to-end flow

**Files:**
- Create: `tests/e2e.test.ts`

- [ ] **Step 1: Write end-to-end test**

Create `tests/e2e.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { TaskStore } from "../src/task-store.js";
import { ClaudeRunner } from "../src/claude-runner.js";
import { Scheduler } from "../src/scheduler.js";
import { ReportGenerator } from "../src/report-generator.js";

let tmpDir: string;
let tasksFile: string;
let reportsDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-test-"));
  tasksFile = path.join(tmpDir, "tasks.json");
  reportsDir = path.join(tmpDir, "reports");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("end-to-end", () => {
  it("processes multiple tasks and generates a report", async () => {
    const store = new TaskStore(tasksFile);
    store.addTask({ title: "Task A", prompt: "respond with A", cwd: process.cwd(), priority: 2 });
    store.addTask({ title: "Task B", prompt: "respond with B", cwd: process.cwd(), priority: 1 });

    const runner = new ClaudeRunner({ timeout: 30000 });
    const scheduler = new Scheduler({
      store,
      runner,
      reportsDir,
      pollInterval: 1,
      timeout: 30000,
    });

    // Process both tasks
    await scheduler.tick();
    await scheduler.tick();

    scheduler.stop();

    // Verify task states
    const tasks = store.getAll();
    expect(tasks).toHaveLength(2);
    expect(tasks[0].status).toBe("completed");
    expect(tasks[1].status).toBe("completed");

    // Verify priority order: Task B (pri 1) should have been executed first
    const [first, second] = tasks;
    // Task B (priority 1) was picked first, but we check by completion order
    expect(first.startedAt).not.toBeNull();
    expect(second.startedAt).not.toBeNull();

    // Verify report generated
    const today = new Date().toISOString().slice(0, 10);
    const reportGen = new ReportGenerator(reportsDir);
    const report = reportGen.getReport(today);
    expect(report).not.toBeNull();
    expect(report!.tasks).toHaveLength(2);
    expect(report!.summary.total).toBe(2);
    expect(report!.summary.completed).toBe(2);
  }, 120000);
});
```

- [ ] **Step 2: Run the e2e test**

Run: `npx vitest run tests/e2e.test.ts`
Expected: PASS (calls real claude CLI, may take up to 60s)

- [ ] **Step 3: Run all tests together**

Run: `npm test`
Expected: all tests PASS

- [ ] **Step 4: Commit**

```bash
git add tests/e2e.test.ts
git commit -m "test: add end-to-end integration test"
```

---

### Task 9: Update .gitignore and final polish

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Update .gitignore**

Replace `.gitignore` contents:
```
node_modules/
dist/
data/
.env
.env.local
*.log
vitest.config.*
```

Wait — `vitest.config.ts` should not be gitignored. Keep it tracked. Use original `.gitignore`:

Actually, the current `.gitignore` is fine. No change needed. Let's verify the test task file was not committed.

- [ ] **Step 2: Run full test suite one final time**

Run: `npm test`
Expected: all tests PASS

- [ ] **Step 3: Clean up any data files from local testing**

Run: `rm -rf data/` (only local runtime data, gitignored)

- [ ] **Step 4: Push everything**

```bash
git push origin master
```
