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
    });

    await scheduler.tick();

    const tasks = store.getAll();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe("completed");
    expect(tasks[0].result).not.toBeNull();
    expect(tasks[0].result!.claudeResult).toBe("OK");
    expect(mockRunner.run).toHaveBeenCalledTimes(1);

    await scheduler.stop();
  }, 30000);

  it("processes tasks in priority order", async () => {
    const store = new TaskStore(tasksFile);
    store.addTask({ title: "low", prompt: "p1", cwd: process.cwd(), priority: 10 });
    await new Promise((r) => setTimeout(r, 2));
    store.addTask({ title: "high", prompt: "p2", cwd: process.cwd(), priority: 1 });

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
    });

    await scheduler.tick();
    await scheduler.tick();

    expect(mockRunner.run).toHaveBeenCalledTimes(2);
    expect(mockRunner.run.mock.calls[0][0].prompt).toBe("p2"); // high priority first
    expect(mockRunner.run.mock.calls[1][0].prompt).toBe("p1"); // then low

    await scheduler.stop();
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
    });

    await scheduler.tick();

    const tasks = store.getAll();
    expect(tasks[0].status).toBe("failed");

    await scheduler.stop();
  });

  it("does nothing when no pending tasks", async () => {
    const store = new TaskStore(tasksFile);
    const mockRunner = { run: vi.fn() };

    const scheduler = new Scheduler({
      store,
      runner: mockRunner as any,
      reportsDir,
      pollInterval: 100,
    });

    await scheduler.tick();
    expect(mockRunner.run).not.toHaveBeenCalled();

    await scheduler.stop();
  });

  it("writes PID file on start and removes on stop", async () => {
    const store = new TaskStore(tasksFile);
    const mockRunner = { run: vi.fn() };
    const pidFile = path.join(tmpDir, "scheduler.pid");

    const scheduler = new Scheduler({
      store,
      runner: mockRunner as any,
      reportsDir,
      pollInterval: 1000,
      pidFile,
    });

    scheduler.startLoop();
    expect(fs.existsSync(pidFile)).toBe(true);
    const pid = parseInt(fs.readFileSync(pidFile, "utf-8"), 10);
    expect(pid).toBe(process.pid);

    await scheduler.stop();
    expect(fs.existsSync(pidFile)).toBe(false);
  });

  it("passes task claudeArgs to runner", async () => {
    const store = new TaskStore(tasksFile);
    store.addTask({
      title: "task with args",
      prompt: "do stuff",
      cwd: process.cwd(),
      priority: 1,
      claudeArgs: { model: "opus", maxTurns: 3 },
    });

    const mockRunner = {
      run: vi.fn().mockResolvedValue({
        exitCode: 0,
        stdout: '{"result":"done"}',
        stderr: "",
        duration: 1,
        isClaudeError: false,
        claudeResult: "done",
        totalCostUsd: 0.01,
      } satisfies TaskResult),
    };

    const scheduler = new Scheduler({
      store,
      runner: mockRunner as any,
      reportsDir,
      pollInterval: 100,
    });

    await scheduler.tick();

    expect(mockRunner.run).toHaveBeenCalledTimes(1);
    expect(mockRunner.run.mock.calls[0][0].claudeArgs).toEqual({ model: "opus", maxTurns: 3 });

    await scheduler.stop();
  });

  it("prevents concurrent tick execution", async () => {
    const store = new TaskStore(tasksFile);
    store.addTask({ title: "task 1", prompt: "p1", cwd: process.cwd(), priority: 1 });
    await new Promise((r) => setTimeout(r, 2));
    store.addTask({ title: "task 2", prompt: "p2", cwd: process.cwd(), priority: 2 });

    let resolveFirst: () => void;
    const firstPromise = new Promise<void>((r) => { resolveFirst = r; });

    const mockRunner = {
      run: vi.fn()
        .mockImplementationOnce(async () => {
          await firstPromise;
          return { exitCode: 0, stdout: '{"result":"1"}', stderr: "", duration: 1, isClaudeError: false, claudeResult: "1", totalCostUsd: 0.01 };
        })
        .mockImplementationOnce(async () => ({
          exitCode: 0, stdout: '{"result":"2"}', stderr: "", duration: 1, isClaudeError: false, claudeResult: "2", totalCostUsd: 0.01,
        })),
    };

    const scheduler = new Scheduler({
      store,
      runner: mockRunner as any,
      reportsDir,
      pollInterval: 100,
    });

    // Start first tick (will hang)
    const tick1 = scheduler.tick();
    // Try second tick while first is still running
    await scheduler.tick(); // should return immediately due to busy flag
    expect(mockRunner.run).toHaveBeenCalledTimes(1);

    // Resolve first tick
    resolveFirst!();
    await tick1;

    // Now second tick should proceed
    await scheduler.tick();
    expect(mockRunner.run).toHaveBeenCalledTimes(2);

    await scheduler.stop();
  });
});
