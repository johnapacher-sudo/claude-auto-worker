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
