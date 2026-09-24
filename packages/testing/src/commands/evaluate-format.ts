/**
 * @lushly-dev/afd-testing - scenario-evaluate report formatters
 *
 * Terminal, JUnit XML and Markdown renderings of a `TestReport`.
 */

import type { ScenarioResult, TestReport } from '../types/report.js';

/**
 * The first problem to show for a scenario: its scenario-level error, or its
 * first step that did not pass.
 */
function describeProblem(result: ScenarioResult): { where: string; message: string } | undefined {
	if (result.error) {
		return { where: result.error.type, message: result.error.message };
	}
	const failedStep = result.stepResults.find((s) => s.outcome !== 'pass' && s.outcome !== 'skip');
	if (failedStep) {
		return {
			where: failedStep.command,
			message: failedStep.error?.message ?? failedStep.outcome,
		};
	}
	return undefined;
}

function scenarioName(result: ScenarioResult): string {
	return result.scenarioPath.split('/').pop() || result.jobName || 'unknown';
}

/**
 * Format report for terminal output.
 */
export function formatTerminal(report: TestReport): string {
	const lines: string[] = [];
	const { summary, scenarios } = report;
	const icons: Record<string, [string, string]> = {
		pass: ['✓', '32'],
		partial: ['○', '33'],
		skip: ['-', '90'],
	};

	lines.push('');
	lines.push('JTBD Scenario Results');
	lines.push('━'.repeat(60));
	lines.push('');

	for (const result of scenarios) {
		const [icon, color] = icons[result.outcome] ?? ['✗', '31'];
		const name = result.jobName || scenarioName(result);
		lines.push(`\x1b[${color}m${icon}\x1b[0m ${name} (${result.durationMs}ms)`);

		if (result.error) {
			lines.push(`  └─ ${result.error.type}: ${result.error.message}`);
		} else if (result.outcome !== 'pass' && result.outcome !== 'skip') {
			for (const step of result.stepResults) {
				if (step.outcome !== 'pass' && step.outcome !== 'skip') {
					lines.push(`  └─ ${step.command}: ${step.error?.message ?? step.outcome}`);
				}
			}
		}
	}

	lines.push('');
	lines.push('━'.repeat(60));
	lines.push(
		`Scenarios: ${summary.totalScenarios} total, ${summary.passedScenarios} passed, ${summary.failedScenarios} failed, ${summary.errorScenarios} errors, ${summary.skippedScenarios} skipped`
	);
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
	lines.push(
		`<testsuites name="JTBD Scenarios" tests="${summary.totalScenarios}" failures="${summary.failedScenarios}" errors="${summary.errorScenarios}" skipped="${summary.skippedScenarios}" time="${(report.durationMs / 1000).toFixed(3)}">`
	);

	// Group by job
	const byJob = new Map<string, ScenarioResult[]>();
	for (const result of scenarios) {
		const job = result.jobName || 'default';
		const group = byJob.get(job) ?? [];
		group.push(result);
		byJob.set(job, group);
	}

	for (const [job, jobResults] of byJob) {
		const count = (outcomes: string[]) =>
			jobResults.filter((r) => outcomes.includes(r.outcome)).length;
		const jobTime = jobResults.reduce((sum, r) => sum + r.durationMs, 0);

		lines.push(
			`  <testsuite name="${escapeXml(job)}" tests="${jobResults.length}" failures="${count(['fail', 'partial'])}" errors="${count(['error'])}" skipped="${count(['skip'])}" time="${(jobTime / 1000).toFixed(3)}">`
		);

		for (const result of jobResults) {
			lines.push(
				`    <testcase name="${escapeXml(scenarioName(result))}" time="${(result.durationMs / 1000).toFixed(3)}">`
			);

			if (result.outcome === 'skip') {
				lines.push('      <skipped/>');
			} else if (result.outcome !== 'pass') {
				const tag = result.outcome === 'error' ? 'error' : 'failure';
				const problem = describeProblem(result);
				const failedStep = result.stepResults.find(
					(s) => s.outcome !== 'pass' && s.outcome !== 'skip'
				);
				lines.push(`      <${tag} message="${escapeXml(problem?.message ?? 'Test failed')}">`);
				lines.push(`        ${escapeXml(JSON.stringify(result.error ?? failedStep, null, 2))}`);
				lines.push(`      </${tag}>`);
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
	lines.push(
		`**Result**: ${summary.passedScenarios}/${summary.totalScenarios} passed (${Math.round(summary.passRate * 100)}%)`
	);
	lines.push('');
	lines.push('## Summary');
	lines.push('');
	lines.push('| Status | Count |');
	lines.push('|--------|-------|');
	lines.push(`| ✅ Passed | ${summary.passedScenarios} |`);
	lines.push(`| ❌ Failed | ${summary.failedScenarios} |`);
	lines.push(`| ⚠️ Errors | ${summary.errorScenarios} |`);
	lines.push(`| ⏭️ Skipped | ${summary.skippedScenarios} |`);
	lines.push('');

	const failed = scenarios.filter((r) => r.outcome !== 'pass' && r.outcome !== 'skip');
	if (failed.length > 0) {
		lines.push('## Failed Scenarios');
		lines.push('');

		for (const result of failed) {
			lines.push(`### ❌ ${scenarioName(result)}`);
			lines.push('');
			lines.push(`- **Job**: ${result.jobName}`);

			const problem = describeProblem(result);
			if (problem) {
				lines.push(`- **Failed Step**: ${problem.where}`);
				lines.push(`- **Error**: ${problem.message}`);
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
