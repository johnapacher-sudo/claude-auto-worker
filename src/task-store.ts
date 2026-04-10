import fs from "node:fs";
import path from "node:path";
import type { Task, TaskFile, ClaudeArgs } from "./types.js";

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
    try {
      const raw = fs.readFileSync(this.filePath, "utf-8");
      return JSON.parse(raw) as TaskFile;
    } catch {
      console.error(`[task-store] Corrupt tasks.json, resetting to empty`);
      const empty: TaskFile = { tasks: [] };
      this.write(empty);
      return empty;
    }
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

  addTask(input: { title: string; prompt: string; cwd: string; priority?: number; claudeArgs?: ClaudeArgs | null }): Task {
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
      claudeArgs: input.claudeArgs ?? null,
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
