/**
 * @fileoverview What a sandboxed view's requests reach (phase 1 specification, 6.2): `tools/call` on the
 * view's own port, so 5.3's checks apply, and `resources/read` of its own resources. The chrome speaks
 * the protocol, and the checks are here, since this is a boundary for a view (D54).
 */

import type { CommandResult } from '@lushly-dev/afd-core';
import type { ManifestV3 } from '@lushly-dev/loam-manifest';
import type { LoamClientV1, OverlayResultV1, ScopeV1 } from '@lushly-dev/loam-sdk';
import { LoamKernelError } from '../errors.js';
import { LIMIT_DEFAULTS, measureJson } from '../limits.js';
import type { LinkedCall, ViewBroker } from '../types.js';
import { toolCallResult, visibleToApp } from './handler-frame.js';
import type { LimitGuard } from './limit-guard.js';
import { asJson, refuseRequest } from './support.js';
import type { HandlerRefusal } from './types.js';

/** A view's resource, as MCP Apps types it (6.2). */
const RESOURCE_MIME = 'text/html;profile=mcp-app';

export interface ViewBrokerOptions {
	manifest: ManifestV3;
	sandboxOrigin: string | null;
	/**
	 * The instance's guard (phase 4 specification, section 11): the gate on every message its frame sends, the rate it
	 * charges for a `tools/call` refused here, and its journaled refusals. Absent only in a test of the broker alone.
	 */
	guard?: LimitGuard;
}

/** Most `resources/read` an instance's views may have in flight at once (section 11; the trust review's 8). */
export const READS_IN_FLIGHT = 4;

export interface ViewHost {
	/**
	 * A broker closed over one caller: the port's, or a surface's, so a view's `tools/call` runs in the
	 * scope its surface was created in and can name no other (phase 2 specification, 3.6).
	 */
	brokerFor(
		call: LoamClientV1['call'],
		readResource: (uri: string) => Promise<string>,
		scope?: ScopeV1,
		waitOverlay?: (overlayId: string) => Promise<OverlayResultV1>
	): ViewBroker;
	/**
	 * A command of this app finished in `scope`, its effective one: tell whoever listens for the resource it
	 * names, from a surface made in that scope, so no result crosses into another project (3.6).
	 */
	notifyCall(
		name: string,
		input: unknown,
		result: CommandResult,
		signal?: AbortSignal,
		scope?: ScopeV1
	): void;
}

/** The resource a command's `tool_meta.ui.resourceUri` names, if any. */
function linkedResource(manifest: ManifestV3, name: string): string | undefined {
	const command = manifest.commands?.find((candidate) => candidate.name === name);
	const uri = (command?.tool_meta?.ui as { resourceUri?: unknown } | undefined)?.resourceUri;
	return typeof uri === 'string' ? uri : undefined;
}

export function createViewBroker({ manifest, sandboxOrigin, guard }: ViewBrokerOptions): ViewHost {
	/**
	 * The gate again, for a request that reached the broker some other way than the chrome's channel: over
	 * `messageBytes`, or with no JSON form, it is refused as the channel refuses it (section 11).
	 */
	const bounded = (method: string, params: unknown): void => {
		const message = { jsonrpc: '2.0', method, params };
		// With no guard, the defaults all the same: a message is never unbounded.
		const refused =
			guard?.admit(message) ??
			(measureJson(message, LIMIT_DEFAULTS.messageBytes).over &&
			!measureJson(message, LIMIT_DEFAULTS.messageBytes).unserializable
				? {
						code: 'INPUT_TOO_LARGE',
						rpcCode: -32602,
						message: `A ${method} message is over ${LIMIT_DEFAULTS.messageBytes} bytes of JSON, so it was dropped`,
						suggestion: 'Send less, or ask an owner to raise loam.limits.messageBytes',
						details: { limit: LIMIT_DEFAULTS.messageBytes },
					}
				: undefined);
		if (refused)
			throw refuseRequest(refused as HandlerRefusal & { details?: Record<string, unknown> });
	};
	/** A `tools/call` refused here, before the port, still takes its place in the rate: once, here. */
	const refuseCall = (message: string, suggestion: string) => {
		guard?.charge();
		return refuse(message, suggestion);
	};
	let reading = 0;
	const listeners = new Map<string, Set<(call: LinkedCall, scope?: ScopeV1) => void>>();
	const own = new Set((manifest.commands ?? []).map((command) => command.name));
	const refuse = (message: string, suggestion: string) =>
		refuseRequest({ code: 'VIEW_CALL_REFUSED', rpcCode: -32602, message, suggestion });

	return {
		brokerFor: (call, readResource, bound, waitOverlay) => ({
			sandboxOrigin,
			...(guard ? { admit: guard.admit } : {}),
			async toolsCall(params) {
				bounded('tools/call', params);
				const { name, arguments: input } = (params ?? {}) as {
					name?: unknown;
					arguments?: unknown;
				};
				if (typeof name !== 'string') {
					throw refuseCall('A tool name is a string', 'Pass the command name as `name`');
				}
				if (own.has(name) && !visibleToApp(manifest, name)) {
					throw refuseCall(
						`The command '${name}' is not visible to the app`,
						'Add `app` to its `tool_meta.ui.visibility`'
					);
				}
				const json = asJson(input ?? {});
				if (json === undefined) {
					throw refuseCall(
						"A tool's arguments are JSON",
						'Pass arguments with no BigInt and no cycle'
					);
				}
				// `dev.loam/level` is the one scope a view names; `dev.loam/scope` from a frame is ignored (3.2).
				const level = (params as { _meta?: Record<string, unknown> } | undefined)?._meta?.[
					'dev.loam/level'
				];
				return toolCallResult(
					await (level === undefined
						? call(name, json.value)
						: call(name, json.value, { level } as never))
				);
			},
			async resourcesRead(params) {
				bounded('resources/read', params);
				const { uri } = (params ?? {}) as { uri?: unknown };
				const declared = manifest.ui?.resources?.some((resource) => resource.uri === uri);
				if (typeof uri !== 'string' || !declared) {
					throw refuse(
						'A view reads only the resources its manifest declares',
						'Declare it under `ui.resources`'
					);
				}
				// A bounded number in flight per instance, so a view cannot queue unbounded reads (section 11).
				if (reading >= READS_IN_FLIGHT) {
					const refused = await guard?.refuse(uri, 'callsPerSecond', READS_IN_FLIGHT, {
						reason: 'reads',
						retryAfterMs: 100,
					});
					throw refuseRequest({
						code: 'RATE_LIMITED',
						rpcCode: -32602,
						message:
							refused?.error?.message ??
							`This app has ${READS_IN_FLIGHT} resource reads in flight already`,
						suggestion: refused?.error?.suggestion ?? 'Wait for one to finish, then read again',
						details: { limit: READS_IN_FLIGHT, retryAfterMs: 100 },
					});
				}
				reading += 1;
				try {
					return {
						contents: [{ uri, mimeType: RESOURCE_MIME, text: await readResource(uri) }],
					};
				} finally {
					reading -= 1;
				}
			},
			/**
			 * `dev.loam/overlay-result` (phase 4 specification, 6.4): the answer to one of this app's own overlays, as
			 * `overlays.modal` gives a native app; another owner's id is refused, as the port refuses it.
			 */
			async overlayResult(params) {
				const { overlayId } = (params ?? {}) as { overlayId?: unknown };
				if (typeof overlayId !== 'string' || overlayId.length === 0 || overlayId.length > 64) {
					throw refuse('An overlay id is a string', 'Pass the overlayId the open returned');
				}
				if (!waitOverlay) {
					throw refuse('This view has no overlays of its own', 'Open one with modal-open first');
				}
				try {
					return await waitOverlay(overlayId);
				} catch (cause) {
					if (!(cause instanceof LoamKernelError)) throw cause;
					throw refuseRequest({
						code: cause.code,
						rpcCode: -32602,
						message: cause.message,
						suggestion: cause.suggestion,
					});
				}
			},
			async runBound(command, signal) {
				return toolCallResult(await call(command, {}, { signal }));
			},
			onLinkedCall(uri, listener) {
				const held = listeners.get(uri) ?? new Set();
				listeners.set(uri, held);
				const each = (linked: LinkedCall, scope?: ScopeV1) => {
					// Fails closed: a broker with no surface, or a call with no scope, is told nothing (T4). The project
					// decides, as `scopeKeyOf` does: one workspace per deployment in phase 2 (D32), checked first (3.4).
					if (bound && scope && bound.project === scope.project) listener(linked);
				};
				held.add(each);
				return () => {
					held.delete(each);
				};
			},
		}),
		notifyCall(name, input, result, signal, scope) {
			const uri = linkedResource(manifest, name);
			if (uri === undefined) return;
			for (const listener of listeners.get(uri) ?? []) {
				listener(
					{
						command: name,
						input,
						result: toolCallResult(result),
						...(signal !== undefined ? { signal } : {}),
					},
					scope
				);
			}
		},
	};
}
