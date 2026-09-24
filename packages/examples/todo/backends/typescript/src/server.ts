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
 *   afd call todo-create '{"title": "My first todo"}'
 */

import { createMcpServer } from '@lushly-dev/afd-server';
import { allCommands } from './commands/index.js';
import { createTodoServerOptions } from './server-options.js';

// Transport mode: "auto" (default), "http" (for UI), or "stdio" (for MCP clients)
const TRANSPORT = (process.env.TRANSPORT ?? 'auto') as 'auto' | 'http' | 'stdio';

/**
 * Dev mode: enables verbose errors, stack traces and any browser origin.
 * Set NODE_ENV=development to enable, or NODE_ENV=production for secure defaults.
 */
const DEV_MODE = process.env.NODE_ENV === 'development';

/**
 * Main entry point.
 */
async function main() {
	// Browser access: the dev frontends from the README (ports 3000, 5173 and 5174)
	// plus ALLOWED_ORIGINS. See server-options.ts.
	const options = createTodoServerOptions(process.env);
	const server = createMcpServer({ ...options, transport: TRANSPORT });

	// Only log startup messages if running interactively (TTY/HTTP mode)
	// In stdio mode, stderr output can interfere with MCP protocol on some clients
	const isInteractive = process.stdin.isTTY;

	if (isInteractive) {
		console.error('Starting Todo App MCP Server...');
		console.error(`  Name: todo-app`);
		console.error(`  Version: 1.0.0`);
		console.error(
			`  Mode: ${
				DEV_MODE
					? '🔧 DEVELOPMENT (verbose errors, any browser origin)'
					: '🔒 PRODUCTION (secure defaults)'
			}`
		);
		console.error(`  Commands: ${allCommands.length}`);
		console.error('');
	}

	await server.start();

	if (isInteractive) {
		console.error(`Server running at ${server.getUrl()}`);
		console.error('');
		console.error('Connect with the AFD CLI:');
		console.error(`  afd connect ${server.getUrl()}/sse`);
		console.error('');
		console.error('Or start a frontend (from packages/examples/todo):');
		console.error('  pnpm dev:web     # http://localhost:3000');
		console.error('  pnpm dev:react   # http://localhost:5173');
		if (!DEV_MODE) {
			console.error(`  Allowed browser origins: ${options.allowedOrigins?.join(', ')}`);
		}
		console.error('');
		console.error('Available commands:');
		for (const cmd of server.getCommands()) {
			console.error(`  - ${cmd.name}: ${cmd.description}`);
		}
		console.error('');
		console.error('Press Ctrl+C to stop.');
	}

	// Handle shutdown
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

// Run
main().catch((error) => {
	console.error('Failed to start server:', error);
	process.exit(1);
});
