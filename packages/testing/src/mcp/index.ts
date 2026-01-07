/**
 * @fileoverview MCP integration for @lushly-dev/afd-testing
 *
 * Exports MCP server, tools, and agent hints for AI agent integration.
 */

// Server
export {
  createMcpTestingServer,
  runStdioServer,
  type McpTestingServer,
  type McpTestingServerOptions,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type JsonRpcError,
} from './server.js';

// Tools
export {
  generateTools,
  createToolRegistry,
  executeTool,
  getTool,
  type McpTool,
  type RegisteredTool,
  type ToolHandler,
  type ToolExecutionContext,
} from './tools.js';

// Agent Hints
export {
  generateAgentHints,
  generateTestReportHints,
  generateCoverageHints,
  enhanceWithAgentHints,
  type AgentHints,
  type AgentEnhancedResult,
} from './hints.js';
