/**
 * @fileoverview Interactive shell command
 */

import * as readline from 'node:readline';
import { createClient } from '@lushly-dev/afd-client';
import chalk from 'chalk';
import type { Command } from 'commander';
import { getConfig, setConfig } from '../config.js';
import { printError, printResult, printStatus, printSuccess, printTools } from '../output.js';
import { getClient, setClient } from './connect.js';

/**
 * Register the shell command.
 */
export function registerShellCommand(program: Command): void {
	program
		.command('shell')
		.description('Start an interactive shell')
		.option('-u, --url <url>', 'Server URL to connect to')
		.action(async (options) => {
			console.log(chalk.bold('AFD Interactive Shell'));
			console.log(chalk.dim('Type "help" for available commands, "exit" to quit'));
			console.log();

			// Auto-connect if URL provided or saved
			const url = options.url || getConfig().serverUrl;
			if (url) {
				try {
					console.log(chalk.dim(`Connecting to ${url}...`));
					const client = createClient({ url });
					await client.connect();
					setClient(client);
					printSuccess('Connected');
					setConfig('serverUrl', url);
				} catch (error) {
					printError('Auto-connect failed', error instanceof Error ? error : undefined);
				}
				console.log();
			}

			// Start REPL
			const rl = readline.createInterface({
				input: process.stdin,
				output: process.stdout,
				prompt: getPrompt(),
			});

			rl.prompt();

			rl.on('line', async (line) => {
				const trimmed = line.trim();

				if (!trimmed) {
					rl.prompt();
					return;
				}

				try {
					await processCommand(trimmed);
				} catch (error) {
					printError('Command failed', error instanceof Error ? error : undefined);
				}

				// Update prompt (connection status may have changed)
				rl.setPrompt(getPrompt());
				rl.prompt();
			});

			rl.on('close', () => {
				console.log();
				console.log('Goodbye!');
				process.exit(0);
			});
		});
}

/**
 * Get the shell prompt.
 */
function getPrompt(): string {
	const client = getClient();
	const connected = client?.isConnected();

	if (connected) {
		return `${chalk.green('afd') + chalk.dim(':') + chalk.cyan('connected')}> `;
	}
	return `${chalk.yellow('afd')}> `;
}

/**
 * Process a shell command.
 */
async function processCommand(input: string): Promise<void> {
	const [cmd, ...args] = input.split(/\s+/);

	switch (cmd?.toLowerCase()) {
		case 'help':
		case '?':
			printHelp();
			break;

		case 'exit':
		case 'quit':
		case 'q': {
			const client = getClient();
			if (client) {
				await client.disconnect();
			}
			process.exit(0);
			break;
		}

		case 'connect':
			await handleConnect(args);
			break;

		case 'disconnect':
			await handleDisconnect();
			break;

		case 'status':
			handleStatus();
			break;

		case 'tools':
		case 'list':
			await handleTools(args);
			break;

		case 'call':
			await handleCall(args);
			break;

		case 'clear':
			console.clear();
			break;

		default:
			// Try as a tool call
			if (cmd?.includes('.')) {
				await handleCall([cmd, ...args]);
			} else {
				printError(`Unknown command: ${cmd}. Type "help" for available commands.`);
			}
	}
}

/**
 * Print help.
 */
function printHelp(): void {
	console.log(chalk.bold('Available Commands:'));
	console.log();
	console.log(`  ${chalk.cyan('connect <url>')}     Connect to an MCP server`);
	console.log(`  ${chalk.cyan('disconnect')}        Disconnect from server`);
	console.log(`  ${chalk.cyan('status')}            Show connection status`);
	console.log(`  ${chalk.cyan('tools')}             List available tools`);
	console.log(`  ${chalk.cyan('call <name> [args]')} Call a tool`);
	console.log(`  ${chalk.cyan('<name> [args]')}     Shorthand for call`);
	console.log(`  ${chalk.cyan('clear')}             Clear the screen`);
	console.log(`  ${chalk.cyan('help')}              Show this help`);
	console.log(`  ${chalk.cyan('exit')}              Exit the shell`);
	console.log();
	console.log(chalk.dim('Examples:'));
	console.log(chalk.dim('  connect http://localhost:3100/sse'));
	console.log(chalk.dim('  call document.create {"title":"Test"}'));
	console.log(chalk.dim('  document.get id=doc-123'));
}

/**
 * Handle connect command.
 */
async function handleConnect(args: string[]): Promise<void> {
	const url = args[0];
	if (!url) {
		printError('Usage: connect <url>');
		return;
	}

	const existingClient = getClient();
	if (existingClient) {
		await existingClient.disconnect();
	}

	try {
		const client = createClient({ url });
		await client.connect();
		setClient(client);
		setConfig('serverUrl', url);
		printSuccess(`Connected to ${url}`);
	} catch (error) {
		printError('Connection failed', error instanceof Error ? error : undefined);
	}
}

/**
 * Handle disconnect command.
 */
async function handleDisconnect(): Promise<void> {
	const client = getClient();
	if (!client) {
		printError('Not connected');
		return;
	}

	await client.disconnect();
	setClient(null);
	printSuccess('Disconnected');
}

/**
 * Handle status command.
 */
function handleStatus(): void {
	const client = getClient();

	if (!client) {
		printStatus({ connected: false });
		return;
	}

	const status = client.getStatus();
	printStatus({
		connected: status.state === 'connected',
		url: status.url,
		serverName: status.serverInfo?.name,
		serverVersion: status.serverInfo?.version,
	});
}

/**
 * Handle tools command.
 */
async function handleTools(args: string[]): Promise<void> {
	const client = getClient();
	if (!client?.isConnected()) {
		printError('Not connected');
		return;
	}

	let tools = client.getTools();
	if (tools.length === 0) {
		tools = await client.refreshTools();
	}

	// Filter by category
	const category = args[0];
	if (category) {
		tools = tools.filter((t) => t.name.startsWith(`${category}.`));
	}

	printTools(tools);
}

/**
 * Handle call command.
 */
async function handleCall(args: string[]): Promise<void> {
	const client = getClient();
	if (!client?.isConnected()) {
		printError('Not connected');
		return;
	}

	const [name, ...rest] = args;
	if (!name) {
		printError('Usage: call <name> [args]');
		return;
	}

	// Parse arguments
	let parsedArgs: Record<string, unknown> = {};
	const argsStr = rest.join(' ');

	if (argsStr) {
		try {
			if (argsStr.startsWith('{')) {
				parsedArgs = JSON.parse(argsStr);
			} else {
				// Parse key=value pairs
				for (const pair of argsStr.split(/\s+/)) {
					const [key, ...valueParts] = pair.split('=');
					if (key && valueParts.length > 0) {
						const value = valueParts.join('=');
						try {
							parsedArgs[key] = JSON.parse(value);
						} catch {
							parsedArgs[key] = value;
						}
					}
				}
			}
		} catch (_error) {
			printError('Invalid arguments. Use JSON or key=value format.');
			return;
		}
	}

	try {
		const result = await client.call(name, parsedArgs);
		printResult(result);
	} catch (error) {
		printError('Call failed', error instanceof Error ? error : undefined);
	}
}
