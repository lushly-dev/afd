/**
 * @fileoverview Handoff types for AFD commands
 *
 * The HandoffResult interface is returned by commands that bootstrap
 * streaming connections, allowing clients to connect to specialized
 * protocols (WebSocket, WebRTC, SSE, etc.) for real-time communication.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// HANDOFF TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Protocol type for client dispatch.
 *
 * Standard protocols are provided, but custom protocols are allowed
 * via the string union type.
 */
export type HandoffProtocol = 'websocket' | 'webrtc' | 'sse' | 'http-stream' | string;

/**
 * Authentication credentials for the handoff connection.
 *
 * @example
 * ```typescript
 * const credentials: HandoffCredentials = {
 *   token: 'eyJhbGciOiJIUzI1NiIs...',
 *   sessionId: 'session-abc123',
 *   headers: { 'X-Custom-Header': 'value' }
 * };
 * ```
 */
export interface HandoffCredentials {
	/** Bearer token for authentication */
	token?: string;

	/** Additional headers to include in the connection */
	headers?: Record<string, string>;

	/** Session ID for correlation */
	sessionId?: string;
}

/**
 * Metadata for client decision-making about the handoff.
 *
 * @example
 * ```typescript
 * const metadata: HandoffMetadata = {
 *   expectedLatency: 50,
 *   capabilities: ['text', 'typing-indicator', 'presence'],
 *   expiresAt: '2025-01-15T12:00:00Z',
 *   reconnect: {
 *     allowed: true,
 *     maxAttempts: 5,
 *     backoffMs: 1000
 *   },
 *   description: 'Real-time chat connection'
 * };
 * ```
 */
export interface HandoffMetadata {
	/** Expected latency in ms (hint for client) */
	expectedLatency?: number;

	/** Capabilities the channel supports */
	capabilities?: string[];

	/** When the handoff credentials expire (ISO 8601) */
	expiresAt?: string;

	/** Reconnection policy */
	reconnect?: {
		/** Whether reconnection is allowed */
		allowed: boolean;
		/** Maximum number of reconnection attempts */
		maxAttempts?: number;
		/** Base backoff time in milliseconds */
		backoffMs?: number;
	};

	/** Human-readable description of the handoff */
	description?: string;
}

/**
 * Result returned by commands that hand off to specialized protocols.
 *
 * This type is used as the data payload in CommandResult<HandoffResult>.
 * Commands returning handoffs should be marked with `handoff: true` and
 * tagged appropriately (e.g., 'handoff', 'handoff:websocket').
 *
 * @example
 * ```typescript
 * const result = await client.call<HandoffResult>('chat.connect', { roomId });
 * if (result.success && result.data) {
 *   const ws = new WebSocket(result.data.endpoint);
 *   ws.send(JSON.stringify({ auth: result.data.credentials?.token }));
 * }
 * ```
 */
export interface HandoffResult {
	/** Protocol type for client dispatch */
	protocol: HandoffProtocol;

	/** Full URL to connect to */
	endpoint: string;

	/** Authentication credentials for the handoff */
	credentials?: HandoffCredentials;

	/** Metadata for client decision-making */
	metadata?: HandoffMetadata;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TYPE GUARDS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Type guard to check if a value is a HandoffResult.
 *
 * @param value - Value to check
 * @returns True if value is a HandoffResult
 *
 * @example
 * ```typescript
 * const result = await client.call('some.command', input);
 * if (result.success && isHandoff(result.data)) {
 *   // TypeScript knows result.data is HandoffResult
 *   connect(result.data.protocol, result.data.endpoint);
 * }
 * ```
 */
export function isHandoff(value: unknown): value is HandoffResult {
	if (typeof value !== 'object' || value === null) {
		return false;
	}

	const obj = value as Record<string, unknown>;

	// Required fields: protocol and endpoint
	if (typeof obj.protocol !== 'string' || obj.protocol.length === 0) {
		return false;
	}

	if (typeof obj.endpoint !== 'string' || obj.endpoint.length === 0) {
		return false;
	}

	// Optional credentials validation
	if (obj.credentials !== undefined) {
		if (typeof obj.credentials !== 'object' || obj.credentials === null) {
			return false;
		}
		const creds = obj.credentials as Record<string, unknown>;
		if (creds.token !== undefined && typeof creds.token !== 'string') {
			return false;
		}
		if (creds.sessionId !== undefined && typeof creds.sessionId !== 'string') {
			return false;
		}
		if (creds.headers !== undefined) {
			if (typeof creds.headers !== 'object' || creds.headers === null) {
				return false;
			}
		}
	}

	// Optional metadata validation
	if (obj.metadata !== undefined) {
		if (typeof obj.metadata !== 'object' || obj.metadata === null) {
			return false;
		}
		const meta = obj.metadata as Record<string, unknown>;
		if (meta.expectedLatency !== undefined && typeof meta.expectedLatency !== 'number') {
			return false;
		}
		if (meta.capabilities !== undefined && !Array.isArray(meta.capabilities)) {
			return false;
		}
		if (meta.expiresAt !== undefined && typeof meta.expiresAt !== 'string') {
			return false;
		}
		if (meta.description !== undefined && typeof meta.description !== 'string') {
			return false;
		}
		if (meta.reconnect !== undefined) {
			if (typeof meta.reconnect !== 'object' || meta.reconnect === null) {
				return false;
			}
			const reconnect = meta.reconnect as Record<string, unknown>;
			if (typeof reconnect.allowed !== 'boolean') {
				return false;
			}
			if (reconnect.maxAttempts !== undefined && typeof reconnect.maxAttempts !== 'number') {
				return false;
			}
			if (reconnect.backoffMs !== undefined && typeof reconnect.backoffMs !== 'number') {
				return false;
			}
		}
	}

	return true;
}

/**
 * Type guard to check if a HandoffResult uses a specific protocol.
 *
 * @param handoff - HandoffResult to check
 * @param protocol - Protocol to check for
 * @returns True if the handoff uses the specified protocol
 *
 * @example
 * ```typescript
 * if (isHandoffProtocol(handoff, 'websocket')) {
 *   const ws = new WebSocket(handoff.endpoint);
 * } else if (isHandoffProtocol(handoff, 'sse')) {
 *   const eventSource = new EventSource(handoff.endpoint);
 * }
 * ```
 */
export function isHandoffProtocol(handoff: HandoffResult, protocol: HandoffProtocol): boolean {
	return handoff.protocol === protocol;
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMMAND TYPE GUARDS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Minimal interface for checking if a command is a handoff command.
 * This avoids circular dependencies with commands.ts.
 */
interface HandoffCommandLike {
	handoff?: boolean;
	handoffProtocol?: string;
	tags?: string[];
}

/**
 * Check if a command definition is a handoff command.
 *
 * A command is a handoff command if:
 * - It has `handoff: true` property, OR
 * - It has a 'handoff' tag
 *
 * @param command - Command definition to check
 * @returns True if the command is a handoff command
 *
 * @example
 * ```typescript
 * const commands = registry.list();
 * const handoffCommands = commands.filter(isHandoffCommand);
 * ```
 */
export function isHandoffCommand(command: HandoffCommandLike): boolean {
	// Check explicit handoff property
	if (command.handoff === true) {
		return true;
	}

	// Check for handoff tag
	if (command.tags?.includes('handoff')) {
		return true;
	}

	return false;
}

/**
 * Get the handoff protocol from a command definition.
 *
 * Returns the protocol in this priority order:
 * 1. Explicit `handoffProtocol` property
 * 2. Protocol from 'handoff:{protocol}' tag
 * 3. undefined if not a handoff command or no protocol specified
 *
 * @param command - Command definition to check
 * @returns The handoff protocol or undefined
 *
 * @example
 * ```typescript
 * const protocol = getHandoffProtocol(chatConnectCommand);
 * if (protocol === 'websocket') {
 *   // Handle WebSocket handoff
 * }
 * ```
 */
export function getHandoffProtocol(command: HandoffCommandLike): HandoffProtocol | undefined {
	// Not a handoff command
	if (!isHandoffCommand(command)) {
		return undefined;
	}

	// Check explicit handoffProtocol property first
	if (command.handoffProtocol) {
		return command.handoffProtocol;
	}

	// Check for handoff:{protocol} tag
	const protocolTag = command.tags?.find((tag) => tag.startsWith('handoff:'));
	if (protocolTag) {
		return protocolTag.slice('handoff:'.length);
	}

	return undefined;
}
