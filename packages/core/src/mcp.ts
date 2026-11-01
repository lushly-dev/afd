/**
 * @fileoverview Model Context Protocol (MCP) types
 *
 * MCP is the current standard for AI agent communication.
 * These types define the JSON-RPC based protocol.
 */

/**
 * MCP JSON-RPC request format.
 */
export type McpId = string | number;

/**
 * MCP JSON-RPC request format.
 */
export interface McpRequest {
	/** JSON-RPC version, always '2.0' */
	jsonrpc: '2.0';

	/** Request ID for correlation */
	id: McpId;

	/** Method being called */
	method: string;

	/** Optional parameters */
	params?: Record<string, unknown>;
}

/**
 * MCP JSON-RPC response format.
 */
export interface McpResponse {
	/** JSON-RPC version, always '2.0' */
	jsonrpc: '2.0';

	/** Request ID this is responding to */
	id: McpId;

	/** Result if successful */
	result?: unknown;

	/** Error if failed */
	error?: McpError;
}

/**
 * MCP error format (JSON-RPC compliant).
 */
export interface McpError {
	/** Error code (see McpErrorCodes) */
	code: number;

	/** Human-readable error message */
	message: string;

	/** Additional error data */
	data?: unknown;
}

/**
 * Standard MCP error codes (JSON-RPC + MCP specific).
 */
export const McpErrorCodes = {
	// JSON-RPC standard errors
	PARSE_ERROR: -32700,
	INVALID_REQUEST: -32600,
	METHOD_NOT_FOUND: -32601,
	INVALID_PARAMS: -32602,
	INTERNAL_ERROR: -32603,

	// MCP 2026-07-28 errors (-32020 to -32099 is reserved for the MCP specification)
	/** The HTTP headers do not match the request body, or a required header is missing. */
	HEADER_MISMATCH: -32020,
	/** The request needs a client capability that its `_meta` does not declare. */
	MISSING_REQUIRED_CLIENT_CAPABILITY: -32021,
	/** The server does not serve the requested protocol version; `data.supported` lists those it does. */
	UNSUPPORTED_PROTOCOL_VERSION: -32022,

	/**
	 * @deprecated A 2025-era code: MCP 2026-07-28 has no initialization and servers must not
	 * emit `-32002`.
	 */
	SERVER_NOT_INITIALIZED: -32002,
	REQUEST_CANCELLED: -32800,
	CONTENT_MODIFIED: -32801,
} as const;

export type McpErrorCode = (typeof McpErrorCodes)[keyof typeof McpErrorCodes];

/**
 * MCP notification format (no response expected).
 */
export interface McpNotification {
	jsonrpc: '2.0';
	method: string;
	params?: Record<string, unknown>;
}

/**
 * MCP tool definition format.
 */
export interface McpTool {
	/** Tool name */
	name: string;

	/** Display label: the command's `title`, or a meta-tool's fixed title. */
	title?: string;

	/** Tool description */
	description?: string;

	/** JSON Schema for input */
	inputSchema: {
		type: 'object';
		properties?: Record<string, unknown>;
		required?: string[];
	};

	/** MCP tool annotations derived from `mutation` and `destructive` (`spec/command-metadata.md`). */
	annotations?: {
		title?: string;
		readOnlyHint?: boolean;
		destructiveHint?: boolean;
		idempotentHint?: boolean;
		openWorldHint?: boolean;
	};

	/** JSON Schema of the tool's `structuredContent`: for an AFD command, the CommandResult envelope. */
	outputSchema?: Record<string, unknown>;

	/** AFD extensions carried through MCP tools/list. */
	_meta?: McpToolCommandMeta & {
		/** Grouped tools only: one entry per command the tool dispatches to. */
		actions?: McpToolAction[];
	};
}

/** Per-command AFD metadata advertised in a tool's `_meta`. */
export interface McpToolCommandMeta {
	category?: string;
	requires?: string[];
	mutation?: boolean;
	destructive?: boolean;
	undoable?: boolean;
	/** The approval policy (`'conditional'` for a function policy); unset when none is declared. */
	approval?: 'not-required' | 'required' | 'conditional';
	examples?: Array<{ title: string; input: unknown }>;
	outputSchema?: Record<string, unknown>;
	contexts?: string[];
}

/**
 * One action of a grouped tool (`toolStrategy: 'grouped'`), as listed in its
 * `_meta.actions`: the underlying command and its input schema.
 */
export interface McpToolAction extends McpToolCommandMeta {
	/** Value of the grouped tool's `action` argument */
	action: string;
	/** Full command name (usable with afd-call and afd-detail) */
	command: string;
	description: string;
	/** Input schema of the command, sent as the grouped tool's `params` */
	inputSchema: McpTool['inputSchema'];
}

/**
 * MCP tools/list response.
 */
export interface McpToolsListResult {
	tools: McpTool[];
}

/**
 * MCP tools/call request params.
 */
export interface McpToolCallParams {
	name: string;
	arguments?: Record<string, unknown>;
}

/**
 * MCP tools/call response.
 */
export interface McpToolCallResult {
	content: McpContent[];
	/** The result as JSON; an AFD server sends the whole CommandResult here as well as in `content[0]`. */
	structuredContent?: unknown;
	isError?: boolean;
}

/**
 * MCP content types.
 */
export type McpContent = McpTextContent | McpImageContent | McpResourceContent;

export interface McpTextContent {
	type: 'text';
	text: string;
}

export interface McpImageContent {
	type: 'image';
	data: string;
	mimeType: string;
}

export interface McpResourceContent {
	type: 'resource';
	resource: {
		uri: string;
		mimeType?: string;
		text?: string;
		blob?: string;
	};
}

/**
 * MCP server capabilities.
 */
export interface McpServerCapabilities {
	tools?: {
		listChanged?: boolean;
	};
	resources?: {
		subscribe?: boolean;
		listChanged?: boolean;
	};
	prompts?: {
		listChanged?: boolean;
	};
	logging?: Record<string, unknown>;
	experimental?: Record<string, unknown>;
}

/**
 * MCP client capabilities.
 */
export interface McpClientCapabilities {
	roots?: {
		listChanged?: boolean;
	};
	sampling?: Record<string, unknown>;
	experimental?: Record<string, unknown>;
}

/**
 * MCP initialize request params.
 */
export interface McpInitializeParams {
	protocolVersion: string;
	capabilities: McpClientCapabilities;
	clientInfo: {
		name: string;
		version: string;
	};
}

/**
 * MCP initialize response.
 */
export interface McpInitializeResult {
	protocolVersion: string;
	capabilities: McpServerCapabilities;
	serverInfo: {
		name: string;
		version: string;
	};
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

let requestId = 0;

/**
 * Create an MCP request.
 */
export function createMcpRequest(method: string, params?: Record<string, unknown>): McpRequest {
	return {
		jsonrpc: '2.0',
		id: ++requestId,
		method,
		params,
	};
}

/**
 * Create an MCP success response.
 */
export function createMcpResponse(id: McpId, result: unknown): McpResponse {
	return {
		jsonrpc: '2.0',
		id,
		result,
	};
}

/**
 * Create an MCP error response.
 */
export function createMcpErrorResponse(
	id: McpId,
	code: number,
	message: string,
	data?: unknown
): McpResponse {
	return {
		jsonrpc: '2.0',
		id,
		error: { code, message, data },
	};
}

/**
 * Create a text content item.
 */
export function textContent(text: string): McpTextContent {
	return { type: 'text', text };
}

/**
 * Type guard for MCP requests.
 */
export function isMcpRequest(value: unknown): value is McpRequest {
	return (
		typeof value === 'object' &&
		value !== null &&
		'jsonrpc' in value &&
		(value as McpRequest).jsonrpc === '2.0' &&
		'id' in value &&
		'method' in value
	);
}

/**
 * Type guard for MCP responses.
 */
export function isMcpResponse(value: unknown): value is McpResponse {
	return (
		typeof value === 'object' &&
		value !== null &&
		'jsonrpc' in value &&
		(value as McpResponse).jsonrpc === '2.0' &&
		'id' in value &&
		('result' in value || 'error' in value)
	);
}

/**
 * Type guard for MCP notifications.
 */
export function isMcpNotification(value: unknown): value is McpNotification {
	return (
		typeof value === 'object' &&
		value !== null &&
		'jsonrpc' in value &&
		(value as McpNotification).jsonrpc === '2.0' &&
		'method' in value &&
		!('id' in value)
	);
}
