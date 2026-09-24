/**
 * @fileoverview `afd validate --surface`: cross-command validation of the
 * server's tool listing.
 */

import type { McpTool } from '@lushly-dev/afd-core';
import {
	type SurfaceCommand,
	type SurfaceFinding,
	validateCommandSurface,
} from '@lushly-dev/afd-testing';
import chalk from 'chalk';
import ora from 'ora';
import { type ConnectFlags, requireClient } from '../connection.js';
import { printError, printInfo, printSuccess, printWarning } from '../output.js';
import { terminalText } from '../terminal.js';

export interface SurfaceOptions extends ConnectFlags {
	strict?: boolean;
	verbose?: boolean;
	similarityThreshold: string;
	skipCategory: string[];
	suppress: string[];
}

/** Preserve AFD metadata advertised by a remote MCP tools/list response. */
export function mapToolsToSurfaceCommands(tools: McpTool[]): SurfaceCommand[] {
	return tools.map((tool) => ({
		name: tool.name,
		description: tool.description ?? '',
		category: tool._meta?.category,
		jsonSchema: tool.inputSchema as SurfaceCommand['jsonSchema'],
		requires: tool._meta?.requires,
		examples: tool._meta?.examples,
		outputJsonSchema: tool._meta?.outputSchema as SurfaceCommand['outputJsonSchema'],
		contexts: tool._meta?.contexts,
	}));
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
		spinner.text = `Analyzing ${tools.length} commands...`;

		// Map MCP tool definitions to SurfaceCommand shape
		const commands = mapToolsToSurfaceCommands(tools);
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
