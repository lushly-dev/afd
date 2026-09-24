/**
 * @fileoverview Interactive shell command
 */

import * as readline from 'node:readline';
import chalk from 'chalk';
import type { Command } from 'commander';
import { describeArgsError, parseToolArgs } from '../args.js';
import { type CliTransport, getConfig, saveConnection } from '../config.js';
import {
	type ConnectFlags,
	closeClient,
	createCliClient,
	getClient,
	headersOrExit,
	inferTransport,
	setClient,
} from '../connection.js';
import { redactUrl } from '../credentials.js';
import { printClientStatus, printError, printResult, printSuccess, printTools } from '../output.js';
import { terminalText } from '../terminal.js';
import { matchesCategory } from '../tool-category.js';
import { headerOption, TRANSPORTS, transportOption } from './options.js';

interface ShellOptions extends ConnectFlags {
	url?: string;
	transport?: CliTransport;
	timeout?: string;
	reconnect: boolean;
}

/** Settings shared by every connection the shell opens, and its exit state. */
interface ShellSession {
	timeout: number;
	/** `--no-reconnect` turns this off for every connection. */
	reconnect: boolean;
	/** Request headers; never saved. */
	headers: Record<string, string>;
	/** Set by `exit`: lines still queued after it are ignored. */
	exiting: boolean;
	close: () => void;
}

/** Shape of an AFD command name (`todo-create`, legacy `todo.create`) for shorthand calls. */
const COMMAND_NAME = /^[A-Za-z0-9_]+(?:[-.][A-Za-z0-9_]+)+$/;

/**
 * Register the shell command.
 */
export function registerShellCommand(program: Command): void {
	program
		.command('shell')
		.description('Start an interactive shell')
		.option('-u, --url <url>', 'Server URL to connect to (default: the saved connection)')
		.addOption(
			transportOption('Transport (default: the saved one, or sse for a /sse URL, else http)')
		)
		.option('--timeout <ms>', 'Request timeout in milliseconds (default: the saved timeout)')
		.option('--no-reconnect', 'Do not reconnect automatically when the connection drops')
		.addOption(headerOption())
		.action(async (options: ShellOptions) => {
			const config = getConfig();
			const session: ShellSession = {
				timeout: options.timeout ? Number.parseInt(options.timeout, 10) : (config.timeout ?? 30000),
				reconnect: options.reconnect !== false,
				headers: headersOrExit(options.header),
				exiting: false,
				close: () => undefined,
			};

			console.log(chalk.bold('AFD Interactive Shell'));
			console.log(chalk.dim('Type "help" for available commands, "exit" to quit'));
			console.log();

			// Auto-connect to --url (and save it), or reopen the saved connection.
			if (options.url) {
				const url = options.url;
				const transport = options.transport ?? inferTransport(url);
				await openConnection(session, { url, transport, autoReconnect: session.reconnect }, true);
				console.log();
			} else if (config.serverUrl) {
				const url = config.serverUrl;
				const transport = options.transport ?? config.transport ?? inferTransport(url);
				// `afd connect --no-reconnect` saved the preference with the connection.
				const autoReconnect = session.reconnect && config.autoReconnect !== false;
				await openConnection(session, { url, transport, autoReconnect }, false);
				console.log();
			}

			const rl = readline.createInterface({
				input: process.stdin,
				output: process.stdout,
				prompt: getPrompt(),
			});
			session.close = () => rl.close();

			let closed = false;
			const handleLine = async (line: string): Promise<void> => {
				if (session.exiting) return;
				const trimmed = line.trim();
				if (trimmed) {
					try {
						await processCommand(session, trimmed);
					} catch (error) {
						printError('Command failed', error instanceof Error ? error : undefined);
					}
				}

				if (closed) return;
				// Update prompt (connection status may have changed)
				rl.setPrompt(getPrompt());
				rl.prompt();
			};

			rl.prompt();

			// Run lines one at a time, so piped input keeps its order and closing
			// the input waits for commands that are still queued or in flight.
			let queue = Promise.resolve();
			rl.on('line', (line) => {
				queue = queue.then(() => handleLine(line));
				return queue;
			});

			// The shell's lifetime is the command's lifetime: it disconnects only
			// after every queued line has run.
			await new Promise<void>((resolve) => {
				rl.on('close', () => {
					closed = true;
					void queue.then(async () => {
						await closeClient();
						console.log();
						console.log('Goodbye!');
						resolve();
					});
				});
			});
		});
}

/**
 * Get the shell prompt.
 */
function getPrompt(): string {
	if (getClient()?.isConnected()) {
		return `${chalk.green('afd') + chalk.dim(':') + chalk.cyan('connected')}> `;
	}
	return `${chalk.yellow('afd')}> `;
}

/** Split off the first whitespace-delimited word; the rest of the line stays raw. */
function splitHead(text: string): { head: string; rest: string } {
	const match = /^(\S*)\s*([\s\S]*)$/.exec(text.trim());
	return { head: match?.[1] ?? '', rest: match?.[2] ?? '' };
}

/**
 * Process a shell command. Only the first word is split off; tool arguments
 * are parsed from the raw rest of the line, so whitespace inside JSON strings
 * and quoted values survives.
 */
async function processCommand(session: ShellSession, input: string): Promise<void> {
	const { head: cmd, rest } = splitHead(input);

	switch (cmd.toLowerCase()) {
		case 'help':
		case '?':
			printHelp();
			break;

		case 'exit':
		case 'quit':
		case 'q':
			// Closing the input lets queued work finish and the client disconnect.
			session.exiting = true;
			session.close();
			break;

		case 'connect':
			await handleConnect(session, rest);
			break;

		case 'disconnect':
			await handleDisconnect();
			break;

		case 'status':
			printClientStatus(getClient());
			break;

		case 'tools':
		case 'list':
			await handleTools(rest);
			break;

		case 'call': {
			const { head: name, rest: args } = splitHead(rest);
			await handleCall(name, args);
			break;
		}

		case 'clear':
			console.clear();
			break;

		default:
			if (await isToolName(cmd)) {
				await handleCall(cmd, rest);
			} else {
				printError(
					`Unknown command: ${cmd}. Type "help" for shell commands or "tools" to list tools.`
				);
			}
	}
}

/**
 * Whether a word that is not a shell command should be called as a tool: it
 * names a listed tool, or it has the shape of an AFD command name. The second
 * case covers grouped and lazy servers, which do not list every command.
 */
async function isToolName(name: string): Promise<boolean> {
	const client = getClient();
	if (client?.isConnected()) {
		let tools = client.getTools();
		if (tools.length === 0) tools = await client.refreshTools();
		if (tools.some((tool) => tool.name === name)) return true;
	}
	return COMMAND_NAME.test(name);
}

/**
 * Print help.
 */
function printHelp(): void {
	console.log(chalk.bold('Available Commands:'));
	console.log();
	console.log(`  ${chalk.cyan('connect <url> [sse|http]')} Connect to an MCP server`);
	console.log(`  ${chalk.cyan('disconnect')}        Disconnect from server`);
	console.log(`  ${chalk.cyan('status')}            Show connection status`);
	console.log(`  ${chalk.cyan('tools [category]')}  List available tools`);
	console.log(`  ${chalk.cyan('call <name> [args]')} Call a tool`);
	console.log(`  ${chalk.cyan('<name> [args]')}     Shorthand for call`);
	console.log(`  ${chalk.cyan('clear')}             Clear the screen`);
	console.log(`  ${chalk.cyan('help')}              Show this help`);
	console.log(`  ${chalk.cyan('exit')}              Exit the shell`);
	console.log();
	console.log(chalk.dim('Examples:'));
	console.log(chalk.dim('  connect http://localhost:3100/sse'));
	console.log(chalk.dim('  call todo-create {"title": "Buy milk"}'));
	console.log(chalk.dim('  todo-get id=todo-123'));
	console.log(chalk.dim('  todo-update id=todo-123 title="Buy oat milk"'));
}

/**
 * Open a connection with the session's timeout, reconnect policy and headers,
 * replacing the current one. `save` stores it as the default connection.
 */
async function openConnection(
	session: ShellSession,
	target: { url: string; transport: CliTransport; autoReconnect: boolean },
	save: boolean
): Promise<void> {
	await closeClient();
	const shownUrl = redactUrl(target.url);
	console.log(chalk.dim(`Connecting to ${terminalText(shownUrl)}...`));

	const client = createCliClient({ ...target, timeout: session.timeout, headers: session.headers });
	try {
		await client.connect();
		setClient(client);
		if (save) {
			saveConnection({ ...target, timeout: session.timeout });
		}
		printSuccess(`Connected to ${shownUrl}`);
	} catch (error) {
		await client.disconnect().catch(() => undefined);
		printError('Connection failed', error instanceof Error ? error : undefined);
	}
}

/**
 * Handle `connect <url> [sse|http]`.
 */
async function handleConnect(session: ShellSession, rest: string): Promise<void> {
	const [url, transport, ...extra] = rest.split(/\s+/).filter(Boolean);
	const valid = transport === undefined || (TRANSPORTS as readonly string[]).includes(transport);
	if (!url || !valid || extra.length > 0) {
		printError('Usage: connect <url> [sse|http]');
		return;
	}

	await openConnection(
		session,
		{
			url,
			transport: (transport as CliTransport | undefined) ?? inferTransport(url),
			autoReconnect: session.reconnect,
		},
		true
	);
}

/**
 * Handle disconnect command.
 */
async function handleDisconnect(): Promise<void> {
	if (!getClient()) {
		printError('Not connected');
		return;
	}

	await closeClient();
	printSuccess('Disconnected');
}

/**
 * Handle `tools [category]`.
 */
async function handleTools(rest: string): Promise<void> {
	const client = getClient();
	if (!client?.isConnected()) {
		printError('Not connected');
		return;
	}

	let tools = client.getTools();
	if (tools.length === 0) {
		tools = await client.refreshTools();
	}

	const category = rest.trim();
	if (category) {
		tools = tools.filter((t) => matchesCategory(t, category));
	}

	printTools(tools);
}

/**
 * Handle a tool call; `rawArgs` is the unsplit rest of the line.
 */
async function handleCall(name: string, rawArgs: string): Promise<void> {
	const client = getClient();
	if (!client?.isConnected()) {
		printError('Not connected');
		return;
	}

	if (!name) {
		printError('Usage: call <name> [args]');
		return;
	}

	let parsedArgs: Record<string, unknown>;
	try {
		parsedArgs = parseToolArgs(rawArgs);
	} catch (error) {
		printError(describeArgsError(error));
		return;
	}

	try {
		const result = await client.call(name, parsedArgs);
		printResult(result);
	} catch (error) {
		printError('Call failed', error instanceof Error ? error : undefined);
	}
}
