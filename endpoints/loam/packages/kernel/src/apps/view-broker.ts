/**
 * @fileoverview What a sandboxed view's requests reach (phase 1 specification, 6.2): `tools/call` on the
 * view's own port, so 5.3's checks apply, and `resources/read` of its own resources. The chrome speaks
 * the protocol, and the checks are here, since this is a boundary for a view (D54).
 */

import type { CommandResult } from '@lushly-dev/afd-core';
import type { ManifestV1 } from '@lushly-dev/loam-manifest';
import type { AppPortV1, LinkedCallV1, ViewBrokerV1 } from '../types.js';
import { toolCallResult, visibleToApp } from './handler-frame.js';
import { refuseRequest } from './support.js';

/** A view's resource, as MCP Apps types it (6.2). */
const RESOURCE_MIME = 'text/html;profile=mcp-app';

export interface ViewBrokerOptions {
	manifest: ManifestV1;
	sandboxOrigin: string | null;
	/** Read when a view calls, since the port is made with this broker on it. */
	port(): AppPortV1;
}

export interface ViewHost {
	broker: ViewBrokerV1;
	/** A command of this app finished: tell whoever listens for the resource it names. */
	notifyCall(name: string, input: unknown, result: CommandResult, signal?: AbortSignal): void;
}

/** The resource a command's `tool_meta.ui.resourceUri` names, if any. */
function linkedResource(manifest: ManifestV1, name: string): string | undefined {
	const command = manifest.commands?.find((candidate) => candidate.name === name);
	const uri = (command?.tool_meta?.ui as { resourceUri?: unknown } | undefined)?.resourceUri;
	return typeof uri === 'string' ? uri : undefined;
}

export function createViewBroker({ manifest, sandboxOrigin, port }: ViewBrokerOptions): ViewHost {
	const listeners = new Map<string, Set<(call: LinkedCallV1) => void>>();
	const own = new Set((manifest.commands ?? []).map((command) => command.name));
	const refuse = (message: string, suggestion: string) =>
		refuseRequest({ code: 'VIEW_CALL_REFUSED', rpcCode: -32602, message, suggestion });

	return {
		broker: {
			sandboxOrigin,
			async toolsCall(params) {
				const { name, arguments: input } = (params ?? {}) as {
					name?: unknown;
					arguments?: unknown;
				};
				if (typeof name !== 'string') {
					throw refuse('A tool name is a string', 'Pass the command name as `name`');
				}
				if (own.has(name) && !visibleToApp(manifest, name)) {
					throw refuse(
						`The command '${name}' is not visible to the app`,
						'Add `app` to its `tool_meta.ui.visibility`'
					);
				}
				return toolCallResult(await port().call(name, input ?? {}));
			},
			async resourcesRead(params) {
				const { uri } = (params ?? {}) as { uri?: unknown };
				const declared = manifest.ui?.resources?.some((resource) => resource.uri === uri);
				if (typeof uri !== 'string' || !declared) {
					throw refuse(
						'A view reads only the resources its manifest declares',
						'Declare it under `ui.resources`'
					);
				}
				return {
					contents: [{ uri, mimeType: RESOURCE_MIME, text: await port().readResource(uri) }],
				};
			},
			async runBound(command, signal) {
				return toolCallResult(await port().call(command, {}, { signal }));
			},
			onLinkedCall(uri, listener) {
				const held = listeners.get(uri) ?? new Set();
				listeners.set(uri, held);
				held.add(listener);
				return () => {
					held.delete(listener);
				};
			},
		},
		notifyCall(name, input, result, signal) {
			const uri = linkedResource(manifest, name);
			if (uri === undefined) return;
			for (const listener of listeners.get(uri) ?? []) {
				listener({
					command: name,
					input,
					result: toolCallResult(result),
					...(signal !== undefined ? { signal } : {}),
				});
			}
		},
	};
}
