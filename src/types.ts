export interface ClaudeArgs {
  model?: string;
  permissionMode?: string;
  allowedTools?: string[];
  maxTurns?: number;
}

export interface Task {
  id: string;
  title: string;
  prompt: string;
  cwd: string;
  status: "pending" | "running" | "completed" | "failed";
  priority: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  result: TaskResult | null;
  claudeArgs: ClaudeArgs | null;
}

export interface TaskResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
  isClaudeError: boolean;
  claudeResult: string | null;
  totalCostUsd: number | null;
}

export interface TaskFile {
  tasks: Task[];
}

export interface DailyReport {
  date: string;
  tasks: TaskReport[];
  summary: ReportSummary;
}

export interface TaskReport {
  id: string;
  title: string;
  status: "completed" | "failed";
  startedAt: string;
  completedAt: string;
  duration: number;
  resultSummary: string;
  fullOutput: string;
}

export interface ReportSummary {
  total: number;
  completed: number;
  failed: number;
  totalDuration: number;
}

