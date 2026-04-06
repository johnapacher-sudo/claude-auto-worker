import fs from "node:fs";
import path from "node:path";
import type { TaskResult } from "./types.js";
import { TaskStore } from "./task-store.js";
import { ClaudeRunner } from "./claude-runner.js";
import { ReportGenerator } from "./report-generator.js";

export interface SchedulerOptions {
  store: TaskStore;
  runner: ClaudeRunner;
  reportsDir: string;
  pollInterval: number;
  pidFile?: string;
}

export class Scheduler {
  private store: TaskStore;
  private runner: ClaudeRunner;
  private reportGen: ReportGenerator;
  private pollInterval: number;
  private pidFile: string;
  private running = false;
  private busy = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: SchedulerOptions) {
    this.store = options.store;
    this.runner = options.runner;
    this.reportGen = new ReportGenerator(options.reportsDir);
    this.pollInterval = options.pollInterval;
    this.pidFile = options.pidFile ?? path.join(path.dirname(options.store.getFilePath()), "scheduler.pid");
  }

  async tick(): Promise<void> {
    if (this.busy) return;

    const task = this.store.getNextPending();
    if (!task) return;

    this.busy = true;
    try {
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
    } finally {
      this.busy = false;
    }
  }

  startLoop(): void {
    this.running = true;
    fs.writeFileSync(this.pidFile, String(process.pid));

    // Run first tick immediately
    this.tick().catch((err) => console.error("[scheduler] tick error:", err));

    this.timer = setInterval(() => {
      if (!this.running || this.busy) return;
      this.tick().catch((err) => console.error("[scheduler] tick error:", err));
    }, this.pollInterval * 1000);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    // Wait for in-flight tick to finish
    while (this.busy) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (fs.existsSync(this.pidFile)) {
      fs.unlinkSync(this.pidFile);
    }
  }
}
