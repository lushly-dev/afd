/**
 * @fileoverview Call command
 */

import { Writable } from 'node:stream';
import type { CommandResult } from '@lushly-dev/afd-core';
import chalk from 'chalk';
import type { Command } from 'commander';
import ora from 'ora';
import { approvalDetails, callWithApproval, interactiveApproval } from '../approval.js';
import { describeArgsError, parseToolArgs } from '../args.js';
import type { CliTransport } from '../config.js';
import { type ConnectFlags, requireClient } from '../connection.js';
import { type OutputFormat, printError, printResult } from '../output.js';
import { terminalText } from '../terminal.js';
import { headerOption, transportOption } from './options.js';
import { loadReplayTarget, ReplaySetupError } from './replay.js';

interface CallOptions extends ConnectFlags {
	connect?: string;
	transport?: CliTransport;
	timeout?: string;
	format: OutputFormat;
	verbose?: boolean;
	module?: string;
	export: string;
	approve?: boolean;
}

/**
 * Register the call command.
 */
export function registerCallCommand(program: Command): void {
	program
		.command('call')
		.description('Call a tool/command')
		.argument('<name>', 'Tool name (e.g., document-create)')
		.argument('[args]', 'JSON object or key=value pairs (quote values with spaces)')
		.option('--connect <url>', 'Use an MCP server URL for this call without changing saved config')
		.addOption(
			transportOption(
				'Transport type for --connect (default: inferred from the URL: sse for /sse, http for /message, streamable-http otherwise)',
				undefined,
				'--transport <type>'
			)
		)
		.option('--timeout <ms>', 'Connection timeout in milliseconds')
		.addOption(headerOption())
		.option('-f, --format <format>', 'Output format (json, text)', 'text')
		.option('-v, --verbose', 'Show detailed output including reasoning and sources')
		.option(
			'-m, --module <path>',
			'Run the command in-process on the registry this JavaScript module exports, instead of over MCP'
		)
		.option('--export <name>', 'Export to use from --module', 'default')
		.option(
			'--approve',
			'Approve without asking when the call is held for approval (needs --module)'
		)
		.addHelpText(
			'after',
			`
Approvals: when a call fails with APPROVAL_REQUIRED, an in-process call
(--module) shows the summary and expiry, asks "Approve? [y/N]" on a terminal,
and on yes retries the same command and input with the token the server
returned as the context's approval evidence. --approve approves without
asking, once, and still only with a token the server issued for this call.
With no terminal and no --approve, the APPROVAL_REQUIRED result is printed
unchanged and the exit code is 1.

Over MCP the CLI cannot deliver approval evidence: tool arguments never carry
it, and MCP has no trusted channel for it yet. The result is printed unchanged.`
		)
		.action(async (name: string, args: string | undefined, options: CallOptions) => {
			let parsedArgs: Record<string, unknown>;
			try {
				parsedArgs = parseToolArgs(args);
			} catch (error) {
				printError(describeArgsError(error));
				return process.exit(1);
			}

			if (options.module !== undefined) {
				if (options.connect !== undefined) {
					printError('--module and --connect cannot be used together');
					return process.exit(1);
				}
				const result = await callInProcess(name, parsedArgs, options);
				if (!result) return process.exit(1);
				printResult(result, { format: options.format, verbose: options.verbose });
				// Exit explicitly, since the loaded module may hold handles open.
				process.stdout.write('', () => process.exit(result.success ? 0 : 1));
				return;
			}
			if (options.approve) {
				printError(
					'--approve needs --module: over MCP the CLI cannot deliver approval evidence (tool arguments never carry it)'
				);
				return process.exit(1);
			}

			const client = await requireClient(options, {
				url: options.connect,
				transport: options.transport,
				timeout: options.timeout ? Number.parseInt(options.timeout, 10) : undefined,
			});

			const spinner = ora(`Calling ${terminalText(name)}...`).start();

			try {
				const result = await client.call(name, parsedArgs);
				spinner.stop();

				printResult(result, {
					format: options.format,
					verbose: options.verbose,
				});
				if (approvalDetails(result) && options.format !== 'json') {
					console.error(
						chalk.dim(
							'The CLI cannot approve a call over MCP: approval evidence needs a trusted channel, and tool arguments never carry it. Approve it in the application, or run it in-process with --module.'
						)
					);
				}

				// Exit with error code if command failed
				if (!result.success) {
					process.exit(1);
				}
			} catch (error) {
				spinner.fail(`Failed to call ${terminalText(name)}`);
				printError('Command execution failed', error instanceof Error ? error : undefined);
				process.exit(1);
			}
		});
}

/**
 * Run the call on the registry `options.module` exports, through the approval flow. Returns
 * `undefined` after printing the error when the module cannot be loaded.
 */
async function callInProcess(
	name: string,
	input: Record<string, unknown>,
	options: CallOptions
): Promise<CommandResult | undefined> {
	let registry: Awaited<ReturnType<typeof loadReplayTarget>>;
	try {
		registry = await loadReplayTarget(options.module as string, options.export);
	} catch (error) {
		printError(error instanceof Error ? error.message : String(error));
		if (error instanceof ReplaySetupError) {
			console.error(chalk.dim('Suggestion:'), terminalText(error.suggestion));
		}
		return undefined;
	}

	const prompt = options.approve ? undefined : interactiveApproval();
	try {
		return await callWithApproval(
			name,
			// Same command, input and context on every attempt; only the evidence is added.
			(approval) =>
				registry.execute(name, input, {
					interface: 'cli',
					...(approval !== undefined ? { approval } : {}),
				}),
			{
				approve: options.approve === true,
				...(prompt ? { prompt } : {}),
				// Keep stderr quiet for JSON consumers unless a human is being asked.
				output:
					options.format === 'json' && !prompt
						? new Writable({ write: (_chunk, _encoding, done) => done() })
						: process.stderr,
			}
		);
	} catch (error) {
		printError('Command execution failed', error instanceof Error ? error : undefined);
		return undefined;
	}
}
