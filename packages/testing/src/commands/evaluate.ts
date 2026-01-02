/**
 * @afd/testing - scenario.evaluate command
 *
 * Batch execution of scenarios with parallel support, fail-fast, and multiple output formats.
 */

import { success, failure, type CommandResult } from '@afd/core';
import { parseScenarioFile } from '../parsers/yaml.js';
import type { Scenario } from '../types/scenario.js';
import type {
  ScenarioResult,
  ScenarioOutcome,
  TestReport,
  TestSummary,
  EnvironmentInfo,
} from '../types/report.js';
import { createEmptySummary, calculateSummary } from '../types/report.js';
import { InProcessExecutor, type CommandHandler } from '../runner/executor.js';
import { scenarioList } from './list.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Input for scenario.evaluate command.
 */
export interface ScenarioEvaluateInput {
  /** Command handler for in-process execution */
  handler: CommandHandler;

  /** Base directory for scenarios */
  directory?: string;

  /** Specific scenario files to run */
  scenarios?: string[];

  /** Filter by job name */
  job?: string;

  /** Filter by tags */
  tags?: string[];

  /** Stop on first failure */
  failFast?: boolean;

  /** Number of parallel executions (default: 1, sequential) */
  concurrency?: number;

  /** Output format */
  format?: 'terminal' | 'json' | 'junit' | 'markdown';

  /** Output file path (optional) */
  output?: string;

  /** Base path for fixture resolution */
  basePath?: string;

  /** Timeout per scenario in ms */
  timeout?: number;

  /** Report title */
  title?: string;
}

/**
 * Output for scenario.evaluate command.
 */
export interface ScenarioEvaluateOutput {
  /** Test report */
  report: TestReport;

  /** Exit code (0 = all passed, 1 = failures) */
  exitCode: number;

  /** Formatted output (if format specified) */
  formattedOutput?: string;
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Execute a single scenario with timeout.
 */
async function executeWithTimeout(
  executor: InProcessExecutor,
  scenario: Scenario,
  timeout?: number
): Promise<ScenarioResult> {
  if (!timeout) {
    return executor.execute(scenario);
  }

  return Promise.race([
    executor.execute(scenario),
    new Promise<ScenarioResult>((_, reject) =>
      setTimeout(() => reject(new Error(`Scenario timed out after ${timeout}ms`)), timeout)
    ),
  ]);
}

/**
 * Create a skip result for a scenario.
 */
function createSkipResult(path: string, jobName: string, stepCount: number): ScenarioResult {
  return {
    scenarioPath: path,
    jobName,
    outcome: 'partial' as ScenarioOutcome, // Use 'partial' since 'skip' isn't in ScenarioOutcome
    durationMs: 0,
    stepResults: [],
    passedSteps: 0,
    failedSteps: 0,
    skippedSteps: stepCount,
    startedAt: new Date(),
    completedAt: new Date(),
  };
}

/**
 * Create an error result for a scenario.
 */
function createErrorResult(path: string, jobName: string, errorMessage: string): ScenarioResult {
  return {
    scenarioPath: path,
    jobName,
    outcome: 'error' as ScenarioOutcome,
    durationMs: 0,
    stepResults: [],
    passedSteps: 0,
    failedSteps: 1,
    skippedSteps: 0,
    startedAt: new Date(),
    completedAt: new Date(),
  };
}

/**
 * Execute scenarios in parallel with concurrency limit.
 */
async function executeParallel(
  executor: InProcessExecutor,
  scenarios: Array<{ scenario: Scenario; path: string }>,
  concurrency: number,
  timeout?: number,
  failFast?: boolean,
  onResult?: (result: ScenarioResult) => void
): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  let shouldStop = false;

  // Process in batches
  for (let i = 0; i < scenarios.length && !shouldStop; i += concurrency) {
    const batch = scenarios.slice(i, i + concurrency);

    const batchResults = await Promise.all(
      batch.map(async ({ scenario, path }): Promise<ScenarioResult> => {
        if (shouldStop) {
          return createSkipResult(path, scenario.job, scenario.steps?.length ?? 0);
        }

        try {
          const result = await executeWithTimeout(executor, scenario, timeout);
          result.scenarioPath = path;
          return result;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return createErrorResult(path, scenario.job, message);
        }
      })
    );

    for (const result of batchResults) {
      results.push(result);
      onResult?.(result);

      if (failFast && (result.outcome === 'fail' || result.outcome === 'error')) {
        shouldStop = true;
      }
    }
  }

  return results;
}

/**
 * Build environment info for the report.
 */
function buildEnvironmentInfo(): EnvironmentInfo {
  return {
    nodeVersion: process.version,
    platform: process.platform,
    cwd: process.cwd(),
  };
}

/**
 * Evaluate multiple scenarios.
 *
 * @example
 * ```typescript
 * // Run all scenarios in a directory
 * const result = await scenarioEvaluate({
 *   handler: commandHandler,
 *   directory: './scenarios'
 * });
 *
 * // Run specific scenarios with fail-fast
 * const result = await scenarioEvaluate({
 *   handler: commandHandler,
 *   scenarios: ['./scenarios/create.scenario.yaml'],
 *   failFast: true
 * });
 *
 * // Run in parallel
 * const result = await scenarioEvaluate({
 *   handler: commandHandler,
 *   directory: './scenarios',
 *   concurrency: 4
 * });
 * ```
 */
export async function scenarioEvaluate(
  input: ScenarioEvaluateInput
): Promise<CommandResult<ScenarioEvaluateOutput>> {
  const startedAt = new Date();
  const startTime = Date.now();

  try {
    // Collect scenarios to run
    let scenariosToRun: Array<{ scenario: Scenario; path: string }> = [];

    if (input.scenarios && input.scenarios.length > 0) {
      // Run specific scenarios
      for (const scenarioPath of input.scenarios) {
        const result = await parseScenarioFile(scenarioPath);
        if (result.success) {
          scenariosToRun.push({ scenario: result.scenario, path: scenarioPath });
        } else {
          return failure({
            code: 'PARSE_ERROR',
            message: `Failed to parse ${scenarioPath}: ${result.error}`,
            suggestion: 'Check the scenario file syntax',
          });
        }
      }
    } else {
      // List and filter scenarios
      const listResult = await scenarioList({
        directory: input.directory,
        job: input.job,
        tags: input.tags,
      });

      if (!listResult.success || !listResult.data) {
        return failure({
          code: 'LIST_ERROR',
          message: 'Failed to list scenarios',
        });
      }

      // Parse each scenario
      for (const summary of listResult.data.scenarios) {
        const result = await parseScenarioFile(summary.path);
        if (result.success) {
          scenariosToRun.push({ scenario: result.scenario, path: summary.path });
        }
      }
    }

    if (scenariosToRun.length === 0) {
      const emptyReport: TestReport = {
        title: input.title ?? 'JTBD Scenario Evaluation',
        durationMs: 0,
        scenarios: [],
        summary: createEmptySummary(),
        generatedAt: new Date(),
        environment: buildEnvironmentInfo(),
      };
      return success({
        report: emptyReport,
        exitCode: 0,
      }, {
        reasoning: 'No scenarios to run',
      });
    }

    // Create executor
    const executor = new InProcessExecutor({
      handler: input.handler,
      basePath: input.basePath ?? input.directory,
      stopOnFailure: true,
    });

    // Execute scenarios
    const concurrency = input.concurrency ?? 1;
    const results = await executeParallel(
      executor,
      scenariosToRun,
      concurrency,
      input.timeout,
      input.failFast
    );

    const completedAt = new Date();
    const totalDurationMs = Date.now() - startTime;

    // Calculate summary
    const summary = calculateSummary(results);

    // Build report
    const report: TestReport = {
      title: input.title ?? 'JTBD Scenario Evaluation',
      durationMs: totalDurationMs,
      scenarios: results,
      summary,
      generatedAt: completedAt,
      environment: buildEnvironmentInfo(),
    };

    // Format output if requested
    let formattedOutput: string | undefined;
    switch (input.format) {
      case 'json':
        formattedOutput = JSON.stringify(report, null, 2);
        break;
      case 'junit':
        formattedOutput = formatJunit(report);
        break;
      case 'markdown':
        formattedOutput = formatMarkdown(report);
        break;
      case 'terminal':
      default:
        formattedOutput = formatTerminal(report);
        break;
    }

    // Write to file if output path specified
    if (input.output && formattedOutput) {
      const fs = await import('node:fs');
      await fs.promises.writeFile(input.output, formattedOutput);
    }

    const exitCode = summary.failedScenarios === 0 && summary.errorScenarios === 0 ? 0 : 1;

    return success({
      report,
      exitCode,
      formattedOutput,
    }, {
      reasoning: `Evaluated ${summary.totalScenarios} scenarios: ${summary.passedScenarios} passed, ${summary.failedScenarios} failed`,
      confidence: summary.passRate,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failure({
      code: 'EVALUATE_ERROR',
      message: `Failed to evaluate scenarios: ${message}`,
    });
  }
}

// ============================================================================
// Output Formatters
// ============================================================================

/**
 * Format report for terminal output.
 */
export function formatTerminal(report: TestReport): string {
  const lines: string[] = [];
  const { summary, scenarios } = report;

  lines.push('');
  lines.push('JTBD Scenario Results');
  lines.push('━'.repeat(60));
  lines.push('');

  for (const result of scenarios) {
    const icon = result.outcome === 'pass' ? '✓' : result.outcome === 'partial' ? '○' : '✗';
    const color = result.outcome === 'pass' ? '32' : result.outcome === 'partial' ? '33' : '31';
    const name = result.jobName || result.scenarioPath.split('/').pop() || 'Unknown';
    lines.push(`\x1b[${color}m${icon}\x1b[0m ${name} (${result.durationMs}ms)`);

    // Show step details for failures
    if (result.outcome !== 'pass') {
      for (const step of result.stepResults) {
        if (step.outcome !== 'pass') {
          lines.push(`  └─ ${step.command}: ${step.error?.message ?? step.outcome}`);
        }
      }
    }
  }

  lines.push('');
  lines.push('━'.repeat(60));
  lines.push(`Scenarios: ${summary.totalScenarios} total, ${summary.passedScenarios} passed, ${summary.failedScenarios} failed`);
  lines.push(`Duration: ${report.durationMs}ms`);
  lines.push('');

  return lines.join('\n');
}

/**
 * Format report as JUnit XML.
 */
export function formatJunit(report: TestReport): string {
  const { summary, scenarios } = report;
  const lines: string[] = [];

  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(`<testsuites name="JTBD Scenarios" tests="${summary.totalScenarios}" failures="${summary.failedScenarios}" time="${(report.durationMs / 1000).toFixed(3)}">`);

  // Group by job
  const byJob = new Map<string, ScenarioResult[]>();
  for (const result of scenarios) {
    const job = result.jobName ?? 'default';
    if (!byJob.has(job)) {
      byJob.set(job, []);
    }
    byJob.get(job)!.push(result);
  }

  for (const [job, jobResults] of byJob) {
    const jobFailed = jobResults.filter((r) => r.outcome !== 'pass').length;
    const jobTime = jobResults.reduce((sum, r) => sum + r.durationMs, 0);

    lines.push(`  <testsuite name="${escapeXml(job)}" tests="${jobResults.length}" failures="${jobFailed}" time="${(jobTime / 1000).toFixed(3)}">`);

    for (const result of jobResults) {
      const name = result.scenarioPath.split('/').pop() ?? 'unknown';
      lines.push(`    <testcase name="${escapeXml(name)}" time="${(result.durationMs / 1000).toFixed(3)}">`);

      if (result.outcome !== 'pass') {
        const failedStep = result.stepResults.find((s) => s.outcome !== 'pass');
        const message = failedStep?.error?.message ?? 'Test failed';
        lines.push(`      <failure message="${escapeXml(message)}">`);
        lines.push(`        ${escapeXml(JSON.stringify(failedStep, null, 2))}`);
        lines.push('      </failure>');
      }

      lines.push('    </testcase>');
    }

    lines.push('  </testsuite>');
  }

  lines.push('</testsuites>');

  return lines.join('\n');
}

/**
 * Format report as Markdown.
 */
export function formatMarkdown(report: TestReport): string {
  const { summary, scenarios } = report;
  const lines: string[] = [];

  lines.push('# JTBD Scenario Results');
  lines.push('');
  lines.push(`**Date**: ${report.generatedAt.toISOString()}`);
  lines.push(`**Duration**: ${report.durationMs}ms`);
  lines.push(`**Result**: ${summary.passedScenarios}/${summary.totalScenarios} passed (${Math.round(summary.passRate * 100)}%)`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Status | Count |');
  lines.push('|--------|-------|');
  lines.push(`| ✅ Passed | ${summary.passedScenarios} |`);
  lines.push(`| ❌ Failed | ${summary.failedScenarios} |`);
  lines.push(`| ⚠️ Errors | ${summary.errorScenarios} |`);
  lines.push('');

  const failed = scenarios.filter((r) => r.outcome !== 'pass' && r.outcome !== 'partial');
  if (failed.length > 0) {
    lines.push('## Failed Scenarios');
    lines.push('');

    for (const result of failed) {
      const name = result.scenarioPath.split('/').pop() ?? 'unknown';
      lines.push(`### ❌ ${name}`);
      lines.push('');
      lines.push(`- **Job**: ${result.jobName}`);

      const failedStep = result.stepResults.find((s) => s.outcome !== 'pass');
      if (failedStep) {
        lines.push(`- **Failed Step**: ${failedStep.command}`);
        lines.push(`- **Error**: ${failedStep.error?.message ?? 'Unknown error'}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Escape special XML characters.
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
