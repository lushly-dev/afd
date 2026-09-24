/**
 * @fileoverview The MCP session of the HTTP and SSE transports (`Mcp-Session-Id`).
 */

import type { McpRequest } from '@lushly-dev/afd-core';

/**
 * The MCP session a server issued in the `Mcp-Session-Id` header of its `initialize`
 * response. It is repeated on later requests, so per-session server state (such as the
 * active context of `afd-context-enter`) belongs to this client alone.
 */
export class McpSession {
	private id: string | undefined;
	private initialize: McpRequest | undefined;

	/** The current session ID, if the server issued one. */
	get sessionId(): string | undefined {
		return this.id;
	}

	reset(): void {
		this.id = undefined;
		this.initialize = undefined;
	}

	/**
	 * POST one JSON-RPC request. If the server answers 404 to a request that carried a
	 * session (it restarted or expired the session), start a new session with the same
	 * `initialize` request and retry once; the server ran nothing for the rejected request.
	 */
	async post(
		url: string,
		headers: Record<string, string> | undefined,
		request: McpRequest,
		signal: AbortSignal
	): Promise<Response> {
		if (request.method === 'initialize') {
			this.id = undefined;
			this.initialize = request;
		}
		const sentSession = this.id !== undefined;
		const response = await this.send(url, headers, request, signal);
		if (response.status !== 404 || !sentSession) return response;
		if (!(await this.renew(url, headers, signal))) return response;
		return this.send(url, headers, request, signal);
	}

	/**
	 * Replace the session with a new one by re-sending the last `initialize` request.
	 * Returns `false`, sending nothing, when no `initialize` request was sent yet.
	 */
	async renew(
		url: string,
		headers: Record<string, string> | undefined,
		signal: AbortSignal
	): Promise<boolean> {
		if (!this.initialize) return false;
		this.id = undefined;
		const renewed = await this.send(url, headers, this.initialize, signal);
		await renewed.body?.cancel();
		return true;
	}

	private async send(
		url: string,
		headers: Record<string, string> | undefined,
		request: McpRequest,
		signal: AbortSignal
	): Promise<Response> {
		const response = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...headers,
				...(this.id ? { 'Mcp-Session-Id': this.id } : {}),
			},
			body: JSON.stringify(request),
			signal,
		});
		const issued = response.headers?.get('mcp-session-id');
		if (issued) this.id = issued;
		return response;
	}
}
