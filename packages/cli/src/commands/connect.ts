/**
 * @fileoverview Connect command
 */

import { createClient, type McpClient } from '@lushly-dev/afd-client';
import type { Command } from 'commander';
import ora from 'ora';
import { deleteConfig, getConfig, setConfig } from '../config.js';
import { ensureConnected, getClient, setClient } from '../connection.js';
import { printError, printStatus, printSuccess } from '../output.js';

export { getClient, setClient } from '../connection.js';

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
				const existingClient = getClient();
				if (existingClient) {
					await existingClient.disconnect();
				}

				// Create new client. `connect` is one-shot, so a dropped stream must
				// not start a reconnect loop that keeps the process alive.
				const client: McpClient = createClient({
					url,
					transport: options.transport as 'sse' | 'http',
					timeout: Number.parseInt(options.timeout, 10),
					autoReconnect: false,
				});
				setClient(client);

				// Connect
				const result = await client.connect();

				spinner.succeed('Connected');
				console.log();

				printStatus({
					connected: true,
					url,
					serverName: result.serverInfo.name,
					serverVersion: result.serverInfo.version,
				});

				// Save every option needed to reproduce this connection in another process.
				setConfig('serverUrl', url);
				setConfig('transport', options.transport as 'sse' | 'http');
				setConfig('timeout', Number.parseInt(options.timeout, 10));
				setConfig('autoReconnect', options.reconnect !== false);
			} catch (error) {
				await getClient()
					?.disconnect()
					.catch(() => undefined);
				setClient(null);
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
			const hadStoredConnection = Boolean(getConfig().serverUrl);
			const client = getClient();
			if (!client && !hadStoredConnection) {
				printError('Not connected to any server');
				return;
			}

			await client?.disconnect();
			setClient(null);
			deleteConfig('serverUrl');
			deleteConfig('transport');
			deleteConfig('autoReconnect');
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
		.action(async () => {
			const client = await ensureConnected();
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
		});
}
