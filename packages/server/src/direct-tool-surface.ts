/**
 * @fileoverview The MCP tool surface of an in-process registry: `createDirectToolSurface()`.
 *
 * A host passes the surface to `createDirectRegistry(commands, { tools })`. The registry then
 * lists the tools an MCP server with the same commands, contexts and strategy lists, by calling
 * the server's own `getToolsList`, and routes the meta-tools through the server's own tool
 * router, so an in-process agent sees the surface an MCP agent sees. The surface also registers
 * the context tools when the registry has contexts, and the bootstrap tools with `bootstrap`.
 *
 * Exposure: where the MCP server lists, routes and describes its MCP-exposed commands, the
 * surface uses the commands exposed to the registry's interface (`'agent'` by default). A
 * registry built with `interface: 'mcp'` therefore sees exactly the server's commands. The
 * surface's own context and bootstrap tools are exposed to the registry's interface, as the
 * server's are exposed over MCP.
 *
 * Contexts follow the MCP 2026-07-28 lane: the registry binds a non-persistent state per call
 * from its `activeContext` option, so `afd-context-enter` and `afd-context-exit` validate the
 * name, change nothing, and return `persisted: false` with the hint.
 *
 * This module is what keeps the router out of the base registry: `direct-registry.ts` imports it
 * only as types. It loads no Node.js built-in, so it runs in a browser too.
 */

import type { CommandContext, ExposeOptions } from '@lushly-dev/afd-core';
import { isMcpExposed } from '@lushly-dev/afd-core';
import { createContextCommands, getBootstrapCommands } from './bootstrap/registry.js';
import { assertValidCommandNames, assertValidFirstClassTools } from './command-names.js';
import { commandGroup, filterByContext } from './command-routing.js';
import { contextFieldValues } from './context-fields.js';
import { createContextState, resolveContextState } from './context-scope.js';
import type { DirectToolBinding, DirectToolHost, DirectToolSurface } from './direct-registry.js';
import {
	CONTEXT_META_KEY,
	inProcessMeta,
	liftMetaArgument,
	metaArgumentKeys,
} from './meta-argument.js';
import { META_TOOL_NAMES } from './meta-tools.js';
import type { ZodCommandDefinition } from './schema.js';
import type { ToolStrategy } from './server-types.js';
import { createToolRouter } from './tool-router.js';
import { getToolsList } from './tools.js';

/** Options for {@link createDirectToolSurface}. */
export interface DirectToolSurfaceOptions {
	/**
	 * The strategy `listTools` uses by default, as `toolStrategy` on `createMcpServer`. Grouped
	 * tool calls route only when it is `'grouped'`. Default: `'individual'`.
	 */
	strategy?: ToolStrategy;
	/**
	 * The hybrid strategy's first-class commands, in list order, as on `createMcpServer`: required
	 * with `strategy: 'hybrid'` and refused with any other. Each must be exposed to the registry's
	 * interface. `createDirectRegistry` throws on a mistake, naming the entry.
	 */
	firstClassTools?: string[];
	/**
	 * Register `afd-help`, `afd-docs` and `afd-schema`, as `bootstrap: true` does on
	 * `createMcpServer`. Default: `false`.
	 */
	bootstrap?: boolean;
}

const STRATEGIES: readonly ToolStrategy[] = ['individual', 'grouped', 'lazy', 'hybrid'];

/**
 * A command as the server's tool list and router see an exposed one. Both filter on
 * `expose.mcp`; in process the registry's interface decides, so a command it exposes is shown
 * to them as MCP-exposed. The registry still runs the command itself.
 */
function asListed(command: ZodCommandDefinition): ZodCommandDefinition {
	return isMcpExposed(command) ? command : { ...command, expose: { ...command.expose, mcp: true } };
}

/**
 * Create the MCP tool surface for `createDirectRegistry`.
 *
 * @example
 * ```typescript
 * import { createDirectRegistry, createDirectToolSurface } from '@lushly-dev/afd-server/direct';
 *
 * const registry = createDirectRegistry(commands, {
 *   contexts: [{ name: 'billing' }],
 *   tools: createDirectToolSurface({ strategy: 'lazy' }),
 * });
 * registry.listTools(); // afd-discover, afd-detail, afd-batch, afd-pipe, afd-call
 * await registry.execute('afd-discover', {}, {}, { activeContext: 'billing' });
 * ```
 *
 * @throws TypeError for a strategy that is not `individual`, `grouped`, `lazy` or `hybrid`
 */
export function createDirectToolSurface(options: DirectToolSurfaceOptions = {}): DirectToolSurface {
	const strategy = options.strategy ?? 'individual';
	if (!STRATEGIES.includes(strategy)) {
		throw new TypeError(
			`Unknown tool strategy '${String(strategy)}': use one of ${STRATEGIES.join(', ')}`
		);
	}
	// A copy: the set must not change while the registry runs.
	const firstClassTools = options.firstClassTools ? [...options.firstClassTools] : undefined;
	const bootstrap = options.bootstrap ?? false;

	return {
		strategy,

		attach(host: DirectToolHost): DirectToolBinding {
			assertValidCommandNames(host.commands, { bootstrap, contexts: host.contexts.length > 0 });
			const metaKeys = metaArgumentKeys(host.contextFields);
			const expose = { mcp: true, [host.interface]: true } as ExposeOptions;
			const builtins: ZodCommandDefinition[] = [];
			if (host.contexts.length > 0) {
				// Never used: the registry binds a state to every call.
				const fallback = createContextState({ persistent: false });
				builtins.push(...createContextCommands(host.contexts, fallback, expose));
			}
			// What the agent can see and call, filled in below; the bootstrap tools read it per call.
			let listed: ZodCommandDefinition[] = [];
			if (bootstrap) {
				const describe = (context?: CommandContext) =>
					filterByContext(listed, resolveContextState(context)?.getActive());
				const toolSurface = {
					toolStrategy: strategy,
					firstClassTools,
					contextFields: host.contextFields,
				};
				for (const command of getBootstrapCommands(describe, { toolSurface })) {
					builtins.push({ ...command, expose: { ...command.expose, ...expose } });
				}
			}
			const registered = [...host.commands, ...builtins];
			assertValidFirstClassTools({
				toolStrategy: strategy,
				firstClassTools,
				commands: registered,
				interface: host.interface,
			});
			listed = registered.filter((command) => host.isExposed(command)).map(asListed);

			const names = new Set(listed.map((command) => command.name));
			const groups = new Set(
				strategy === 'grouped' ? listed.map((command) => commandGroup(command)) : []
			);
			const routeToolCall = createToolRouter({
				executeCommand: (name, input, context) => host.executeCommand(name, input, context),
				executeBatch: (request, context) => host.executeBatch(request, context),
				executePipeline: (request, context) => host.executePipeline(request, context),
				commands: listed,
				toolStrategy: strategy,
				devMode: host.devMode,
				allCommands: listed,
				exposedCommandNames: names,
			});

			return {
				commands: builtins,

				routes(name) {
					return META_TOOL_NAMES.includes(name) || (groups.has(name) && !names.has(name));
				},

				liftMetaArgument(name, input, context, activeContext) {
					const lifted = liftMetaArgument(
						name,
						input,
						inProcessMeta(host.contextFields, context, activeContext),
						metaKeys
					);
					if (!lifted.ok) return lifted;
					const meta = lifted.meta as Record<string, unknown>;
					const requested = meta[CONTEXT_META_KEY];
					return {
						ok: true,
						input: lifted.args,
						// Values the caller set on the context are trusted code's, and win.
						context: { ...contextFieldValues(host.contextFields, meta), ...context },
						activeContext:
							requested === undefined
								? activeContext
								: typeof requested === 'string'
									? requested
									: JSON.stringify(requested),
					};
				},

				async callTool(name, input, context) {
					const result = await routeToolCall(name, input, context);
					return result.structuredContent ?? JSON.parse(result.content[0]?.text ?? 'null');
				},

				listTools(listStrategy = strategy, activeContext) {
					return getToolsList(listed, listStrategy, undefined, activeContext, { firstClassTools });
				},
			};
		},
	};
}
