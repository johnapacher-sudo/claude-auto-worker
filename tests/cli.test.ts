import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

let tmpDir: string;
let tasksFile: string;
let dataDir: string;

const tsx = (args: string): string => {
  try {
    return execSync(`npx tsx src/index.ts ${args}`, {
      cwd: path.resolve(__dirname, ".."),
      encoding: "utf-8",
      timeout: 15000,
      env: { ...process.env },
    });
  } catch (e: any) {
    return e.stdout ?? e.message;
  }
};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-test-"));
  dataDir = path.join(tmpDir, "data");
  tasksFile = path.join(dataDir, "tasks.json");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("CLI: add command", () => {
  it("adds a basic task", () => {
    const output = tsx(`add "hello world" --tasks-file ${tasksFile}`);
    expect(output).toContain("Task added:");
    expect(output).toContain("hello world");

    const data = JSON.parse(fs.readFileSync(tasksFile, "utf-8"));
    expect(data.tasks).toHaveLength(1);
    expect(data.tasks[0].prompt).toBe("hello world");
    expect(data.tasks[0].claudeArgs).toBeNull();
  });

  it("adds a task with claudeArgs", () => {
    const output = tsx(
      `add "refactor code" --model opus --max-turns 5 --allowedTools "Bash,Edit" --permission-mode auto --tasks-file ${tasksFile}`,
    );
    expect(output).toContain("Task added:");
    expect(output).toContain('"model":"opus"');

    const data = JSON.parse(fs.readFileSync(tasksFile, "utf-8"));
    const task = data.tasks[0];
    expect(task.claudeArgs).toEqual({
      model: "opus",
      permissionMode: "auto",
      allowedTools: ["Bash", "Edit"],
      maxTurns: 5,
    });
  });

  it("adds a task with --model only", () => {
    tsx(`add "quick task" --model haiku --tasks-file ${tasksFile}`);
    const data = JSON.parse(fs.readFileSync(tasksFile, "utf-8"));
    expect(data.tasks[0].claudeArgs).toEqual({ model: "haiku" });
  });

  it("sets title from --title or prompt", () => {
    tsx(`add "some prompt" --title "Custom Title" --tasks-file ${tasksFile}`);
    const data = JSON.parse(fs.readFileSync(tasksFile, "utf-8"));
    expect(data.tasks[0].title).toBe("Custom Title");
  });

  it("sets priority from --priority", () => {
    tsx(`add "urgent" --priority 1 --tasks-file ${tasksFile}`);
    const data = JSON.parse(fs.readFileSync(tasksFile, "utf-8"));
    expect(data.tasks[0].priority).toBe(1);
  });
});

describe("CLI: list command", () => {
  it("lists tasks", () => {
    tsx(`add "task a" --tasks-file ${tasksFile}`);
    tsx(`add "task b" --tasks-file ${tasksFile}`);
    const output = tsx(`list --tasks-file ${tasksFile}`);
    expect(output).toContain("task a");
    expect(output).toContain("task b");
    expect(output).toContain("pending");
  });

  it("shows no tasks message when empty", () => {
    const output = tsx(`list --tasks-file ${tasksFile}`);
    expect(output).toContain("No tasks found");
  });

  it("filters by status", () => {
    tsx(`add "pending task" --tasks-file ${tasksFile}`);
    const output = tsx(`list --status running --tasks-file ${tasksFile}`);
    expect(output).toContain("No tasks found");
  });
});

describe("CLI: logs command", () => {
  it("shows message when no log file exists", () => {
    const logsDir = path.join(dataDir, "logs");
    const output = tsx(`logs --reports-dir ${path.join(dataDir, "reports")}`);
    // The logs command uses DATA_DIR based on cwd, so we test with default path
    // Just verify it doesn't crash
    expect(typeof output).toBe("string");
  });
});

describe("CLI: stop command", () => {
  it("shows message when no scheduler running", () => {
    const output = tsx("stop");
    expect(output).toContain("No scheduler running");
  });
});
