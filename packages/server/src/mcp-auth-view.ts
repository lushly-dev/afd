/**
 * @fileoverview The scope authority of a server with MCP authorization (`spec/authorization.md`,
 * M6): it makes each admitted request's {@link ScopeView}, which commands exist for its caller and
 * which it is shown, decided once as the request arrives, and the scope decision on every call it
 * names, before dispatch, after routing and at execution.
 */

import type { CommandError } from '@lushly-dev/afd-core';
import { commandAction, commandGroup, type GroupByFn } from './command-routing.js';
import type { ProtectedResource } from './mcp-auth-resource.js';
import type { Credentials } from './mcp-auth-rules.js';
import {
	checkedDecision,
	mergeDecisions,
	requestDecision,
	type ScopeDecision,
	type ScopeResolver,
	type ScopeWarning,
	staticDecision,
} from './mcp-auth-scopes.js';
import type { ZodCommandDefinition } from './schema.js';
import type { ScopeView } from './scope-view.js';
import type { ToolStrategy } from './server-types.js';

/** One call a request names. */
export type NamedCall =
	| { kind: 'command'; name: string; input: unknown }
	| { kind: 'tool'; name: string; input: unknown }
	/** A grouped call that resolves to no single command: it runs nothing. */
	| { kind: 'unresolved' };

/** The scope options of `auth` and what the server knows of its own commands. */
export interface ScopeAuthorityOptions {
	requiredScopes: readonly string[];
	resolver: ScopeResolver | undefined;
	filterToolsByScope: boolean;
	/** The MCP-exposed commands, built-ins included. */
	commands: readonly ZodCommandDefinition[];
	toolStrategy: ToolStrategy;
	groupByFn: GroupByFn | undefined;
	resource: ProtectedResource;
	warn?: ScopeWarning;
}

/** Makes the view of each authorized request. */
export interface ScopeAuthority {
	view(credentials: Credentials): ScopeView;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** The input of a call as sent: an absent or `null` input is `{}`. */
function inputOrEmpty(value: unknown): unknown {
	return value === undefined || value === null ? {} : value;
}

/** Every step of `afd-batch` or `afd-pipe`, or `undefined` when one names no command. */
function stepsOf(list: unknown): NamedCall[] | undefined {
	if (!Array.isArray(list) || list.length === 0) return undefined;
	const calls: NamedCall[] = [];
	for (const item of list) {
		if (!isRecord(item) || typeof item.command !== 'string') return undefined;
		calls.push({ kind: 'command', name: item.command, input: inputOrEmpty(item.input) });
	}
	return calls;
}

/**
 * The scope authority of one server (`spec/authorization.md`, M6).
 *
 * @throws Error when a command declares a scope that is not a scope token
 */
export function createScopeAuthority(options: ScopeAuthorityOptions): ScopeAuthority {
	const { requiredScopes, resolver, filterToolsByScope, toolStrategy, groupByFn, resource } =
		options;
	const warn = options.warn;
	const byName = new Map(options.commands.map((command) => [command.name, command]));
	// Only a resolver on a server that filters its listings hides commands.
	const hider = filterToolsByScope ? resolver : undefined;

	const failure = (missing: readonly string[]): CommandError => ({
		code: 'INSUFFICIENT_SCOPE',
		message: 'The access token lacks a scope this call needs',
		suggestion: resource.forbiddenBody(missing).suggestion,
		details: { scopes: [...missing] },
		retryable: false,
	});

	function view(credentials: Credentials): ScopeView {
		const held = credentials.scopes;
		const required = staticDecision(requiredScopes, [], held);
		const ask = (name: string, input: unknown): ScopeDecision => {
			try {
				return checkedDecision(resolver?.resolve(name, input, credentials));
			} catch {
				// A resolver that throws refuses the call, failing closed.
				return { missing: [] };
			}
		};
		const asks = (test: ((name: string, c: Credentials) => boolean) | undefined, name: string) => {
			try {
				return test?.(name, credentials) === true;
			} catch {
				return false;
			}
		};
		// Decided once, as the request arrives, for every command (M6, "Hidden commands").
		const known = new Set<string>();
		const shown = new Set<string>();
		for (const command of byName.values()) {
			const name = command.name;
			const exists =
				!hider || asks((n, c) => (hider.known ?? hider.visible).call(hider, n, c), name);
			if (exists) known.add(name);
			const visible =
				required === 'allowed' &&
				(resolver
					? asks((n, c) => resolver.visible(n, c), name) && exists
					: (command.scopes ?? []).every((scope) => held.includes(scope)));
			if (!filterToolsByScope || (visible && exists)) shown.add(name);
		}
		const isKnown = (name: string) => byName.has(name) && known.has(name);

		/** One named call: the required scopes, then the call's own decision. */
		const decide = (call: NamedCall): ScopeDecision => {
			let decision: ScopeDecision = 'allowed';
			if (call.kind === 'command') {
				const command = isKnown(call.name) ? byName.get(call.name) : undefined;
				// A name that does not exist for the caller needs the required scopes alone, and the
				// resolver is never asked about it.
				if (command) {
					decision = resolver
						? ask(call.name, call.input)
						: staticDecision([], command.scopes ?? [], held);
				}
			} else if (call.kind === 'tool' && resolver) {
				decision = ask(call.name, call.input);
			}
			return mergeDecisions(required, decision);
		};

		/** The calls a `tools/call` names, resolved as the router resolves them (M6). */
		const named = (tool: string, args: unknown): NamedCall[] => {
			const record = isRecord(args) ? args : {};
			const own: NamedCall[] = [{ kind: 'tool', name: tool, input: args ?? {} }];
			switch (tool) {
				case 'afd-call':
					return typeof record.command === 'string'
						? [{ kind: 'command', name: record.command, input: inputOrEmpty(record.input) }]
						: own;
				case 'afd-batch':
					return stepsOf(record.commands) ?? own;
				case 'afd-pipe':
					return stepsOf(record.steps) ?? own;
				case 'afd-discover':
				case 'afd-detail':
					return own;
			}
			if (toolStrategy === 'grouped') {
				const members = [...byName.values()].filter(
					(command) => commandGroup(command, groupByFn) === tool && known.has(command.name)
				);
				const action = record.action;
				if (typeof action === 'string' && action !== '') {
					const candidates = members.filter((command) => commandAction(command) === action);
					return candidates.length === 1
						? [
								{
									kind: 'command',
									name: (candidates[0] as ZodCommandDefinition).name,
									input: record.params ?? {},
								},
							]
						: [{ kind: 'unresolved' }];
				}
				// Without an action the router answers a missing action only for a group with a
				// member it shows; any other tool runs the command it names.
				if (members.some((command) => shown.has(command.name))) return [{ kind: 'unresolved' }];
			}
			return [{ kind: 'command', name: tool, input: args ?? {} }];
		};

		return Object.freeze({
			credentials,
			filtered: filterToolsByScope,
			known: (name: string) => !byName.has(name) || known.has(name),
			shown: (name: string) => shown.has(name),
			decideCall: (tool: string, args: unknown) =>
				requestDecision(named(tool, args).map(decide), warn),
			decideCommands: (calls: readonly { command: string; input: unknown }[]) =>
				requestDecision(
					calls.map((call) =>
						decide({ kind: 'command', name: call.command, input: inputOrEmpty(call.input) })
					),
					warn
				),
			decideRequest: () => requestDecision([required], warn),
			decideExecution: (command: string, input: unknown) =>
				resolver && isKnown(command)
					? requestDecision([mergeDecisions(required, ask(command, input))], warn)
					: 'proceed',
			insufficientScope: failure,
		});
	}

	return { view };
}
