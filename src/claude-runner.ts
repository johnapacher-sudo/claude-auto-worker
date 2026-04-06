import { spawn } from "node:child_process";
import type { TaskResult } from "./types.js";

export interface ClaudeRunnerConfig {
  timeout?: number; // milliseconds, default 600000 (10 minutes)
}

export interface RunOptions {
  prompt: string;
  cwd: string;
}

export class ClaudeRunner {
  private config: ClaudeRunnerConfig;

  constructor(config: ClaudeRunnerConfig = {}) {
    this.config = { timeout: 600000, ...config };
  }

  run(options: RunOptions): Promise<TaskResult> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const args = ["-p", options.prompt, "--output-format", "json"];

      const child = spawn("claude", args, {
        cwd: options.cwd,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        const duration = Date.now() - startTime;
        resolve({
          exitCode: -1,
          stdout,
          stderr: stderr + "\nTask timed out",
          duration: duration / 1000,
          isClaudeError: false,
          claudeResult: null,
          totalCostUsd: null,
        });
      }, this.config.timeout);

      child.on("close", (code) => {
        clearTimeout(timer);
        const duration = (Date.now() - startTime) / 1000;

        let isClaudeError = false;
        let claudeResult: string | null = null;
        let totalCostUsd: number | null = null;

        try {
          const parsed = JSON.parse(stdout.trim());
          isClaudeError = parsed.is_error === true;
          claudeResult = typeof parsed.result === "string" ? parsed.result : null;
          totalCostUsd =
            typeof parsed.total_cost_usd === "number"
              ? parsed.total_cost_usd
              : null;
        } catch {
          // stdout was not valid JSON, leave claudeResult as null
        }

        resolve({
          exitCode: code ?? -1,
          stdout,
          stderr,
          duration,
          isClaudeError,
          claudeResult,
          totalCostUsd,
        });
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        const duration = (Date.now() - startTime) / 1000;
        resolve({
          exitCode: -1,
          stdout: "",
          stderr: err.message,
          duration,
          isClaudeError: false,
          claudeResult: null,
          totalCostUsd: null,
        });
      });
    });
  }
}
