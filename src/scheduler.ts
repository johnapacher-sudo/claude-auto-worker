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
