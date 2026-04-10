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
    const subDir = path.join(tmpDir, "sub");
    const filePath = path.join(subDir, "tasks.json");
    expect(fs.existsSync(filePath)).toBe(false);
    const s = new TaskStore(filePath);
    expect(s.getAll()).toEqual([]);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it("reads existing tasks.json", () => {
    const filePath = path.join(tmpDir, "tasks.json");
    fs.writeFileSync(filePath, JSON.stringify({ tasks: [{ id: "t1", title: "a", prompt: "b", cwd: "/tmp", status: "pending", priority: 5, createdAt: "2026-01-01T00:00:00Z", startedAt: null, completedAt: null, result: null, claudeArgs: null }] }));
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

  it("persists claudeArgs with a task", () => {
    const task = store.addTask({
      title: "task with args",
      prompt: "do stuff",
      cwd: "/tmp",
      priority: 1,
      claudeArgs: {
        model: "opus",
        maxTurns: 5,
        allowedTools: ["Bash", "Edit"],
        permissionMode: "auto",
      },
    });

    expect(task.claudeArgs).toEqual({
      model: "opus",
      maxTurns: 5,
      allowedTools: ["Bash", "Edit"],
      permissionMode: "auto",
    });

    // Verify persistence
    const store2 = new TaskStore(store.getFilePath());
    const loaded = store2.getById(task.id);
    expect(loaded!.claudeArgs).toEqual(task.claudeArgs);
  });

  it("defaults claudeArgs to null when not provided", () => {
    const task = store.addTask({ title: "plain", prompt: "p", cwd: "/tmp" });
    expect(task.claudeArgs).toBeNull();
  });
});
