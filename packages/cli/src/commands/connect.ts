/**
 * @fileoverview Connect command
 */

import { createClient, type McpClient } from '@lushly-dev/afd-client';
import type { Command } from 'commander';
import ora from 'ora';
import { setConfig } from '../config.js';
import { printError, printStatus, printSuccess } from '../output.js';

let activeClient: McpClient | null = null;

/**
 * Get the active client.
 */
export function getClient(): McpClient | null {
	return activeClient;
}

/**
 * Set the active client.
 */
export function setClient(client: McpClient | null): void {
	activeClient = client;
}

/**
 * Register the connect command.
 */
export function registerConnectCommand(program: Command): void {
	program
		.command('connect')
		.description('Connect to an MCP server')
		.argument('<url>', 'Server URL (e.g., http://localhost:3100/sse)')
		.option('-t, --transport <type>', 'Transport type (sse, http)', 'sse')
		.option('--timeout <ms>', 'Connection timeout in milliseconds', '30000')
		.option('--no-reconnect', 'Disable auto-reconnection')
		.action(async (url: string, options) => {
			const spinner = ora('Connecting...').start();

			try {
				// Disconnect existing client
				if (activeClient) {
					await activeClient.disconnect();
				}

				// Create new client
				activeClient = createClient({
					url,
					transport: options.transport as 'sse' | 'http',
					timeout: Number.parseInt(options.timeout, 10),
					autoReconnect: options.reconnect !== false,
				});

				// Connect
				const result = await activeClient.connect();

				spinner.succeed('Connected');
				console.log();

				printStatus({
					connected: true,
					url,
					serverName: result.serverInfo.name,
					serverVersion: result.serverInfo.version,
				});

				// Save URL for future use
				setConfig('serverUrl', url);
			} catch (error) {
				spinner.fail('Connection failed');
				printError('Could not connect to server', error instanceof Error ? error : undefined);
				process.exit(1);
			}
		});
}

/**
 * Register the disconnect command.
 */
export function registerDisconnectCommand(program: Command): void {
	program
		.command('disconnect')
		.description('Disconnect from the MCP server')
		.action(async () => {
			if (!activeClient) {
				printError('Not connected to any server');
				return;
			}

			await activeClient.disconnect();
			activeClient = null;
			printSuccess('Disconnected');
		});
}

/**
 * Register the status command.
 */
export function registerStatusCommand(program: Command): void {
	program
		.command('status')
		.description('Show connection status')
		.action(() => {
			if (!activeClient) {
				printStatus({ connected: false });
				return;
			}

			const status = activeClient.getStatus();
			printStatus({
				connected: status.state === 'connected',
				url: status.url,
				serverName: status.serverInfo?.name,
				serverVersion: status.serverInfo?.version,
			});
		});
}
