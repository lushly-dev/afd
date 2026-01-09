/**
 * @fileoverview Chat app MCP server entry point
 *
 * This file creates and starts an MCP server exposing all chat commands,
 * along with a WebSocket server for real-time messaging.
 *
 * Usage:
 *   node dist/server.js
 *
 * Then connect with the AFD CLI:
 *   afd connect http://localhost:3100/sse
 *   afd call chat-rooms
 *   afd call chat-connect '{"roomId": "general", "nickname": "CLI-User"}'
 */

import {
	createLoggingMiddleware,
	createMcpServer,
	getBootstrapCommands,
} from '@lushly-dev/afd-server';
import type { ZodCommandDefinition } from '@lushly-dev/afd-server';
import { allCommands } from './commands/index.js';
import { createWebSocketServer } from './ws-server.js';

// Configuration from environment
const PORT = Number.parseInt(process.env.PORT ?? '3100', 10);
const WS_PORT = Number.parseInt(process.env.WS_PORT ?? '3001', 10);
const HOST = process.env.HOST ?? 'localhost';
const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';
const TRANSPORT = (process.env.TRANSPORT ?? 'auto') as 'auto' | 'http' | 'stdio';
const DEV_MODE = process.env.NODE_ENV === 'development';

/**
 * Create and configure the MCP server.
 */
function createServer() {
	// Combine app commands with bootstrap tools (afd-help, afd-docs, afd-schema)
	const bootstrapCommands = getBootstrapCommands(
		() => allCommands as unknown as import('@lushly-dev/afd-core').CommandDefinition[]
	) as unknown as ZodCommandDefinition[];
	const allServerCommands = [...allCommands, ...bootstrapCommands];

	return createMcpServer({
		name: 'chat-app',
		version: '1.0.0',
		commands: allServerCommands,
		port: PORT,
		host: HOST,
		devMode: DEV_MODE,
		transport: TRANSPORT,
		cors: true,

		middleware:
			DEV_MODE || LOG_LEVEL === 'debug'
				? [createLoggingMiddleware({ logInput: true, logResult: true })]
				: [createLoggingMiddleware()],

		onCommand(command, input, result) {
			if (LOG_LEVEL === 'debug') {
				console.error(`[Command] ${command}:`, { input, result });
			}
		},

		onError(error) {
			console.error('[Error]', error);
		},
	});
}

/**
 * Main entry point.
 */
async function main() {
	const server = createServer();
	const isInteractive = process.stdin.isTTY;

	if (isInteractive) {
		console.error('Starting Chat App...');
		console.error(`  MCP Server: todo-app v1.0.0`);
		console.error(
			`  Mode: ${
				DEV_MODE
					? '🔧 DEVELOPMENT (verbose errors, permissive CORS)'
					: '🔒 PRODUCTION (secure defaults)'
			}`
		);
		console.error(`  Commands: ${allCommands.length}`);
		console.error('');
	}

	// Start MCP server
	await server.start();

	// Start WebSocket server
	const wss = createWebSocketServer(WS_PORT);

	if (isInteractive) {
		console.error(`MCP Server running at ${server.getUrl()}`);
		console.error(`WebSocket Server running at ws://${HOST}:${WS_PORT}`);
		console.error('');
		console.error('Connect with the AFD CLI:');
		console.error(`  afd connect ${server.getUrl()}/sse`);
		console.error('');
		console.error('Example usage:');
		console.error('  afd call chat-rooms');
		console.error(`  afd call chat-connect '{"roomId": "general", "nickname": "CLI-User"}'`);
		console.error('');
		console.error('Available commands:');
		for (const cmd of server.getCommands()) {
			console.error(`  - ${cmd.name}: ${cmd.description}`);
		}
		console.error('');
		console.error('Press Ctrl+C to stop.');
	}

	// Handle shutdown
	const shutdown = async () => {
		console.error('\nShutting down...');
		wss.close();
		await server.stop();
		process.exit(0);
	};

	process.on('SIGINT', shutdown);
	process.on('SIGTERM', shutdown);
}

// Run
main().catch((error) => {
	console.error('Failed to start server:', error);
	process.exit(1);
});
