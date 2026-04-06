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
});
