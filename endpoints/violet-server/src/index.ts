/**
 * Violet Design MCP Server
 *
 * Model Context Protocol server exposing all Violet commands as AI tools.
 */

export { createMcpServer, type ServerOptions } from './server.js';
export { generateTools, type McpTool } from './tools/generator.js';
export { startStdioServer } from './transports/stdio.js';
export { createApiServer, type ApiServerOptions } from './api.js';
