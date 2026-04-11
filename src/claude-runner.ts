import { spawn } from "node:child_process";
import type { TaskResult, ClaudeArgs } from "./types.js";

export interface ClaudeRunnerConfig {
  timeout?: number; // milliseconds, default 600000 (10 minutes)
}

export interface RunOptions {
  prompt: string;
  cwd: string;
  claudeArgs?: ClaudeArgs | null;
}

export class ClaudeRunner {
  private config: ClaudeRunnerConfig;

  constructor(config: ClaudeRunnerConfig = {}) {
    this.config = { timeout: 600000, ...config };
  }

  static buildArgs(prompt: string, claudeArgs?: ClaudeArgs | null): string[] {
    const args = ["-p", prompt, "--output-format", "json"];
    if (claudeArgs?.model) args.push("--model", claudeArgs.model);
    if (claudeArgs?.permissionMode) args.push("--permission-mode", claudeArgs.permissionMode);
    if (claudeArgs?.allowedTools?.length) args.push("--allowedTools", ...claudeArgs.allowedTools);
    if (claudeArgs?.maxTurns != null) args.push("--max-turns", String(claudeArgs.maxTurns));
    return args;
  }

  run(options: RunOptions): Promise<TaskResult> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const args = ClaudeRunner.buildArgs(options.prompt, options.claudeArgs);

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
