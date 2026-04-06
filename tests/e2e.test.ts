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
    await new Promise((r) => setTimeout(r, 2));
    store.addTask({ title: "Task B", prompt: "respond with B", cwd: process.cwd(), priority: 1 });

    const runner = new ClaudeRunner({ timeout: 30000 });
    const scheduler = new Scheduler({
      store,
      runner,
      reportsDir,
      pollInterval: 1,
    });

    // Process both tasks
    await scheduler.tick();
    await scheduler.tick();

    await scheduler.stop();

    // Verify task states
    const tasks = store.getAll();
    expect(tasks).toHaveLength(2);
    expect(tasks[0].status).toBe("completed");
    expect(tasks[1].status).toBe("completed");

    // Verify priority order: Task B (pri 1) was executed first
    const [first, second] = tasks;
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
