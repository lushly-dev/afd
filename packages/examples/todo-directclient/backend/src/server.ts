/**
 * @fileoverview MCP Server entry point
 *
 * This file creates and starts an MCP server exposing all todo commands.
 * The registry is imported from the library, demonstrating that the same
 * commands can be used via MCP transport OR direct import.
 *
 * Usage:
 *   node dist/server.js
 */

import { createLoggingMiddleware, createMcpServer } from '@lushly-dev/afd-server';
import { allCommands } from './commands/index.js';
import { DEFAULT_CHAT_PORT, defaultAllowedOrigins, parsePositiveInt } from './http-security.js';

// Configuration from environment
const PORT = parseInt(process.env.PORT ?? '3200', 10); // Different port from main todo example
const HOST = process.env.HOST ?? 'localhost';
const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';
const TRANSPORT = (process.env.TRANSPORT ?? 'auto') as 'auto' | 'http' | 'stdio';
const DEV_MODE = process.env.NODE_ENV === 'development';
// The UI served by the chat server polls this server's /health.
const CHAT_PORT = parsePositiveInt('CHAT_PORT', process.env.CHAT_PORT, DEFAULT_CHAT_PORT);

/**
 * Create and configure the MCP server.
 */
function createServer() {
	return createMcpServer({
		name: 'todo-experiment',
		version: '0.1.0',
		commands: allCommands,
		// Adds the afd-help, afd-docs and afd-schema bootstrap tools
		bootstrap: true,
		port: PORT,
		host: HOST,
		devMode: DEV_MODE,
		transport: TRANSPORT,
		cors: true,
		// Exact browser origins only: the chat server's page, on each loopback name.
		allowedOrigins: defaultAllowedOrigins(CHAT_PORT),
		middleware:
			DEV_MODE || LOG_LEVEL === 'debug'
				? [createLoggingMiddleware({ logInput: true, logResult: true })]
				: [createLoggingMiddleware()],
	});
}

/**
 * Main entry point.
 */
async function main() {
	const server = createServer();
	const isInteractive = process.stdin.isTTY;

	if (isInteractive) {
		console.error('Starting In-Process Binding Experiment Server...');
		console.error(`  Port: ${PORT}`);
		console.error(`  Commands: ${allCommands.length}`);
		console.error('');
	}

	await server.start();

	if (isInteractive) {
		console.error(`Server running at ${server.getUrl()}`);
		console.error('');
		console.error('This server is for MCP transport comparison.');
		console.error('For direct execution, import the registry instead:');
		console.error('');
		console.error("  import { registry } from './index.js';");
		console.error("  await registry.execute('todo-create', { title: 'Fast!' });");
		console.error('');
		console.error('Press Ctrl+C to stop.');
	}

	process.on('SIGINT', async () => {
		console.error('\nShutting down...');
		await server.stop();
		process.exit(0);
	});

	process.on('SIGTERM', async () => {
		console.error('\nShutting down...');
		await server.stop();
		process.exit(0);
	});
}

main().catch((error) => {
	console.error('Failed to start server:', error);
	process.exit(1);
});
