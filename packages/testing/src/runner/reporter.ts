/**
 * @lushly-dev/afd-testing - Terminal Reporter
 *
 * Formats scenario execution results for terminal output.
 * Supports both human-readable and CI/agent-friendly formats.
 */

import type {
  ScenarioResult,
  StepResult,
  TestReport,
  TestSummary,
  AssertionResult,
} from "../types/report.js";
import type { Step } from "../types/scenario.js";

// ============================================================================
// Reporter Configuration
// ============================================================================

export interface ReporterConfig {
  /** Output format: human-readable or JSON for agents */
  format?: "human" | "json";

  /** Show verbose output including all assertions */
  verbose?: boolean;

  /** Use colors in output (default: true for human format) */
  colors?: boolean;

  /** Stream to write output to (default: process.stdout) */
  output?: NodeJS.WritableStream;
}

// ============================================================================
// Color Utilities
// ============================================================================

const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

function colorize(text: string, color: keyof typeof colors, useColors: boolean): string {
  if (!useColors) return text;
  return `${colors[color]}${text}${colors.reset}`;
}

// ============================================================================
// Terminal Reporter Class
// ============================================================================

/**
 * Reporter for outputting scenario results to the terminal.
 */
export class TerminalReporter {
  private config: Required<ReporterConfig>;

  constructor(config: ReporterConfig = {}) {
    this.config = {
      format: config.format ?? "human",
      verbose: config.verbose ?? false,
      colors: config.colors ?? (config.format !== "json"),
      output: config.output ?? process.stdout,
    };
  }

  /**
   * Report a single scenario result.
   */
  reportScenario(result: ScenarioResult): void {
    if (this.config.format === "json") {
      this.write(JSON.stringify(result, null, 2));
      return;
    }

    this.reportScenarioHuman(result);
  }

  /**
   * Report multiple scenario results.
   */
  reportAll(results: ScenarioResult[]): void {
    if (this.config.format === "json") {
      this.write(JSON.stringify(results, null, 2));
      return;
    }

    for (const result of results) {
      this.reportScenarioHuman(result);
      this.write("");
    }

    this.reportSummaryHuman(results);
  }

  /**
   * Report a test report with summary.
   */
  reportTestReport(report: TestReport): void {
    if (this.config.format === "json") {
      this.write(JSON.stringify(report, null, 2));
      return;
    }

    this.write(colorize(`\n${report.title}`, "bold", this.config.colors));
    this.write(colorize(`${"─".repeat(60)}`, "dim", this.config.colors));

    for (const result of report.scenarios) {
      this.reportScenarioHuman(result);
      this.write("");
    }

    this.reportSummaryFromReport(report.summary, report.durationMs);
  }

  /**
   * Report step progress (for live updates).
   */
  reportStepProgress(step: Step, result: StepResult, stepIndex: number, totalSteps: number): void {
    if (this.config.format === "json") {
      return; // Don't output progress in JSON mode
    }

    const icon = this.getOutcomeIcon(result.outcome);
    const stepNum = `[${stepIndex + 1}/${totalSteps}]`;
    const duration = `${result.durationMs}ms`;

    this.write(`  ${icon} ${colorize(stepNum, "dim", this.config.colors)} ${step.command} ${colorize(duration, "gray", this.config.colors)}`);

    if (this.config.verbose && result.assertions.length > 0) {
      for (const assertion of result.assertions) {
        const assertIcon = assertion.passed ? "✓" : "✗";
        const assertColor = assertion.passed ? "green" : "red";
        this.write(`      ${colorize(assertIcon, assertColor, this.config.colors)} ${assertion.description || assertion.path}`);
      }
    }

    if (result.outcome === "fail" || result.outcome === "error") {
      if (result.error) {
        this.write(`      ${colorize(`Error: ${result.error.message}`, "red", this.config.colors)}`);
      }
      // Show failed assertions even in non-verbose mode
      if (!this.config.verbose) {
        for (const assertion of result.assertions.filter((a) => !a.passed)) {
          this.write(`      ${colorize("✗", "red", this.config.colors)} ${assertion.description || assertion.path}`);
        }
      }
    }
  }

  /**
   * Report scenario start (for live updates).
   */
  reportScenarioStart(jobName: string, description?: string): void {
    if (this.config.format === "json") return;

    this.write("");
    this.write(colorize(`▸ ${jobName}`, "bold", this.config.colors));
    if (description) {
      this.write(colorize(`  ${description}`, "dim", this.config.colors));
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private reportScenarioHuman(result: ScenarioResult): void {
    const icon = this.getOutcomeIcon(result.outcome);
    const outcomeColor = this.getOutcomeColor(result.outcome);
    const duration = this.formatDuration(result.durationMs);

    this.write("");
    this.write(`${icon} ${colorize(result.jobName, "bold", this.config.colors)} ${colorize(`(${duration})`, "dim", this.config.colors)}`);

    if (result.jobDescription) {
      this.write(colorize(`  ${result.jobDescription}`, "dim", this.config.colors));
    }

    // Step summary
    const stepSummary = `  ${result.passedSteps} passed, ${result.failedSteps} failed, ${result.skippedSteps} skipped`;
    this.write(colorize(stepSummary, outcomeColor, this.config.colors));

    // Verbose: show all steps
    if (this.config.verbose) {
      this.write("");
      for (const stepResult of result.stepResults) {
        const stepIcon = this.getOutcomeIcon(stepResult.outcome);
        const stepDuration = `${stepResult.durationMs}ms`;
        this.write(`  ${stepIcon} ${stepResult.command} ${colorize(stepDuration, "gray", this.config.colors)}`);

        for (const assertion of stepResult.assertions) {
          if (!assertion.passed || this.config.verbose) {
            const assertIcon = assertion.passed ? "✓" : "✗";
            const assertColor = assertion.passed ? "green" : "red";
            this.write(`      ${colorize(assertIcon, assertColor, this.config.colors)} ${assertion.description || assertion.path}`);
          }
        }
      }
    }

    // Always show failed steps in non-verbose mode
    if (!this.config.verbose && result.failedSteps > 0) {
      this.write("");
      this.write(colorize("  Failed steps:", "red", this.config.colors));
      for (const stepResult of result.stepResults.filter((s) => s.outcome === "fail" || s.outcome === "error")) {
        this.write(`    ${this.getOutcomeIcon(stepResult.outcome)} ${stepResult.command}`);
        if (stepResult.error) {
          this.write(colorize(`      ${stepResult.error.message}`, "red", this.config.colors));
        }
        for (const assertion of stepResult.assertions.filter((a) => !a.passed)) {
          this.write(`      ${colorize("✗", "red", this.config.colors)} ${assertion.description || assertion.path}`);
        }
      }
    }
  }

  private reportSummaryHuman(results: ScenarioResult[]): void {
    const passed = results.filter((r) => r.outcome === "pass").length;
    const failed = results.filter((r) => r.outcome === "fail" || r.outcome === "error" || r.outcome === "partial").length;
    const totalDuration = results.reduce((sum, r) => sum + r.durationMs, 0);

    this.write(colorize("\n" + "─".repeat(60), "dim", this.config.colors));
    this.write(colorize("Summary", "bold", this.config.colors));

    const passColor = passed > 0 ? "green" : "dim";
    const failColor = failed > 0 ? "red" : "dim";

    this.write(`  ${colorize(`${passed} passed`, passColor, this.config.colors)}, ${colorize(`${failed} failed`, failColor, this.config.colors)}`);
    this.write(`  ${colorize(`Total time: ${this.formatDuration(totalDuration)}`, "dim", this.config.colors)}`);

    // Exit message
    if (failed === 0) {
      this.write(colorize("\n✓ All scenarios passed!", "green", this.config.colors));
    } else {
      this.write(colorize(`\n✗ ${failed} scenario(s) failed`, "red", this.config.colors));
    }
  }

  private reportSummaryFromReport(summary: TestSummary, durationMs: number): void {
    this.write(colorize("\n" + "─".repeat(60), "dim", this.config.colors));
    this.write(colorize("Summary", "bold", this.config.colors));

    const passColor = summary.passedScenarios > 0 ? "green" : "dim";
    const failColor = summary.failedScenarios > 0 ? "red" : "dim";

    this.write(`  Scenarios: ${colorize(`${summary.passedScenarios} passed`, passColor, this.config.colors)}, ${colorize(`${summary.failedScenarios} failed`, failColor, this.config.colors)}`);
    this.write(`  Steps: ${summary.passedSteps} passed, ${summary.failedSteps} failed, ${summary.skippedSteps} skipped`);
    this.write(`  Pass rate: ${(summary.passRate * 100).toFixed(1)}%`);
    this.write(`  Duration: ${this.formatDuration(durationMs)}`);

    if (summary.failedScenarios === 0) {
      this.write(colorize("\n✓ All scenarios passed!", "green", this.config.colors));
    } else {
      this.write(colorize(`\n✗ ${summary.failedScenarios} scenario(s) failed`, "red", this.config.colors));
    }
  }

  private getOutcomeIcon(outcome: string): string {
    switch (outcome) {
      case "pass":
        return colorize("✓", "green", this.config.colors);
      case "fail":
        return colorize("✗", "red", this.config.colors);
      case "error":
        return colorize("⚠", "yellow", this.config.colors);
      case "skip":
        return colorize("○", "gray", this.config.colors);
      case "partial":
        return colorize("◐", "yellow", this.config.colors);
      default:
        return "?";
    }
  }

  private getOutcomeColor(outcome: string): keyof typeof colors {
    switch (outcome) {
      case "pass":
        return "green";
      case "fail":
      case "error":
        return "red";
      case "partial":
        return "yellow";
      default:
        return "gray";
    }
  }

  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  }

  private write(text: string): void {
    this.config.output.write(text + "\n");
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a terminal reporter with the given configuration.
 */
export function createReporter(config?: ReporterConfig): TerminalReporter {
  return new TerminalReporter(config);
}

/**
 * Create a JSON reporter for CI/agent output.
 */
export function createJsonReporter(output?: NodeJS.WritableStream): TerminalReporter {
  return new TerminalReporter({ format: "json", colors: false, output });
}

/**
 * Create a verbose reporter for debugging.
 */
export function createVerboseReporter(output?: NodeJS.WritableStream): TerminalReporter {
  return new TerminalReporter({ format: "human", verbose: true, output });
}
