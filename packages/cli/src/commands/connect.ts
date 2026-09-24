/**
 * @fileoverview Connect command
 */

import type { Command } from 'commander';
import ora from 'ora';
import {
	type CliTransport,
	deleteConfig,
	getConfig,
	getConfigPath,
	saveConnection,
} from '../config.js';
import {
	type ConnectFlags,
	createCliClient,
	getClient,
	headersOrExit,
	setClient,
	tryConnect,
} from '../connection.js';
import { HEADERS_ENV, redactUrl, urlHasCredentials } from '../credentials.js';
import {
	printClientStatus,
	printError,
	printInfo,
	printStatus,
	printSuccess,
	printWarning,
} from '../output.js';
import { headerOption, transportOption } from './options.js';

export { getClient, setClient } from '../connection.js';

interface ConnectOptions extends ConnectFlags {
	transport: CliTransport;
	timeout: string;
	reconnect: boolean;
}

/**
 * Register the connect command.
 */
export function registerConnectCommand(program: Command): void {
	program
		.command('connect')
		.description('Connect to an MCP server and save the connection for later commands')
		.argument('<url>', 'Server URL (e.g., http://localhost:3100/sse)')
		.addOption(transportOption('Transport type', 'sse'))
		.option('--timeout <ms>', 'Connection timeout in milliseconds', '30000')
		.option(
			'--no-reconnect',
			'Save the connection with auto-reconnect off: "afd shell" will not reconnect when it drops'
		)
		.addOption(headerOption())
		.action(async (url: string, options: ConnectOptions) => {
			const headers = headersOrExit(options.header);
			const timeout = Number.parseInt(options.timeout, 10);
			const spinner = ora('Connecting...').start();

			try {
				// Disconnect existing client
				await getClient()?.disconnect();

				// `connect` is one-shot, so a dropped stream must not start a
				// reconnect loop that keeps the process alive. `--no-reconnect`
				// is saved for `afd shell`, the only long-lived client.
				const client = createCliClient({
					url,
					transport: options.transport,
					timeout,
					autoReconnect: false,
					headers,
				});
				setClient(client);

				const result = await client.connect();

				spinner.succeed('Connected');
				console.log();

				printStatus({
					connected: true,
					url,
					serverName: result.serverInfo.name,
					serverVersion: result.serverInfo.version,
				});

				// Save every option needed to reproduce this connection in another
				// process, except the headers: credentials are never written to disk.
				saveConnection({
					url,
					transport: options.transport,
					timeout,
					autoReconnect: options.reconnect !== false,
				});

				if (urlHasCredentials(url)) {
					console.log();
					printWarning(
						`The URL contains credentials and is saved in ${getConfigPath()} (readable only by you). ` +
							`Prefer --header "Authorization: Bearer <token>" or ${HEADERS_ENV}.`
					);
				}
				if (Object.keys(headers).length > 0) {
					console.log();
					printInfo(
						`Request headers are not saved. Pass --header again or set ${HEADERS_ENV} for later commands.`
					);
				}
			} catch (error) {
				await getClient()
					?.disconnect()
					.catch(() => undefined);
				setClient(null);
				spinner.fail('Connection failed');
				printError(
					`Could not connect to ${redactUrl(url)}`,
					error instanceof Error ? error : undefined
				);
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
		.addOption(headerOption())
		.action(async (options: ConnectFlags) => {
			const attempt = await tryConnect({ headers: headersOrExit(options.header) });
			printClientStatus(attempt.client);
			if (!attempt.client && attempt.url !== undefined) {
				printError(`Could not connect to ${redactUrl(attempt.url)}`, attempt.error);
			}
		});
}
