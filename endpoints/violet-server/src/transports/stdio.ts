/**
 * Stdio Transport
 *
 * Starts the MCP server with stdio transport for CLI and agent usage.
 * This is the primary way to run the Violet MCP server.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { type ServerOptions, createMcpServer } from '../server.js';

/**
 * Start the MCP server with stdio transport
 *
 * This function starts the server and blocks until the connection is closed.
 * Typically invoked via: `violet mcp start`
 *
 * @param options Server configuration
 */
export async function startStdioServer(options: ServerOptions = {}): Promise<void> {
	const server = await createMcpServer(options);
	const transport = new StdioServerTransport();

	await server.connect(transport);

	// Log to stderr (stdout is for MCP protocol)
	console.error(
		`[violet-mcp] Server started (${
			options.useMemory ? 'memory' : options.dbPath || './violet.db'
		})`,
	);

	// Keep the process alive
	process.on('SIGINT', async () => {
		console.error('[violet-mcp] Shutting down...');
		await server.close();
		process.exit(0);
	});

	process.on('SIGTERM', async () => {
		console.error('[violet-mcp] Shutting down...');
		await server.close();
		process.exit(0);
	});
}
