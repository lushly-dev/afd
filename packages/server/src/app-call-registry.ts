/**
 * The in-process registry for app-to-app calls (`spec/app-calls.md`).
 *
 * Its own module, so a host that never serves app calls bundles none of it: `createDirectRegistry`
 * only refuses the `apps` interface.
 */
import { type CommandContext, failure } from '@lushly-dev/afd-core';
import {
	appCallGranted,
	type CallGrant,
	callNotGranted,
} from '@lushly-dev/afd-core/internal/app-calls';
import {
	createDispatchId,
	presetDispatchId,
	setDispatchId,
} from '@lushly-dev/afd-core/internal/dispatch-id';
import {
	APP_CALLS,
	createDirectRegistry,
	type DirectCommandRegistry,
	type DirectRegistryOptions,
} from './direct-registry.js';
import type { ZodCommandDefinition } from './schema.js';

/** Options for {@link createAppCallRegistry}: `createDirectRegistry`'s, less `interface` and `tools`. */
export interface AppCallRegistryOptions extends Omit<DirectRegistryOptions, 'interface' | 'tools'> {
	/**
	 * The host's grant check: whether the caller in `context` holds a grant naming `command`. AFD
	 * does not define a grant or who the caller is; read the host's own declared context field, such
	 * as Loam's `caller`. It runs before the context fields are validated, so check the type of what
	 * it reads. Only an explicit `true` grants; anything else, or a throw, refuses.
	 */
	callGrant: CallGrant;
}

/**
 * Create the registry a host runs an app's calls through, with the `apps` interface.
 *
 * A call runs only when the command sets `expose.apps` and `callGrant` returns `true`; it then runs
 * as in `createDirectRegistry`, with `apps` as its interface, so middleware and the journal see it.
 * Anything else (a missing command, one not exposed to apps, one the caller is not granted, any of
 * them with invalid input) returns one fixed `CALL_NOT_GRANTED` before lookup, the `allow` option,
 * the active context, validation and middleware, so an app learns nothing about commands it may not
 * call. It serves no tool surface (an app calls commands one by one), and `hasCommand` answers
 * `true` for every name, since `execute` answers every name. `DirectClient` and `DirectTransport`
 * refuse to wrap it: their `allow`, middleware and tool listing would answer before the check. Its
 * listings hold the commands exposed to apps, whatever any caller is granted: build what an app
 * may see from your grants, never from them.
 *
 * @throws TypeError without `callGrant`; otherwise as `createDirectRegistry`
 */
export function createAppCallRegistry(
	commands: ZodCommandDefinition[],
	options: AppCallRegistryOptions
): DirectCommandRegistry {
	const { callGrant, ...rest } = options;
	if (typeof callGrant !== 'function') {
		throw new TypeError(
			"createAppCallRegistry needs callGrant, the host's check of the caller's grants"
		);
	}
	// Neither `interface` nor `tools` reaches it, even from a caller outside the type checker.
	const { interface: _interface, tools: _tools, ...direct } = rest as DirectRegistryOptions;
	const registry = createDirectRegistry(commands, {
		...direct,
		interface: 'apps' as 'agent',
		[APP_CALLS]: true,
	} as DirectRegistryOptions);
	const byName = new Map(commands.map((command) => [command.name, command]));
	return {
		interface: registry.interface,
		contextFields: registry.contextFields,
		async execute(name, input, context: CommandContext = {}, callOptions) {
			// The grant check sees the interface the call runs with, as in the core registry, and
			// the call's dispatch id, made now so the grant reads the id the handler will
			// (spec/dispatch.md, "The dispatch id"). The grant gets its own copy: the preset that
			// carries the id to the engine is never handed to host code.
			const dispatchId = createDispatchId();
			const grantContext: CommandContext = { ...context, interface: 'apps' };
			setDispatchId(grantContext, dispatchId);
			if (!appCallGranted(byName.get(name), name, grantContext, callGrant)) {
				return failure(callNotGranted());
			}
			const appContext: CommandContext = { ...context, interface: 'apps' };
			presetDispatchId(appContext, dispatchId);
			return registry.execute(name, input, appContext, callOptions);
		},
		listTools: registry.listTools,
		listCommandNames: registry.listCommandNames,
		listCommands: registry.listCommands,
		hasCommand: () => true,
	};
}
