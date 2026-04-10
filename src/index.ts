#!/usr/bin/env node

import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { TaskStore } from "./task-store.js";
import { ClaudeRunner } from "./claude-runner.js";
import { Scheduler } from "./scheduler.js";
import { ReportGenerator } from "./report-generator.js";

const DATA_DIR = path.join(process.cwd(), "data");
const TASKS_FILE = path.join(DATA_DIR, "tasks.json");
const REPORTS_DIR = path.join(DATA_DIR, "reports");
const PID_FILE = path.join(DATA_DIR, "scheduler.pid");
const LOGS_DIR = path.join(DATA_DIR, "logs");
const LOG_FILE = path.join(LOGS_DIR, "scheduler.log");

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
  .option("-d, --detach", "Run in background (detached mode)")
  .option("--detached", "(internal) Indicates this is the background child process", false)
  .action(async (opts) => {
    // If detach requested but this is NOT the child process, spawn child and exit
    if (opts.detach && !opts.detached) {
      // Check for already running scheduler
      if (fs.existsSync(PID_FILE)) {
        const pid = parseInt(fs.readFileSync(PID_FILE, "utf-8"), 10);
        try {
          process.kill(pid, 0); // signal 0 = check if alive
          console.error(`Scheduler already running (PID ${pid})`);
          process.exit(1);
        } catch {
          console.log(`Removing stale PID file (PID ${pid} not found)`);
          fs.unlinkSync(PID_FILE);
        }
      }

      // Ensure log directory exists
      fs.mkdirSync(LOGS_DIR, { recursive: true });
      const logStream = fs.openSync(LOG_FILE, "a");

      const child = spawn("node", [
        path.resolve(__dirname, "index.js"),
        "start",
        "--detached",
        "--poll-interval", opts.pollInterval,
        "--timeout", opts.timeout,
        "--tasks-file", opts.tasksFile,
        "--reports-dir", opts.reportsDir,
      ], {
        detached: true,
        stdio: ["ignore", logStream, logStream],
      });

      child.unref();

      // Write PID file immediately (child will overwrite on startLoop)
      fs.writeFileSync(PID_FILE, String(child.pid));

      console.log(`Scheduler started in background (PID ${child.pid})`);
      console.log(`  Log file: ${LOG_FILE}`);
      console.log(`  Stop with: auto-worker stop`);
      process.exit(0);
    }

    // Normal (foreground or detached child) startup
    const store = getStore(opts.tasksFile);
    const runner = new ClaudeRunner({ timeout: parseInt(opts.timeout) * 1000 });

    const scheduler = new Scheduler({
      store,
      runner,
      reportsDir: opts.reportsDir,
      pollInterval: parseInt(opts.pollInterval),
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
  .option("--model <model>", "Claude model (e.g. sonnet, opus, haiku)")
  .option("--permission-mode <mode>", "Permission mode (e.g. auto, default, bypassPermissions)")
  .option("--allowedTools <tools>", "Comma-separated allowed tools (e.g. \"Bash,Edit\")")
  .option("--max-turns <number>", "Maximum conversation turns")
  .action((prompt, opts) => {
    const store = getStore(opts.tasksFile);

    let claudeArgs = null;
    if (opts.model || opts.permissionMode || opts.allowedTools || opts.maxTurns) {
      claudeArgs = {};
      if (opts.model) claudeArgs.model = opts.model;
      if (opts.permissionMode) claudeArgs.permissionMode = opts.permissionMode;
      if (opts.allowedTools) claudeArgs.allowedTools = opts.allowedTools.split(",").map((s: string) => s.trim());
      if (opts.maxTurns) claudeArgs.maxTurns = parseInt(opts.maxTurns);
    }

    const task = store.addTask({
      title: opts.title ?? prompt.slice(0, 60),
      prompt,
      cwd: opts.cwd,
      priority: parseInt(opts.priority),
      claudeArgs,
    });
    console.log(`Task added: ${task.id} — ${task.title}`);
    if (claudeArgs) {
      console.log(`  Claude args: ${JSON.stringify(claudeArgs)}`);
    }
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
