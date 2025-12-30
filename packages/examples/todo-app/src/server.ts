/**
 * @fileoverview Todo app MCP server entry point
 *
 * This file creates and starts an MCP server exposing all todo commands.
 *
 * Usage:
 *   node dist/server.js
 *
 * Then connect with the AFD CLI:
 *   afd connect http://localhost:3100/sse
 *   afd tools
 *   afd call todo.create '{"title": "My first todo"}'
 */

import { createMcpServer, createLoggingMiddleware } from '@afd/server';
import { allCommands } from './commands/index.js';

// Configuration from environment
const PORT = parseInt(process.env.PORT ?? '3100', 10);
const HOST = process.env.HOST ?? 'localhost';
const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';

/**
 * Create and configure the MCP server.
 */
function createServer() {
	return createMcpServer({
		name: 'todo-app',
		version: '1.0.0',
		commands: allCommands,
		port: PORT,
		host: HOST,
		cors: true,

		// Add logging middleware in development
		middleware:
			LOG_LEVEL === 'debug'
				? [createLoggingMiddleware({ logInput: true, logResult: true })]
				: [createLoggingMiddleware()],

		// Log command execution
		onCommand(command, input, result) {
			if (LOG_LEVEL === 'debug') {
				console.log(`[Command] ${command}:`, { input, result });
			}
		},

		// Log errors
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

	console.log('Starting Todo App MCP Server...');
	console.log(`  Name: todo-app`);
	console.log(`  Version: 1.0.0`);
	console.log(`  Commands: ${allCommands.length}`);
	console.log('');

	await server.start();

	console.log(`Server running at ${server.getUrl()}`);
	console.log('');
	console.log('Connect with the AFD CLI:');
	console.log(`  afd connect ${server.getUrl()}/sse`);
	console.log('');
	console.log('Or open the UI:');
	console.log(`  Open ui/index.html in a browser`);
	console.log('');
	console.log('Available commands:');
	for (const cmd of server.getCommands()) {
		console.log(`  - ${cmd.name}: ${cmd.description}`);
	}
	console.log('');
	console.log('Press Ctrl+C to stop.');

	// Handle shutdown
	process.on('SIGINT', async () => {
		console.log('\nShutting down...');
		await server.stop();
		process.exit(0);
	});

	process.on('SIGTERM', async () => {
		console.log('\nShutting down...');
		await server.stop();
		process.exit(0);
	});
}

// Run
main().catch((error) => {
	console.error('Failed to start server:', error);
	process.exit(1);
});
