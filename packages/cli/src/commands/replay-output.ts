/**
 * @fileoverview Output for `afd replay`: a per-entry diff summary, as text or JSON.
 *
 * Journal values are untrusted, so every one passes through `terminalText` in text mode.
 */

import type { ReplayDifference, ReplayEntryReport, ReplayReport } from '@lushly-dev/afd-server';
import chalk from 'chalk';
import type { OutputFormat } from '../output.js';
import { terminalText } from '../terminal.js';

/** Longest value shown in a text-mode difference before it is cut. */
const MAX_VALUE_CHARS = 80;

/** A value as short, terminal-safe JSON. */
export function formatDiffValue(value: unknown): string {
	const json = JSON.stringify(value) ?? 'undefined';
	const short = json.length > MAX_VALUE_CHARS ? `${json.slice(0, MAX_VALUE_CHARS)}…` : json;
	return terminalText(short);
}

/** One difference as a line: `~ path: recorded → replayed`, `+ path: value` or `- path: value`. */
export function formatDifference(difference: ReplayDifference): string {
	const path = terminalText(difference.path === '' ? '(result)' : difference.path);
	switch (difference.kind) {
		case 'added':
			return `${chalk.green('+')} ${path}: ${formatDiffValue(difference.replayed)}`;
		case 'removed':
			return `${chalk.red('-')} ${path}: ${formatDiffValue(difference.recorded)}`;
		default:
			return `${chalk.yellow('~')} ${path}: ${formatDiffValue(difference.recorded)} → ${formatDiffValue(difference.replayed)}`;
	}
}

function entryHeading(entry: ReplayEntryReport): string {
	const label = `#${terminalText(entry.seq)} ${chalk.cyan(terminalText(entry.command))}`;
	switch (entry.status) {
		case 'same':
			return `${chalk.green('✓')} ${label} ${chalk.dim('same')}`;
		case 'different':
			return `${chalk.red('✗')} ${label} ${chalk.red('different')}`;
		default:
			return `${chalk.red('!')} ${label} ${chalk.red('error')}`;
	}
}

/** The text-mode lines for one entry. */
export function formatReplayEntry(entry: ReplayEntryReport): string[] {
	const lines = [entryHeading(entry)];
	for (const difference of entry.differences ?? [])
		lines.push(`    ${formatDifference(difference)}`);
	if (entry.error !== undefined)
		lines.push(`    ${chalk.red('Error:')} ${terminalText(entry.error)}`);
	for (const note of entry.notes ?? [])
		lines.push(`    ${chalk.dim(`note: ${terminalText(note)}`)}`);
	return lines;
}

/**
 * Print a replay report. Text mode lists every entry that is not the same (all entries with
 * `verbose`) and a summary; JSON mode prints the whole report.
 */
export function printReplayReport(
	report: ReplayReport,
	options: { format?: OutputFormat; verbose?: boolean } = {}
): void {
	if (options.format === 'json') {
		console.log(JSON.stringify(report, null, 2));
		return;
	}

	for (const entry of report.entries) {
		if (entry.status === 'same' && !options.verbose) continue;
		for (const line of formatReplayEntry(entry)) console.log(line);
	}

	const parts = [
		chalk.green(`${report.same} same`),
		(report.different > 0 ? chalk.red : chalk.dim)(`${report.different} different`),
		(report.errors > 0 ? chalk.red : chalk.dim)(
			`${report.errors} error${report.errors === 1 ? '' : 's'}`
		),
	];
	if (report.skipped > 0) parts.push(chalk.dim(`${report.skipped} skipped`));
	const total = report.entries.length;
	if (report.entries.some((entry) => entry.status !== 'same' || options.verbose)) console.log();
	console.log(
		`${report.diverged ? chalk.red('✗ Replay diverged') : chalk.green('✓ Replay matched')}: ${total} entr${total === 1 ? 'y' : 'ies'} replayed, ${parts.join(', ')}`
	);
}
