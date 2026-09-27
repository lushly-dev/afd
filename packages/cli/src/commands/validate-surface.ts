/**
 * @fileoverview `afd validate --surface`: cross-command validation of the
 * server's tool listing.
 */

import { type SurfaceFinding, validateCommandSurface } from '@lushly-dev/afd-testing';
import chalk from 'chalk';
import ora from 'ora';
import { type ConnectFlags, requireClient } from '../connection.js';
import { printError, printInfo, printSuccess, printWarning } from '../output.js';
import { terminalText } from '../terminal.js';
import { collectSurfaceCommands, type SurfaceCommandSet } from './surface-commands.js';

export { mapToolsToSurfaceCommands } from './surface-commands.js';

export interface SurfaceOptions extends ConnectFlags {
	strict?: boolean;
	verbose?: boolean;
	similarityThreshold: string;
	skipCategory: string[];
	suppress: string[];
}

/** Say where the validated commands came from; names come from the server. */
function printSource(set: SurfaceCommandSet): void {
	const lines: string[] = [];
	if (set.discovered) {
		lines.push(`Commands listed with afd-discover and afd-detail (${set.commands.length})`);
	}
	if (set.expandedGroups.length > 0) {
		lines.push(`Grouped tools expanded into their commands: ${set.expandedGroups.join(', ')}`);
	}
	if (set.skippedBuiltins.length > 0) {
		lines.push(`Built-in AFD tools skipped: ${set.skippedBuiltins.join(', ')}`);
	}
	for (const line of lines) console.log(chalk.dim(`  ${terminalText(line)}`));
	if (lines.length > 0) console.log();
	for (const warning of set.warnings) printWarning(warning);
}

/** Print findings grouped by severity; finding text comes from server tool names and metadata. */
function printFindings(findings: SurfaceFinding[], verbose: boolean): void {
	const bySeverity: Record<string, SurfaceFinding[]> = {
		error: [],
		warning: [],
		info: [],
	};

	for (const finding of findings) {
		if (finding.suppressed) continue;
		bySeverity[finding.severity]?.push(finding);
	}

	for (const [severity, group] of Object.entries(bySeverity)) {
		if (group.length === 0) continue;

		const color =
			severity === 'error' ? chalk.red : severity === 'warning' ? chalk.yellow : chalk.blue;
		const icon = severity === 'error' ? '✗' : severity === 'warning' ? '△' : 'ℹ';

		console.log(color.bold(`${icon} ${severity.toUpperCase()} (${group.length}):`));

		for (const f of group) {
			console.log(color(`  ${terminalText(`${f.rule}: ${f.message}`)}`));
			console.log(chalk.dim(`    Commands: ${terminalText(f.commands.join(', '))}`));
			if (verbose) {
				console.log(chalk.dim(`    Fix: ${terminalText(f.suggestion)}`));
				if (f.evidence) {
					console.log(chalk.dim(`    Evidence: ${terminalText(JSON.stringify(f.evidence))}`));
				}
			}
		}
		console.log();
	}
}

export async function runSurfaceValidation(options: SurfaceOptions): Promise<void> {
	const client = await requireClient(options);

	const spinner = ora('Fetching tools for surface validation...').start();

	try {
		const tools = await client.refreshTools();
		spinner.text = 'Collecting commands...';

		// Validate the server's commands: grouped tools expanded, lazy servers
		// enumerated, AFD's built-in tools skipped.
		const surface = await collectSurfaceCommands(tools, client);
		const { commands } = surface;
		spinner.text = `Analyzing ${commands.length} commands...`;
		const configuredContexts = [...new Set(commands.flatMap((command) => command.contexts ?? []))];

		const result = validateCommandSurface(commands, {
			similarityThreshold: Number.parseFloat(options.similarityThreshold),
			strict: options.strict,
			skipCategories: options.skipCategory,
			suppressions: options.suppress,
			configuredContexts,
		});

		spinner.stop();

		console.log();
		console.log(chalk.bold('Surface Validation Results:'));
		console.log();
		printSource(surface);

		printFindings(result.findings, options.verbose === true);

		// Suppressed count
		if (result.summary.suppressedCount > 0) {
			console.log(chalk.dim(`  ${result.summary.suppressedCount} finding(s) suppressed`));
		}

		// Summary
		console.log(chalk.bold('Summary:'));
		console.log(`  ${result.summary.commandCount} commands analyzed`);
		console.log(
			`  ${result.summary.rulesEvaluated.length} rules evaluated in ${result.summary.durationMs}ms`
		);
		console.log(`  ${chalk.red(result.summary.errorCount)} errors`);
		console.log(`  ${chalk.yellow(result.summary.warningCount)} warnings`);
		console.log(`  ${chalk.blue(result.summary.infoCount)} info`);

		if (!result.valid) {
			console.log();
			printWarning('Surface validation failed. Fix the issues above.');
			process.exit(1);
		} else if (result.summary.warningCount > 0) {
			console.log();
			printInfo('Surface validation passed with warnings. Consider addressing them.');
		} else {
			console.log();
			printSuccess('Surface validation passed!');
		}
	} catch (error) {
		spinner.fail('Surface validation failed');
		printError('Could not complete surface validation', error instanceof Error ? error : undefined);
		process.exit(1);
	}
}
