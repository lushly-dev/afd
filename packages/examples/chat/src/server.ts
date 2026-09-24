/**
 * @fileoverview Chat app MCP server entry point
 *
 * This file creates and starts an MCP server exposing all chat commands,
 * along with a WebSocket server for real-time messaging that also serves
 * the browser demo.
 *
 * Usage:
 *   node dist/server.js
 *
 * Then connect with the AFD CLI:
 *   afd connect http://localhost:3100/sse
 *   afd call chat-rooms
 *   afd call chat-connect '{"roomId": "general", "nickname": "CLI-User"}'
 *
 * Or open the browser demo at http://localhost:3001. It calls chat-connect
 * through the MCP server's /rpc route, which validates input, checks
 * `expose.mcp`, runs middleware and caps the body size.
 */

import { createMcpServer } from '@lushly-dev/afd-server';
import { allCommands } from './commands/index.js';
import { type ChatConfig, createChatMcpOptions, loadChatConfig } from './config.js';
import { createWebSocketServer } from './ws-server.js';

const TRANSPORT = (process.env.TRANSPORT ?? 'auto') as 'auto' | 'http' | 'stdio';

/**
 * Main entry point.
 */
async function main() {
	const config: ChatConfig = loadChatConfig(process.env);
	const server = createMcpServer({
		...createChatMcpOptions(config, allCommands),
		transport: TRANSPORT,
	});
	const isInteractive = process.stdin.isTTY;

	if (isInteractive) {
		console.error('Starting Chat App...');
		console.error(`  MCP Server: chat-app v1.0.0`);
		console.error(
			`  Mode: ${
				config.devMode
					? '🔧 DEVELOPMENT (verbose errors, any browser origin)'
					: '🔒 PRODUCTION (secure defaults)'
			}`
		);
		console.error(`  Commands: ${allCommands.length}`);
		console.error('');
	}

	// Start MCP server
	await server.start();

	// Start WebSocket server (also serves the browser demo)
	const realtime = createWebSocketServer({
		port: config.wsPort,
		host: config.host,
		maxPayload: config.wsMaxPayload,
		allowedOrigins: config.allowedOrigins,
		allowedHosts: config.allowedHosts,
	});
	await realtime.ready;

	if (isInteractive) {
		console.error(`MCP Server running at ${server.getUrl()}`);
		console.error(`WebSocket Server running at ws://${config.host}:${config.wsPort}`);
		console.error(`Browser demo at http://localhost:${config.wsPort}`);
		console.error(`Allowed browser origins: ${config.allowedOrigins.join(', ')}`);
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
		await realtime.close();
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
