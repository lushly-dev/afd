/**
 * @fileoverview The MCP session of the HTTP and SSE transports (`Mcp-Session-Id`).
 */

import type { McpRequest } from '@lushly-dev/afd-core';
import { isMcpResponse } from '@lushly-dev/afd-core';
import { raceWithAbort } from './request-abort.js';

interface Renewal {
	revision: number;
	settled: boolean;
	controller: AbortController;
	promise: Promise<boolean>;
	waiters: number;
}

/**
 * The MCP session issued by `initialize`. Session replacement belongs to one connection
 * generation; reset/disconnect invalidates in-flight responses and shared renewal work.
 */
export class McpSession {
	private id: string | undefined;
	private initialize: McpRequest | undefined;
	private generation = 0;
	private revision = 0;
	private renewal: Renewal | undefined;

	/** The current session ID, if the server issued one. */
	get sessionId(): string | undefined {
		return this.id;
	}

	/** Connection ownership and renewal attempt snapshots for requests on stream endpoints. */
	get sessionGeneration(): number {
		return this.generation;
	}

	get sessionRevision(): number {
		return this.revision;
	}

	reset(): void {
		this.generation++;
		this.revision = 0;
		this.id = undefined;
		this.initialize = undefined;
		this.renewal?.controller.abort(new Error('MCP session reset'));
		this.renewal = undefined;
	}

	/**
	 * POST a request. A 404 for an issued session renews it and retries once, only after a
	 * validated initialize response issued a replacement session in the same generation.
	 */
	async post(
		url: string,
		headers: Record<string, string> | undefined,
		request: McpRequest,
		signal: AbortSignal
	): Promise<Response> {
		signal.throwIfAborted();
		if (request.method === 'initialize') {
			this.reset();
			this.initialize = request;
		}
		const generation = this.generation;
		const sentId = this.id;
		const revision = this.revision;
		const response = await this.send(url, headers, request, signal, sentId);
		if (request.method === 'initialize') {
			const issued = response.headers?.get('mcp-session-id')
				? await this.validSession(response.clone(), request)
				: undefined;
			if (generation === this.generation && !signal.aborted) this.id = issued;
			return response;
		}
		if (response.status !== 404 || !sentId || generation !== this.generation) return response;
		// A delayed 404 from the old session can arrive after another caller renewed it.
		if (this.id === sentId && !(await this.renew(url, headers, signal, revision))) return response;
		if (generation !== this.generation || !this.id) return response;
		const renewedId = this.id;
		await response.body?.cancel();
		signal.throwIfAborted();
		if (generation !== this.generation || this.id !== renewedId) return response;
		return this.send(url, headers, request, signal, renewedId);
	}

	/**
	 * Share one renewal among concurrent callers. A failed renewal retains the rejected ID
	 * so later requests cannot silently fall back to stateless execution. Each caller owns
	 * its wait; aborting one does not cancel another caller's renewal.
	 */
	async renew(
		url: string,
		headers: Record<string, string> | undefined,
		signal: AbortSignal,
		rejectedRevision?: number
	): Promise<boolean> {
		signal.throwIfAborted();
		if (!this.initialize || !this.id) return false;
		let renewal = this.renewal;
		if (
			!renewal ||
			(renewal.settled && (rejectedRevision === undefined || renewal.revision <= rejectedRevision))
		) {
			const generation = this.generation;
			const controller = new AbortController();
			const request = this.initialize;
			renewal = {
				revision: ++this.revision,
				settled: false,
				controller,
				waiters: 0,
				promise: Promise.resolve(false),
			};
			const operation = renewal;
			operation.promise = this.replace(
				url,
				headers,
				request,
				controller.signal,
				generation
			).finally(() => {
				operation.settled = true;
			});
			this.renewal = operation;
		}
		const shared = renewal;
		shared.waiters++;
		try {
			return await raceWithAbort(signal, () => shared.promise);
		} finally {
			shared.waiters--;
			if (shared.waiters === 0 && !shared.settled) {
				shared.controller.abort(new Error('MCP renewal has no waiting requests'));
				if (this.renewal === shared) this.renewal = undefined;
			}
		}
	}

	private async replace(
		url: string,
		headers: Record<string, string> | undefined,
		request: McpRequest,
		signal: AbortSignal,
		generation: number
	): Promise<boolean> {
		const response = await this.send(url, headers, request, signal);
		const issued = await this.validSession(response, request);
		if (!issued || signal.aborted || generation !== this.generation) return false;
		this.id = issued;
		return true;
	}

	/** A session header alone cannot turn an HTTP/JSON-RPC failure into a renewal. */
	private async validSession(response: Response, request: McpRequest): Promise<string | undefined> {
		try {
			if (!response.ok) return undefined;
			const issued = response.headers?.get('mcp-session-id')?.trim();
			if (!issued) return undefined;
			const body: unknown = await response.json();
			if (
				!isMcpResponse(body) ||
				body.id !== request.id ||
				body.error ||
				typeof body.result !== 'object' ||
				body.result === null ||
				Array.isArray(body.result)
			)
				return undefined;
			return issued;
		} catch {
			return undefined;
		} finally {
			await response.body?.cancel().catch(() => undefined);
		}
	}

	private send(
		url: string,
		headers: Record<string, string> | undefined,
		request: McpRequest,
		signal: AbortSignal,
		sessionId?: string
	): Promise<Response> {
		return fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...headers,
				...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
			},
			body: JSON.stringify(request),
			signal,
		});
	}
}
