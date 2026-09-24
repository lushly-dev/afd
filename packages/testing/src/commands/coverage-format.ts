/**
 * @lushly-dev/afd-testing - scenario-coverage report formatters
 *
 * Terminal and Markdown renderings of a coverage report.
 */

import type { ScenarioCoverageOutput } from './coverage.js';

/**
 * Format coverage for terminal output.
 */
export function formatCoverageTerminal(output: ScenarioCoverageOutput): string {
	const lines: string[] = [];
	const { summary, commandCoverage, jobCoverage } = output;

	lines.push('');
	lines.push('JTBD Scenario Coverage');
	lines.push('━'.repeat(60));
	lines.push('');

	// Summary
	lines.push(`Scenarios: ${summary.totalScenarios}`);
	lines.push(`Steps: ${summary.totalSteps}`);
	lines.push(
		`Commands tested: ${summary.commands.tested}${summary.commands.known ? ` / ${summary.commands.known}` : ''}`
	);
	if (summary.commands.coverage !== undefined) {
		lines.push(`Command coverage: ${summary.commands.coverage.toFixed(1)}%`);
	}
	lines.push(`Error codes tested: ${summary.errors.tested}`);
	lines.push(`Jobs covered: ${summary.jobs.count}`);
	lines.push('');

	// Untested commands
	if (summary.commands.untested && summary.commands.untested.length > 0) {
		lines.push('⚠️  Untested commands:');
		for (const cmd of summary.commands.untested) {
			lines.push(`   - ${cmd}`);
		}
		lines.push('');
	}

	// Top commands by usage
	lines.push('Top commands by usage:');
	const topCommands = commandCoverage.slice(0, 5);
	for (const cmd of topCommands) {
		const errorFlag = cmd.hasErrorTests ? ' ✓errors' : '';
		lines.push(
			`  ${cmd.command}: ${cmd.stepCount} steps in ${cmd.scenarioCount} scenarios${errorFlag}`
		);
	}
	lines.push('');

	// Jobs
	lines.push('Jobs:');
	for (const job of jobCoverage) {
		const tags = job.tags.length > 0 ? ` [${job.tags.join(', ')}]` : '';
		lines.push(`  ${job.job}: ${job.scenarioCount} scenarios (~${job.avgSteps} steps)${tags}`);
	}
	lines.push('');

	return lines.join('\n');
}

/**
 * Format coverage as Markdown.
 */
export function formatCoverageMarkdown(output: ScenarioCoverageOutput): string {
	const lines: string[] = [];
	const { summary, commandCoverage, errorCoverage, jobCoverage } = output;

	lines.push('# JTBD Scenario Coverage Report');
	lines.push('');

	// Summary
	lines.push('## Summary');
	lines.push('');
	lines.push('| Metric | Value |');
	lines.push('|--------|-------|');
	lines.push(`| Scenarios | ${summary.totalScenarios} |`);
	lines.push(`| Total Steps | ${summary.totalSteps} |`);
	lines.push(
		`| Commands Tested | ${summary.commands.tested}${summary.commands.known ? ` / ${summary.commands.known}` : ''} |`
	);
	if (summary.commands.coverage !== undefined) {
		lines.push(`| Command Coverage | ${summary.commands.coverage.toFixed(1)}% |`);
	}
	lines.push(`| Error Codes Tested | ${summary.errors.tested} |`);
	lines.push(`| Jobs Covered | ${summary.jobs.count} |`);
	lines.push('');

	// Untested
	if (summary.commands.untested && summary.commands.untested.length > 0) {
		lines.push('### ⚠️ Untested Commands');
		lines.push('');
		for (const cmd of summary.commands.untested) {
			lines.push(`- \`${cmd}\``);
		}
		lines.push('');
	}

	// Command coverage table
	lines.push('## Command Coverage');
	lines.push('');
	lines.push('| Command | Scenarios | Steps | Error Tests |');
	lines.push('|---------|-----------|-------|-------------|');
	for (const cmd of commandCoverage) {
		lines.push(
			`| \`${cmd.command}\` | ${cmd.scenarioCount} | ${cmd.stepCount} | ${cmd.hasErrorTests ? '✅' : '❌'} |`
		);
	}
	lines.push('');

	// Error coverage table
	if (errorCoverage.length > 0) {
		lines.push('## Error Coverage');
		lines.push('');
		lines.push('| Error Code | Scenarios |');
		lines.push('|------------|-----------|');
		for (const err of errorCoverage) {
			lines.push(`| \`${err.errorCode}\` | ${err.scenarioCount} |`);
		}
		lines.push('');
	}

	// Job coverage table
	lines.push('## Job Coverage');
	lines.push('');
	lines.push('| Job | Scenarios | Avg Steps | Tags |');
	lines.push('|-----|-----------|-----------|------|');
	for (const job of jobCoverage) {
		const tags = job.tags.join(', ') || '-';
		lines.push(`| ${job.job} | ${job.scenarioCount} | ${job.avgSteps} | ${tags} |`);
	}
	lines.push('');

	return lines.join('\n');
}
