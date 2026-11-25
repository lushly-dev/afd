/**
 * @fileoverview MCP Server factory for AFD commands.
 *
 * This module provides the `createMcpServer` factory that wires together
 * execution, tool routing, and transport layers into a single MCP server.
 */

import { createServer, type Server as HttpServer, type IncomingMessage } from 'node:http';
import type { CommandContext } from '@lushly-dev/afd-core';
import {
	type CommandMiddleware,
	executePipeline as executeCorePipeline,
	failure,
	isMcpExposed,
} from '@lushly-dev/afd-core';
import { validateOutputBudget } from '@lushly-dev/afd-core/commands';
import { callNotGranted } from '@lushly-dev/afd-core/internal/app-calls';
import { upFrontApproval } from './approval-relay.js';
import { createContextCommands, getBootstrapCommands } from './bootstrap/registry.js';
import { assertValidCommandNames, assertValidFirstClassTools } from './command-names.js';
import { filterByContext } from './command-routing.js';
import { resolveDefaultTimeoutMs, withCommandDeadlines } from './command-timeout.js';
import { createConfirmationGate } from './confirmation-gate.js';
import { checkContextFields } from './context-fields.js';
import { createContextState, resolveContextState } from './context-scope.js';
import { createExecutionEngine } from './execution.js';
import { createHttpHandler } from './http-handler.js';
import { createSessionStore, DEFAULT_MAX_SESSIONS, sessionLimits } from './http-sessions.js';
import { createHttpHostVerifiedCheck, createHumanRelayGate } from './human-relay.js';
import { checkInstanceState, warnInstancesOnce } from './instance-state.js';
import {
	createAuthLayer,
	type PreDispatchCheck,
	type PreDispatchCheckOptions,
} from './mcp-auth.js';
import type { Credentials } from './mcp-auth-rules.js';
import {
	createModernHttpLane,
	DEFAULT_TOOLS_LIST_TTL_MS,
	defaultInstructions,
	type ModernMcpDeps,
	serveModernStdio,
} from './mcp-modern.js';
import { assertToolMeta } from './meta-keys.js';
import {
	clearRelayEvidence,
	takeRelayDispatchAdmission,
	takeRelayValidatedInput,
	transferRelayState,
} from './relay-evidence.js';
import { createResourceService } from './resources.js';
import type { ZodCommandDefinition } from './schema.js';
import { listedCommands, scopeViewOf, shownOnly } from './scope-view.js';
import type { McpHandler, McpHandlerOptions, McpServer, McpServerOptions } from './server-types.js';
import { isStdinPiped } from './server-types.js';
import { assertValidTaskCommands } from './tasks.js';
import { TaskRuntime } from './tasks-runtime.js';
import { createToolRouter } from './tool-router.js';
import { getToolsList } from './tools.js';
import { resolveMaxValidationIssues, validateInputEnhanced } from './validation.js';

export type {
	CommandMiddleware,
	ContextConfig,
	CreateRequestContext,
	McpHandler,
	McpHandlerOptions,
	McpServer,
	McpServerOptions,
	McpTransport,
	ToolStrategy,
} from './server-types.js';
// Re-export public types so existing imports from './server.js' still work
export { isStdinPiped, MAX_FIRST_CLASS_TOOLS } from './server-types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// SERVER FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * M6, "At execution": with a resolver, every command a call with credentials runs is decided again
 * on its validated input (defaults applied, pipeline references resolved), after the required
 * scopes. First in the remote engine's chain, so a missing scope reaches no other middleware.
 */
const executionScopes: CommandMiddleware = async (commandName, input, context, next) => {
	const view = scopeViewOf(context);
	const decision = view?.decideExecution(commandName, input);
	return view && decision && decision !== 'proceed'
		? failure(view.insufficientScope(decision.forbidden))
		: next();
};

function createSharedHttpRuntime(options: McpHandlerOptions) {
	const {
		name,
		version,
		commands,
		port = 3100,
		host = 'localhost',
		devMode = false,
		cors = false,
		middleware = [],
		onCommand,
		onError,
		toolStrategy = 'grouped',
		groupByFn,
		contexts,
		bootstrap = false,
	} = options;
	// Checked first: a server that would depend on one process when told it has several does not
	// start (`instances`).
	const instanceState = checkInstanceState({
		name,
		instances: options.instances,
		confirmationKey: options.confirmationKey,
		confirmations: options.confirmations,
		hasHumanRelay: Boolean(options.humanRelay),
		middleware,
	});
	// A copy: the set must not change while the server runs.
	const firstClassTools = options.firstClassTools ? [...options.firstClassTools] : undefined;

	assertValidCommandNames(commands, { bootstrap, contexts: Boolean(contexts?.length) });
	// A command built by hand skips `defineCommand`'s check; registration refuses a bad key or budget
	// and snapshots the validated budget so later mutation of the input object cannot alter it.
	const validatedCommands = commands.map((command) => {
		assertToolMeta(command.name, command.toolMeta);
		return command.outputBudget !== undefined
			? { ...command, outputBudget: validateOutputBudget(command.outputBudget, command.name) }
			: command;
	});
	assertValidTaskCommands(validatedCommands);
	// Resource entries and the skill catalog are checked now, so a bad one stops the server from
	// being built. Their results do not vary by context, so contexts leave the TTL alone.
	const resourcesTtlMs = options.toolsListTtlMs ?? DEFAULT_TOOLS_LIST_TTL_MS;
	const resources = createResourceService(options.resources, options.skills, resourcesTtlMs);

	// stdio serves one client, so it uses this single state. HTTP callers each get a session
	// state (or none), bound to their command context by the HTTP handler.
	const contextState = contexts?.length ? createContextState() : undefined;
	const { clock } = options;
	if (options.maxSessionsPerOwner !== undefined) {
		if (!options.auth) {
			throw new Error(
				'maxSessionsPerOwner needs auth: without it every HTTP caller is one owner, whose quota is maxSessions'
			);
		}
		// Checked even without `contexts`, where no session is issued and the quota has no effect.
		sessionLimits(options.maxSessions, options.maxSessionsPerOwner);
	}
	const sessions = contextState
		? createSessionStore({
				maxSessions: options.maxSessions,
				// Without `auth` every caller is one owner, so its quota is the whole store.
				maxSessionsPerOwner: options.auth
					? options.maxSessionsPerOwner
					: (options.maxSessions ?? DEFAULT_MAX_SESSIONS),
				idleTimeoutMs: options.sessionIdleTimeoutMs,
				...(clock ? { now: () => clock.now() } : {}),
			})
		: undefined;

	const registeredCommands = [...validatedCommands];
	if (contextState && contexts) {
		for (const command of createContextCommands(contexts, contextState)) {
			if (registeredCommands.some((existing) => existing.name === command.name)) {
				throw new Error(`Reserved context command name: ${command.name}`);
			}
			registeredCommands.push(command);
		}
	}
	const contextFields = checkContextFields(options.contextFields);
	if (bootstrap) {
		// afd-help/afd-docs/afd-schema describe what a remote agent can see and call:
		// MCP-exposed commands in the active context (built-ins included).
		// The caller's context state: the HTTP session's, or the single stdio state.
		// With MCP authorization's filtered listings, only what the caller is shown (M6).
		const describe = (context?: CommandContext) =>
			listedCommands(
				filterByContext(remoteCommands, resolveContextState(context, contextState)?.getActive()),
				context
			);
		registeredCommands.push(
			...getBootstrapCommands(describe, {
				toolSurface: { toolStrategy, firstClassTools, contextFields },
			})
		);
	}
	assertValidFirstClassTools({ toolStrategy, firstClassTools, commands: registeredCommands });
	const commandMap = new Map<string, ZodCommandDefinition>();
	for (const cmd of registeredCommands) {
		commandMap.set(cmd.name, cmd);
	}

	const defaultTimeoutMs = resolveDefaultTimeoutMs(options.defaultTimeoutMs);
	const maxValidationIssues = resolveMaxValidationIssues(options.maxValidationIssues);
	if (
		options.maxBatchSize !== undefined &&
		(!Number.isSafeInteger(options.maxBatchSize) || options.maxBatchSize <= 0)
	) {
		throw new RangeError('maxBatchSize must be a positive integer');
	}
	if (
		options.maxBatchParallelism !== undefined &&
		(!Number.isSafeInteger(options.maxBatchParallelism) || options.maxBatchParallelism <= 0)
	) {
		throw new RangeError('maxBatchParallelism must be a positive integer');
	}
	const { maxBatchSize, maxBatchParallelism } = options;

	const contextDefaults = { clock: options.clock, random: options.random };
	const commandMiddleware = withCommandDeadlines(middleware, defaultTimeoutMs);
	const relayHooks = {
		transfer: transferRelayState,
		takeDispatch(context: CommandContext, commandName: string, data: unknown) {
			if (takeRelayDispatchAdmission(context, commandName, data) !== 'mismatch') return undefined;
			return {
				code: 'CONFIRMATION_REQUIRED',
				message: `'${commandName}' needs a person's confirmation through the host`,
				suggestion:
					'Do not retry: this call is not the one the person confirmed. Move middleware that retries or changes input before confirmation.',
				retryable: false,
				details: { commands: [commandName], reason: 'admission-mismatch' },
			};
		},
		clear: clearRelayEvidence,
	};
	const engine = createExecutionEngine({
		commandMap,
		middleware: commandMiddleware,
		devMode,
		onCommand,
		onError,
		contextDefaults,
		contextFields,
		maxBatchSize,
		maxBatchParallelism,
		maxValidationIssues,
		relay: relayHooks,
	});

	const remoteCommands = registeredCommands.filter((command) => isMcpExposed(command));
	const remoteCommandMap = new Map(remoteCommands.map((command) => [command.name, command]));
	const remoteEngine = createExecutionEngine({
		commandMap: remoteCommandMap,
		// MCP authorization (spec/authorization.md, M6): a resolver decides every command again at
		// execution, on its validated input, before any other middleware or the handler; and a
		// command hidden from the caller is looked up as a name that does not exist.
		middleware: options.auth ? [executionScopes, ...commandMiddleware] : commandMiddleware,
		...(options.auth && {
			hidden: (commandName: string, context: CommandContext) =>
				!(scopeViewOf(context)?.known(commandName) ?? true),
			shown: shownOnly,
		}),
		// A step of an afd-batch or afd-pipe approved up front runs on the input validated then
		// (#1414): what the human was shown, not what a second validation gives (a default that
		// is random or reads the clock differs). The step is still validated as sent when it
		// runs, since a schema may check state an earlier step changed; only the value is kept.
		validated: async (commandName, input, context) => {
			// A host-verified call already validated its input before calling `HumanRelay`, so
			// it runs on that exact validated object even when a schema default is non-deterministic.
			const prevalidated = takeRelayValidatedInput(context, commandName);
			if (prevalidated) return { success: true, data: prevalidated.data, errors: [] };
			const command = remoteCommandMap.get(commandName);
			const approved = command && (await upFrontApproval(context)?.validated(commandName, input));
			if (!approved) return undefined;
			const checked = validateInputEnhanced(command.inputSchema, input, maxValidationIssues);
			return checked.success ? { ...checked, data: approved.input } : checked;
		},
		devMode,
		onCommand,
		onError,
		contextState,
		contextDefaults: { ...contextDefaults, actor: options.actor ?? { kind: 'agent' } },
		contextFields,
		maxBatchSize,
		maxBatchParallelism,
		maxValidationIssues,
		relay: relayHooks,
	});
	const exposedCommandNames = new Set(remoteCommands.map((c) => c.name));
	const confirmations = createConfirmationGate(options.confirmations ?? 'off', remoteCommands);
	const defaultActor = options.actor ?? { kind: 'agent' as const };
	const humanRelay = createHumanRelayGate({
		relay: options.humanRelay,
		commands: remoteCommands,
		actor: defaultActor,
		devMode,
		contextFields,
		clock,
		maxValidationIssues,
		onError,
	});
	const hostVerifiedCheck = createHttpHostVerifiedCheck(
		remoteCommands,
		Boolean(options.humanRelay)
	);
	const mutationNames = new Set(
		remoteCommands.filter((command) => command.mutation === true).map((command) => command.name)
	);

	const routeToolCall = createToolRouter({
		executeCommand: remoteEngine.executeCommand,
		executeBatch: remoteEngine.executeBatch,
		executePipeline: remoteEngine.executePipeline,
		commands: remoteCommands,
		toolStrategy,
		groupByFn,
		devMode,
		allCommands: remoteCommands,
		exposedCommandNames,
		contextState,
		confirmations,
		humanRelay,
		maxBatchSize,
		maxBatchParallelism,
	});

	const boundGetToolsList = (context: CommandContext = {}) =>
		getToolsList(
			listedCommands(remoteCommands, context),
			toolStrategy,
			groupByFn,
			resolveContextState(context, contextState)?.getActive(),
			{
				outputSchema: options.advertiseOutputSchema,
				confirmations: confirmations.mode,
				firstClassTools,
			}
		);

	const maxBodyBytes = options.maxBodyBytes ?? 1024 * 1024;
	const auth = options.auth
		? createAuthLayer(options.auth, {
				maxBodyBytes,
				clock,
				commands: remoteCommands,
				toolStrategy,
				groupByFn,
			})
		: undefined;
	const taskRuntime = new TaskRuntime({
		commands: remoteCommands,
		executeCommand: remoteEngine.executeCommand,
		store: options.taskStore,
		options: options.taskOptions,
		clock,
		hasAuth: Boolean(auth),
		hasContextHook: Boolean(options.createContext),
		actor: options.actor ?? { kind: 'agent' },
	});
	const modernDeps: ModernMcpDeps = {
		name,
		version,
		instructions:
			options.instructions ?? defaultInstructions({ name, toolStrategy, contexts, bootstrap }),
		getToolsList: boundGetToolsList,
		routeToolCall,
		contexts,
		contextFields,
		toolsListTtlMs: options.toolsListTtlMs,
		toolStrategy,
		confirmationKey: instanceState.confirmationKey,
		actor: options.actor ?? { kind: 'agent' },
		approver: options.approver,
		resources,
		resourcesTtlMs,
		tasks: taskRuntime,
		authConfigured: Boolean(auth),
		devMode,
		onError,
	};
	const modern = createModernHttpLane({
		...modernDeps,
		createContext: options.createContext,
		maxBodyBytes,
		auth,
	});

	const { handler, dispose: disposeHttp } = createHttpHandler({
		name,
		version,
		host,
		port,
		cors,
		devMode,
		allowedHosts: options.allowedHosts,
		allowedOrigins: options.allowedOrigins,
		maxBodyBytes: options.maxBodyBytes,
		maxSseConnections: options.maxSseConnections,
		getToolsList: boundGetToolsList,
		routeToolCall,
		approver: options.approver,
		actor: options.actor ?? { kind: 'agent' },
		executeCommand: remoteEngine.executeCommand,
		executeBatch: remoteEngine.executeBatch,
		executeStream: remoteEngine.executeStream,
		isMutation: (commandName) => mutationNames.has(commandName),
		confirmations,
		hostVerifiedCheck,
		sessions,
		createContext: options.createContext,
		contextFields,
		onError,
		modern,
		auth,
		tasks: taskRuntime,
		maxBatchSize,
		maxBatchParallelism,
	});
	const dispose = () => {
		taskRuntime.dispose();
		disposeHttp();
	};

	return {
		engine,
		contextFields,
		routeToolCall,
		getToolsList: boundGetToolsList,
		handler,
		dispose,
		modernDeps,
		contextState,
		auth,
		httpWarning: instanceState.httpWarning,
		url: `http://${host}:${port}`,
	};
}

/**
 * Create an embeddable Node HTTP handler for MCP endpoints.
 *
 * Unlike `createMcpServer()`, this does not create or start an HTTP server.
 * The caller owns the server lifecycle and can attach the returned handler to
 * any Node HTTP host that accepts `(req, res) => Promise<void>`.
 */
export function createMcpHandler(options: McpHandlerOptions): McpHandler {
	const runtime = createSharedHttpRuntime(options);
	const { auth } = runtime;
	warnInstancesOnce(runtime.httpWarning);
	const needsAuth = (what: string) =>
		new Error(`[AFD] handler.${what} needs the auth option: this handler has no authorization`);
	return Object.assign(runtime.handler, {
		dispose: runtime.dispose,
		admit(req: IncomingMessage, credentials: Credentials): void {
			if (!auth) throw needsAuth('admit');
			auth.hostAdmit(req, credentials);
		},
		preDispatchCheck(checkOptions?: PreDispatchCheckOptions): PreDispatchCheck {
			if (!auth) throw needsAuth('preDispatchCheck');
			return auth.preDispatchCheck(checkOptions);
		},
	});
}

/**
 * Create an MCP server from Zod-defined commands.
 *
 * @example
 * ```typescript
 * import { createMcpServer, defineCommand } from '@lushly-dev/afd-server';
 *
 * const server = createMcpServer({
 *   name: 'my-app',
 *   version: '1.0.0',
 *   commands: [createTodo, listTodos, deleteTodo],
 * });
 *
 * await server.start();
 * console.log(`Server running at ${server.getUrl()}`);
 * ```
 */
export function createMcpServer(options: McpServerOptions): McpServer {
	const {
		name,
		version,
		commands,
		port = 3100,
		host = 'localhost',
		devMode = false,
		cors = false,
		transport = 'auto',
		middleware = [],
		onCommand,
		onError,
		toolStrategy = 'grouped',
		groupByFn,
		contexts,
	} = options;

	// ── Transport resolution ────────────────────────────────────────────────

	// Removed in 2.0. Fail loudly: silently ignoring it would switch `stdio: false` servers to
	// auto-detection, which picks stdio whenever stdin is piped.
	if ('stdio' in options) {
		throw new Error(
			'createMcpServer: the stdio option was removed in 2.0. Use transport: "stdio", "http" or "auto" instead.'
		);
	}

	function resolveTransport(): 'stdio' | 'http' {
		if (transport === 'auto') {
			return isStdinPiped() ? 'stdio' : 'http';
		}
		return transport as 'stdio' | 'http';
	}

	const resolvedTransport = resolveTransport();
	const useStdio = resolvedTransport === 'stdio';
	const useHttp = resolvedTransport === 'http';
	const autoDetected = transport === 'auto';

	// ── Shared execution/runtime wiring ─────────────────────────────────────

	const sharedRuntime = createSharedHttpRuntime({
		...options,
		name,
		version,
		commands,
		port,
		host,
		devMode,
		cors,
		middleware,
		onCommand,
		onError,
		toolStrategy,
		groupByFn,
		contexts,
	});

	// ── Server state ────────────────────────────────────────────────────────

	let httpServer: HttpServer | null = null;
	let stdioHandle: { close(): Promise<void> } | null = null;
	let isRunning = false;

	// ── Public API ──────────────────────────────────────────────────────────

	return {
		async start() {
			if (isRunning) return;

			// Stdio via the MCP SDK v2: dual-era (2026-07-28 per-request _meta, or initialize).
			if (useStdio) {
				stdioHandle = serveModernStdio(sharedRuntime.modernDeps, sharedRuntime.contextState);
				isRunning = true;
				// stdout carries MCP frames, so the notice goes to stderr.
				console.error(
					autoDetected
						? `[${name}] MCP transport: stdio (auto-detected because stdin is not a TTY; set transport: 'http' to serve HTTP)`
						: `[${name}] MCP transport: stdio`
				);

				if (!useHttp) return;
			}

			// HTTP transport
			if (useHttp) {
				httpServer = createServer(sharedRuntime.handler);

				await new Promise<void>((resolve, reject) => {
					httpServer?.on('error', reject);
					httpServer?.listen(port, host, () => {
						isRunning = true;
						resolve();
					});
				});
				console.error(
					`[${name}] MCP transport: http at ${sharedRuntime.url}${autoDetected ? ' (auto-detected because stdin is a TTY)' : ''}`
				);
				warnInstancesOnce(sharedRuntime.httpWarning);
			}
		},

		async stop() {
			if (!isRunning) return;

			if (stdioHandle) {
				sharedRuntime.dispose();
				await stdioHandle.close();
				stdioHandle = null;
			}

			if (httpServer) {
				sharedRuntime.dispose();
				httpServer.closeAllConnections();
				await new Promise<void>((resolve, reject) => {
					httpServer?.close((err) => {
						if (err) reject(err);
						else resolve();
					});
				});
				httpServer = null;
			}

			isRunning = false;
		},

		getUrl() {
			return useHttp ? sharedRuntime.url : 'stdio://';
		},

		contextFields: sharedRuntime.contextFields,

		getCommands() {
			return commands;
		},

		getTransport(): 'stdio' | 'http' {
			return resolvedTransport;
		},

		// An app's call needs a grant check this server does not have (`createAppCallRegistry`).
		execute: (name, input, context) =>
			context?.interface === 'apps'
				? Promise.resolve(failure(callNotGranted()))
				: sharedRuntime.engine.executeCommand(name, input, context),
		executePipeline: (request, context) =>
			context?.interface === 'apps'
				? executeCorePipeline(request, async () => failure(callNotGranted()))
				: sharedRuntime.engine.executePipeline(request, context),
	};
}
