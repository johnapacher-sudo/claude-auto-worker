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

  it("passes claudeArgs to spawn as CLI flags", async () => {
    const runner = new ClaudeRunner({ timeout: 30000 });
    const result = await runner.run({
      prompt: "respond with exactly OK and nothing else",
      cwd: process.cwd(),
      claudeArgs: {
        model: "haiku",
        maxTurns: 1,
        allowedTools: ["Read"],
        permissionMode: "default",
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.isClaudeError).toBe(false);
  }, 60000);
});

describe("ClaudeRunner.buildArgs", () => {
  it("returns base args when no claudeArgs", () => {
    const args = ClaudeRunner.buildArgs("hello");
    expect(args).toEqual(["-p", "hello", "--output-format", "json"]);
  });

  it("returns base args when claudeArgs is null", () => {
    const args = ClaudeRunner.buildArgs("hello", null);
    expect(args).toEqual(["-p", "hello", "--output-format", "json"]);
  });

  it("adds --model flag", () => {
    const args = ClaudeRunner.buildArgs("hello", { model: "opus" });
    expect(args).toContain("--model");
    expect(args[args.indexOf("--model") + 1]).toBe("opus");
  });

  it("adds --permission-mode flag", () => {
    const args = ClaudeRunner.buildArgs("hello", { permissionMode: "auto" });
    expect(args).toContain("--permission-mode");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("auto");
  });

  it("adds --allowedTools flags", () => {
    const args = ClaudeRunner.buildArgs("hello", { allowedTools: ["Bash", "Edit"] });
    expect(args).toContain("--allowedTools");
    const idx = args.indexOf("--allowedTools");
    expect(args[idx + 1]).toBe("Bash");
    expect(args[idx + 2]).toBe("Edit");
  });

  it("adds --max-turns flag", () => {
    const args = ClaudeRunner.buildArgs("hello", { maxTurns: 5 });
    expect(args).toContain("--max-turns");
    expect(args[args.indexOf("--max-turns") + 1]).toBe("5");
  });

  it("includes maxTurns when set to 0", () => {
    const args = ClaudeRunner.buildArgs("hello", { maxTurns: 0 });
    expect(args).toContain("--max-turns");
    expect(args[args.indexOf("--max-turns") + 1]).toBe("0");
  });

  it("combines all flags", () => {
    const args = ClaudeRunner.buildArgs("test", {
      model: "sonnet",
      permissionMode: "default",
      allowedTools: ["Read"],
      maxTurns: 3,
    });
    expect(args).toEqual([
      "-p", "test", "--output-format", "json",
      "--model", "sonnet",
      "--permission-mode", "default",
      "--allowedTools", "Read",
      "--max-turns", "3",
    ]);
  });

  it("skips empty allowedTools array", () => {
    const args = ClaudeRunner.buildArgs("hello", { allowedTools: [] });
    expect(args).not.toContain("--allowedTools");
  });
});
