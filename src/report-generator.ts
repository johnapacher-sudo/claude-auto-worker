import fs from "node:fs";
import path from "node:path";
import type { DailyReport, Task, TaskReport, TaskResult, ReportSummary } from "./types.js";

export class ReportGenerator {
  private reportsDir: string;

  constructor(reportsDir: string) {
    this.reportsDir = reportsDir;
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }
  }

  private getReportPath(date: string): string {
    return path.join(this.reportsDir, `${date}.json`);
  }

  getReport(date: string): DailyReport | null {
    const filePath = this.getReportPath(date);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as DailyReport;
  }

  appendTaskResult(task: Task, result: TaskResult): void {
    const date = new Date().toISOString().slice(0, 10);
    const filePath = this.getReportPath(date);

    let report: DailyReport;
    if (fs.existsSync(filePath)) {
      report = JSON.parse(fs.readFileSync(filePath, "utf-8")) as DailyReport;
    } else {
      report = { date, tasks: [], summary: { total: 0, completed: 0, failed: 0, totalDuration: 0 } };
    }

    const taskReport: TaskReport = {
      id: task.id,
      title: task.title,
      status: task.status === "completed" ? "completed" : "failed",
      startedAt: task.startedAt ?? new Date().toISOString(),
      completedAt: task.completedAt ?? new Date().toISOString(),
      duration: result.duration,
      resultSummary: result.claudeResult ?? result.stdout,
      fullOutput: result.stdout,
    };

    report.tasks.push(taskReport);
    report.summary = this.computeSummary(report.tasks);

    fs.writeFileSync(filePath, JSON.stringify(report, null, 2));
  }

  private computeSummary(tasks: TaskReport[]): ReportSummary {
    const completed = tasks.filter((t) => t.status === "completed").length;
    const failed = tasks.filter((t) => t.status === "failed").length;
    const totalDuration = tasks.reduce((sum, t) => sum + t.duration, 0);
    return {
      total: tasks.length,
      completed,
      failed,
      totalDuration,
    };
  }
}
