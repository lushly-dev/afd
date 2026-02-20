/**
 * @fileoverview MCP integration for @lushly-dev/afd-testing
 *
 * Exports MCP server, tools, and agent hints for AI agent integration.
 */

// Agent Hints
export {
	type AgentEnhancedResult,
	type AgentHints,
	enhanceWithAgentHints,
	generateAgentHints,
	generateCoverageHints,
	generateTestReportHints,
} from './hints.js';
// Server
export {
	createMcpTestingServer,
	type JsonRpcError,
	type JsonRpcRequest,
	type JsonRpcResponse,
	type McpTestingServer,
	type McpTestingServerOptions,
	runStdioServer,
} from './server.js';
// Tools
export {
	createToolRegistry,
	executeTool,
	generateTools,
	getTool,
	type McpTool,
	type RegisteredTool,
	type ToolExecutionContext,
	type ToolHandler,
} from './tools.js';
