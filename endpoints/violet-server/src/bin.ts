#!/usr/bin/env node
/**
 * Violet MCP Server Binary
 *
 * Standalone binary for running the MCP server.
 * Can be used directly: npx violet-mcp
 */

import { startStdioServer } from './transports/stdio.js';

// Parse command line arguments
const args = process.argv.slice(2);
const useMemory = args.includes('--memory');
const dbPathIndex = args.findIndex((a) => a === '--db' || a === '--database');
const dbPath = dbPathIndex >= 0 ? args[dbPathIndex + 1] : undefined;

// Start server
startStdioServer({
	useMemory,
	dbPath,
}).catch((error) => {
	console.error('[violet-mcp] Fatal error:', error);
	process.exit(1);
});
