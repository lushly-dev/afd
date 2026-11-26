/**
 * @fileoverview Shared MCP tool call routing — dispatches tool calls to the
 * appropriate execution function (batch, pipeline, call, lazy discovery, grouped, or individual).
 * The hybrid strategy needs no route of its own: its first-class tools are commands called by
 * name, exactly as under the individual strategy.
 *
 * Used by both stdio and HTTP transports to eliminate routing duplication.
 */

import type {
	BatchRequest,
	BatchResult,
	CommandContext,
	CommandError,
	CommandResult,
	PipelineRequest,
	PipelineResult,
} from '@lushly-dev/afd-core';
import {
	checkBatchLimits,
	createFailedBatchResult,
	failedBatchRequest,
	failure,
	isBatchRequest,
	isPipelineRequest,
	truncateName,
} from '@lushly-dev/afd-core';
import { commandNotAllowed } from '@lushly-dev/afd-core/internal/direct-allow';
import {
	approvalRelay,
	bindUpFrontApproval,
	type UpFrontApproval,
	withoutApprovalRelay,
} from './approval-relay.js';
import type { ContextState } from './bootstrap/afd-context.js';
import { filterAllowed, isCommandAllowed } from './command-allow.js';
import {
	type CallableSurface,
	canCall,
	commandAction,
	commandGroup,
	filterByContext,
	type GroupByFn,
	isAccessibleInContext,
	notFoundError,
	notFoundNext,
	notInContextError,
} from './command-routing.js';
import {
	type Acknowledgement,
	type ConfirmationGate,
	type ConfirmationOutcome,
	confirmationChannel,
	declaresConfirmInput,
	type HumanRelayGate,
	InputRequiredSignal,
} from './confirmations.js';
import { resolveContextState } from './context-scope.js';
import { executeDetail, executeDiscover } from './lazy-tools.js';
import {
	batchArgsSchema,
	callArgsSchema,
	checkMetaArgs,
	detailArgsSchema,
	discoverArgsSchema,
	parseMetaArgs,
	pipeArgsSchema,
} from './meta-tools.js';
import type { ZodCommandDefinition } from './schema.js';
import { knownOnly, listedCommands, scopeViewOf, shownOnly } from './scope-view.js';
import type { ToolStrategy } from './server-types.js';
import { taskDispatchOf } from './task-dispatch.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface ToolCallResult {
	content: Array<{ type: string; text: string }>;
	/** The same result as JSON (`spec/command-metadata.md`, "Structured results"). */
	structuredContent?: unknown;
	isError: boolean;
}

/**
 * What routing one call produced, before a lane encodes it: a result value (a `CommandResult`, a
 * `BatchResult`, a pipeline result, or a meta-tool's answer), or a tool result already shaped for
 * MCP (a task the call created).
 */
export type RouteOutcome =
	| { kind: 'value'; value: unknown; isError: boolean }
	| { kind: 'tool'; result: ToolCallResult }
	/**
	 * Refused by admission (`admission.ts`) before the router: each lane shapes `error` itself (a
	 * `CommandResult` over MCP and `/rpc`, a `BatchResult` on `/batch`, an error chunk on `/stream`).
	 */
	| { kind: 'refused'; error: CommandError };

/** A routing outcome carrying `value`. */
export function out(value: unknown, isError: boolean): RouteOutcome {
	return { kind: 'value', value, isError };
}

/** The MCP tool result of a routing outcome. */
export function toolResultOf(outcome: RouteOutcome): ToolCallResult {
	if (outcome.kind === 'tool') return outcome.result;
	if (outcome.kind === 'refused') return resultContent(failure(outcome.error), true);
	return resultContent(outcome.value, outcome.isError);
}

/**
 * Runs the one command a call admitted. The default runs it through the engine; the `/stream`
 * lane takes the admitted command, input and context instead, and streams it.
 */
export type RunAdmitted = (
	name: string,
	input: unknown,
	context: CommandContext
) => Promise<RouteOutcome>;

/** A routed tool call's answer as an MCP tool result, with the raw stages beside it. */
export interface ToolRouter {
	(toolName: string, args: unknown, callContext?: CommandContext): Promise<ToolCallResult>;
	/**
	 * Route one call and return its outcome unencoded (the HTTP routes encode it themselves).
	 * `run` replaces the engine for the one command a single-command call admits.
	 */
	route(
		toolName: string,
		args: unknown,
		callContext?: CommandContext,
		run?: RunAdmitted
	): Promise<RouteOutcome>;
}

/** A plain tool-call function, as tests and hosts may pass for a router. */
export type ToolCallFunction = (
	toolName: string,
	args: Record<string, unknown>,
	context: CommandContext
) => Promise<ToolCallResult>;

/** `router` as a {@link ToolRouter}: a plain function's results are already MCP tool results. */
export function asToolRouter(router: ToolRouter | ToolCallFunction): ToolRouter {
	if ('route' in router) return router;
	const route = async (toolName: string, args: unknown, context: CommandContext = {}) => ({
		kind: 'tool' as const,
		result: await router(toolName, (args ?? {}) as Record<string, unknown>, context),
	});
	return Object.assign(
		async (toolName: string, args: unknown, context?: CommandContext) =>
			toolResultOf(await route(toolName, args, context)),
		{ route }
	);
}

export interface ToolRouterDeps {
	executeCommand: (
		name: string,
		input: unknown,
		context?: CommandContext
	) => Promise<CommandResult>;
	executeBatch: (request: BatchRequest, context?: CommandContext) => Promise<BatchResult>;
	executePipeline: (request: PipelineRequest, context?: CommandContext) => Promise<PipelineResult>;
	commands: ZodCommandDefinition[];
	toolStrategy: ToolStrategy;
	groupByFn?: GroupByFn;
	devMode: boolean;
	/** All registered commands, including those outside the commands array */
	allCommands?: ZodCommandDefinition[];
	/** Set of command names exposed via the server's commands array */
	exposedCommandNames?: Set<string>;
	/** Context state used when the call context carries none (stdio and tests). */
	contextState?: ContextState;
	/** Confirmation enforcement (`confirmations` server option); none means off. */
	confirmations?: ConfirmationGate;
	/** Host-verified confirmation gate (`confirmationMode: 'host-verified'`); MCP servers only. */
	humanRelay?: HumanRelayGate;
	/** Maximum commands accepted in a single batch (default: 500). */
	maxBatchSize?: number;
	/** Maximum parallelism accepted in a single batch (default: 16). */
	maxBatchParallelism?: number;
	/**
	 * Whether this router's callers can call the meta-tools (default `true`): a refusal names one
	 * in its suggestion and recovery only then. The HTTP routes, which serve no meta-tool, set
	 * `false` (`spec/recovery.md`, "Engine errors").
	 */
	metaTools?: boolean;
	/** The trace ID prefix of a single command's run (default `afd-call`; the HTTP routes: `rpc`). */
	callTracePrefix?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EMPTY PIPELINE RESULT (for invalid pipeline requests)
// ═══════════════════════════════════════════════════════════════════════════════

const emptyPipelineResult = {
	data: undefined,
	metadata: {
		confidence: 0,
		confidenceBreakdown: [],
		reasoning: [],
		warnings: [],
		sources: [],
		alternatives: [],
		executionTimeMs: 0,
		completedSteps: 0,
		totalSteps: 0,
	},
	steps: [],
};

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTER
// ═══════════════════════════════════════════════════════════════════════════════

/** A pipeline refused before its first step, with `error` (a confirmation, a missing scope). */
function failedPipeline(error: CommandError) {
	return {
		...emptyPipelineResult,
		steps: [{ index: -1, command: '', status: 'failure', executionTimeMs: 0, error }],
	};
}

/** A call refused before any command runs, shaped as its tool's own result. */
export function refusedCall(toolName: string, error: CommandError): RouteOutcome {
	if (toolName === 'afd-batch') return out(createFailedBatchResult(error, {}), true);
	if (toolName === 'afd-pipe') return out(failedPipeline(error), true);
	return out(failure(error), true);
}

/**
 * Wrap a result as MCP tool content. The JSON is compact: the text is read by an
 * agent, and indentation only adds tokens.
 */
export function resultContent(data: unknown, isError: boolean): ToolCallResult {
	return {
		content: [{ type: 'text', text: JSON.stringify(data) }],
		...(data !== null && typeof data === 'object' && { structuredContent: data }),
		isError,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** The named-commands acknowledgement of `afd-batch` and `afd-pipe` (`confirm: [names]`). */
function namedAcknowledgement(value: unknown): Acknowledgement {
	return Array.isArray(value)
		? new Set(value.filter((item): item is string => typeof item === 'string'))
		: undefined;
}

/** The arguments without a top-level `confirm`, which the executors do not know. */
function withoutConfirm<T>(args: T): T {
	if (!isRecord(args) || !('confirm' in args)) return args;
	const { confirm: _confirm, ...rest } = args;
	return rest as T;
}

/**
 * The `COMMAND_NOT_IN_CONTEXT` tool result when `cmd` exists but is outside the
 * active context; undefined otherwise (a missing command is left to execution).
 *
 * @param can - Whether the caller can call a command, for the suggestion and recovery
 */
function contextDenial(
	cmd: ZodCommandDefinition | undefined,
	commandName: string,
	contextState: ContextState | null | undefined,
	can: (name: string) => boolean
): RouteOutcome | undefined {
	const activeContext = contextState?.getActive();
	if (!cmd || !activeContext || isAccessibleInContext(cmd, activeContext)) return undefined;
	return out(
		{ success: false, error: notInContextError(commandName, activeContext, cmd.contexts, can) },
		true
	);
}

/**
 * The `COMMAND_NOT_ALLOWED` tool result when the `allow` option of a direct registry call refuses
 * `commandName`; undefined otherwise, and always on the MCP lanes, which bind no `allow`.
 */
function allowDenial(commandName: string, callContext: CommandContext): RouteOutcome | undefined {
	if (isCommandAllowed(callContext, commandName)) return undefined;
	return out(failure(commandNotAllowed(commandName)), true);
}

/**
 * Create a tool call router that dispatches to the appropriate execution function.
 *
 * A direct registry call's `allow` option (`command-allow.ts`) narrows every route: a refused
 * command is not run, suggested, discovered or described. The engine checks it again for each
 * command it runs, so batch items and pipeline steps are covered too.
 */
export function createToolRouter(deps: ToolRouterDeps): ToolRouter {
	const { executeCommand, executeBatch, executePipeline, toolStrategy, groupByFn, devMode } = deps;
	const callPrefix = deps.callTracePrefix ?? 'afd-call';
	const engineRun: RunAdmitted = async (name, input, context) => {
		const result = await executeCommand(name, input, context);
		return out(result, !result.success);
	};

	/**
	 * Route one tool call.
	 *
	 * @param callContext - Base `CommandContext` for commands this call runs (request values,
	 *   `signal`, and the caller's context state); each execution adds its own `traceId`.
	 */
	async function route(
		toolName: string,
		args: unknown,
		callContext: CommandContext = {},
		run: RunAdmitted = engineRun
	): Promise<RouteOutcome> {
		const contextState = resolveContextState(callContext, deps.contextState);
		const gate = deps.confirmations;
		/**
		 * Check confirmations; `undefined` means the call may run. An elicitation is thrown as an
		 * {@link InputRequiredSignal}, which only a lane that bound an eliciting channel catches.
		 */
		const confirm = async (
			steps: Array<{ command: string; input: unknown }>,
			acknowledged: Acknowledgement,
			howToAcknowledge: string,
			toResult: (outcome: Extract<ConfirmationOutcome, { kind: 'error' }>) => RouteOutcome = (
				outcome
			) => out({ success: false, error: outcome.error }, true)
		): Promise<RouteOutcome | undefined> => {
			if (!gate || gate.mode === 'off') return undefined;
			// A lane whose acknowledgement is not an argument (the HTTP routes' `Afd-Confirm`
			// header) says what it acknowledges and how to send it; an argument counts for nothing.
			const byLane = confirmationChannel(callContext)?.acknowledgement;
			const outcome = await gate.check(
				steps,
				byLane ? byLane.names : acknowledged,
				callContext,
				byLane
					? byLane.how([...new Set(gate.gated(steps).map((step) => step.command))])
					: howToAcknowledge
			);
			if (outcome.kind === 'proceed') return undefined;
			if (outcome.kind === 'input-required') throw new InputRequiredSignal(outcome.result);
			return toResult(outcome);
		};
		const traced = (prefix: string): CommandContext => ({
			...callContext,
			traceId: `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		});
		const runHostVerified = async (
			cmd: ZodCommandDefinition | undefined,
			input: unknown,
			prefix: string
		): Promise<RouteOutcome | undefined> => {
			if (!deps.humanRelay || cmd?.confirmationMode !== 'host-verified') return undefined;
			const outcome = await deps.humanRelay.check(cmd, input, traced(prefix));
			if (outcome.kind === 'input-required') throw new InputRequiredSignal(outcome.result);
			if (outcome.kind === 'error') return out(failure(outcome.error), true);
			return run(cmd.name, input, outcome.context);
		};
		/**
		 * The context of a batch's or pipeline's steps. Steps cannot ask for approval mid-run (the
		 * retry would run the earlier steps again), so a call that can ask is approved up front, as
		 * a whole, before any step runs (#459). Only the MCP lane's relay offers that.
		 */
		const stepsContext = (
			tool: UpFrontApproval['tool'],
			prefix: string,
			request: BatchRequest | PipelineRequest
		): { context: CommandContext; upFront?: UpFrontApproval } => {
			const relay = approvalRelay(callContext);
			if (!relay) return { context: traced(prefix) };
			const steps = withoutApprovalRelay(traced(prefix));
			const upFront = relay.upFront?.(tool, request, commands);
			return upFront
				? { context: bindUpFrontApproval(steps, upFront), upFront }
				: { context: steps };
		};

		// MCP authorization (spec/authorization.md, M6). After routing and before the confirmation
		// gate, every call is decided again: a missing scope fails it, a batch or pipeline as a
		// whole. And a command hidden from the caller does not exist for it on any route: the
		// router sees only the commands that do, and names in suggestions only those it is shown.
		const view = scopeViewOf(callContext);
		const decision = view?.decideCall(toolName, args);
		if (view && decision && decision !== 'proceed') {
			return refusedCall(toolName, view.insufficientScope(decision.forbidden));
		}
		const commands = knownOnly(deps.commands, callContext);
		const allCommands = deps.allCommands && knownOnly(deps.allCommands, callContext);
		// Whether the caller can call a command, decided once for each refusal's suggestion and
		// recovery (`spec/recovery.md`, "Engine errors"). The router serves every meta-tool.
		const surface: CallableSurface = {
			metaTools: deps.metaTools ?? true,
			command: (name: string) => commands.find((command) => command.name === name),
			...(view && { shown: (name: string) => view.shown(name) }),
		};
		const can = (name: string) => canCall(surface, name, callContext, contextState?.getActive());
		const exposedCommandNames = deps.exposedCommandNames;
		/** The steps naming commands that exist for the caller: a confirmation names no other. */
		const existing = <T extends { command: string }>(steps: T[]): T[] =>
			view ? steps.filter((step) => view.known(step.command)) : steps;
		const taskDispatch = taskDispatchOf(callContext);
		const runTask = async (
			cmd: ZodCommandDefinition | undefined,
			input: unknown,
			prefix: string
		): Promise<RouteOutcome | undefined> => {
			if (!taskDispatch || (cmd?.task !== 'optional' && cmd?.task !== 'required')) return undefined;
			const result = await taskDispatch.dispatch(cmd, input, traced(prefix));
			return result && { kind: 'tool', result };
		};
		const requiredTaskIn = (steps: readonly { command: string }[]) =>
			taskDispatch
				? existing([...steps])
						.map((s) => commands.find((c) => c.name === s.command))
						.find((c) => c?.task === 'required')
				: undefined;

		// Handle afd-call (available in all strategies)
		if (toolName === 'afd-call') {
			const parsed = parseMetaArgs(
				toolName,
				callArgsSchema,
				args,
				'Provide { command: "command-name", input: {...} }'
			);
			if (!parsed.success) return out(parsed.result, true);
			const { command: commandName, input, confirm: confirmArg } = parsed.data;

			// Before the lookup, so a refused name gives the same answer whether it exists.
			const refused = allowDenial(commandName, callContext);
			if (refused) return refused;

			// Check if command exists in the exposed commands
			const cmd = commands.find((c) => c.name === commandName);
			if (!cmd) {
				// An unexposed command gets the same answer as an unknown one, so a remote
				// caller cannot learn that a private command exists (spec/error-codes.md, D4).
				// Suggest a few close matches the caller can use.
				const callable = filterAllowed(
					filterByContext(shownOnly(commands, callContext), contextState?.getActive()),
					callContext
				);
				return out(
					failure(
						notFoundError(
							commandName,
							callable.map((c) => c.name),
							notFoundNext(can)
						)
					),
					true
				);
			}

			// Context check: validate the command is accessible in current context
			const denied = contextDenial(cmd, commandName, contextState, can);
			if (denied) return denied;

			const hostVerified = await runHostVerified(cmd, input ?? {}, callPrefix);
			if (hostVerified) return hostVerified;

			const unconfirmed = await confirm(
				[{ command: commandName, input: input ?? {} }],
				confirmArg === true ? 'all' : undefined,
				'repeat the afd-call with confirm: true'
			);
			if (unconfirmed) return unconfirmed;

			const dispatched = await runTask(cmd, input ?? {}, callPrefix);
			if (dispatched) return dispatched;

			// Execute through the execution engine (full middleware chain)
			approvalRelay(callContext)?.route(commandName);
			return run(commandName, input ?? {}, traced(callPrefix));
		}

		// Handle afd-discover (listed by the lazy strategy, routable in all)
		if (toolName === 'afd-discover') {
			const parsed = parseMetaArgs(
				toolName,
				discoverArgsSchema,
				args,
				'Provide optional { category, tag, tagMode, search, includeMutation, limit, offset }'
			);
			if (!parsed.success) return out(parsed.result, true);
			// Filter by active context when context state is available, and by the call's `allow`
			const discoverCommands = filterAllowed(
				filterByContext(listedCommands(commands, callContext), contextState?.getActive()),
				callContext
			);
			const result = executeDiscover(discoverCommands, parsed.data);
			return out(result, false);
		}

		// Handle afd-detail (listed by the lazy and grouped strategies, routable in all)
		if (toolName === 'afd-detail') {
			const parsed = parseMetaArgs(
				toolName,
				detailArgsSchema,
				args,
				'Provide { command: "command-name" } or { command: ["name-1", "name-2"] } (max 10)'
			);
			if (!parsed.success) return out(parsed.result, true);
			const exposedNames = exposedCommandNames ?? new Set(commands.map((c) => c.name));
			// Filter by active context so agents cannot inspect commands outside their context, and
			// by the call's `allow`, so a refused command reads as unknown
			const contextFilteredCmds = filterAllowed(
				filterByContext(
					listedCommands(allCommands ?? commands, callContext),
					contextState?.getActive()
				),
				callContext
			);
			const result = executeDetail(
				contextFilteredCmds,
				exposedNames,
				parsed.data,
				notFoundNext(can)
			);
			return out(result, false);
		}

		// Handle built-in afd-batch tool
		if (toolName === 'afd-batch') {
			// The Zod schema pinpoints shape errors; isBatchRequest is the envelope check
			// shared with POST /batch. Both report INVALID_BATCH_REQUEST.
			const check = checkMetaArgs(batchArgsSchema, args);
			if (!check.success || !isBatchRequest(args)) {
				const usage = 'Provide { commands: [...] } with command objects';
				return out(
					failedBatchRequest(
						{},
						check.success ? undefined : { errors: check.errors },
						check.success ? usage : `${check.suggestion}. ${usage}`
					),
					true
				);
			}
			const limitError = checkBatchLimits(args, {
				maxBatchSize: deps.maxBatchSize,
				maxBatchParallelism: deps.maxBatchParallelism,
			});
			if (limitError) {
				return out(createFailedBatchResult(limitError, {}), true);
			}
			const batchArgs = args as unknown as Record<string, unknown>;
			const requiredBatch = requiredTaskIn(args.commands);
			if (requiredBatch && taskDispatch) {
				return out(
					createFailedBatchResult(
						taskDispatch.refuseComposite('afd-batch', requiredBatch.name),
						{}
					),
					true
				);
			}
			const batchSteps = existing(
				args.commands.map((item) => ({ command: item.command, input: item.input ?? {} }))
			);
			const hostVerifiedBatch = deps.humanRelay?.refuseSteps(batchSteps);
			if (hostVerifiedBatch) {
				return out(createFailedBatchResult(hostVerifiedBatch, {}), true);
			}
			const unconfirmed = await confirm(
				batchSteps,
				namedAcknowledgement(batchArgs.confirm),
				'repeat the afd-batch with confirm: [the command names]',
				(outcome) => out(createFailedBatchResult(outcome.error, {}), true)
			);
			if (unconfirmed) return unconfirmed;
			const request = withoutConfirm(args);
			const steps = stepsContext('afd-batch', 'batch', request);
			const result = await executeBatch(request, steps.context);
			// Nothing ran: the whole batch was refused, or waits for the user's approval.
			const refusal = steps.upFront?.refusal;
			if (refusal) return out(createFailedBatchResult(refusal, {}), true);
			return out(result, !result.success);
		}

		// Handle built-in afd-pipe tool
		if (toolName === 'afd-pipe') {
			// As for afd-batch: Zod pinpoints shape errors, and isPipelineRequest checks the
			// whole envelope (including `when` conditions). Both report INVALID_PIPELINE_REQUEST.
			const check = checkMetaArgs(pipeArgsSchema, args);
			if (!check.success || !isPipelineRequest(args)) {
				const usage =
					'Provide steps with nonempty command names, object inputs, valid conditions, and correctly typed options; input must be JSON';
				return out(
					{
						...emptyPipelineResult,
						steps: [
							{
								index: -1,
								command: '',
								status: 'failure',
								executionTimeMs: 0,
								error: {
									code: 'INVALID_PIPELINE_REQUEST',
									message: 'Invalid pipeline request envelope',
									suggestion: check.success ? usage : `${check.suggestion}. ${usage}`,
									...(!check.success && { details: { errors: check.errors } }),
								},
							},
						],
					},
					true
				);
			}
			const pipeArgs = args as unknown as Record<string, unknown>;
			const requiredPipe = requiredTaskIn(args.steps);
			if (requiredPipe && taskDispatch) {
				return out(
					failedPipeline(taskDispatch.refuseComposite('afd-pipe', requiredPipe.name)),
					true
				);
			}
			const pipeSteps = existing(
				args.steps.map((step) => ({ command: step.command, input: step.input ?? {} }))
			);
			const hostVerifiedPipe = deps.humanRelay?.refuseSteps(pipeSteps);
			if (hostVerifiedPipe) {
				return out(failedPipeline(hostVerifiedPipe), true);
			}
			const unconfirmed = await confirm(
				pipeSteps,
				namedAcknowledgement(pipeArgs.confirm),
				'repeat the afd-pipe with confirm: [the command names]',
				(outcome) => out(failedPipeline(outcome.error), true)
			);
			if (unconfirmed) return unconfirmed;
			const request = withoutConfirm(args);
			const steps = stepsContext('afd-pipe', 'pipeline', request);
			const result = await executePipeline(request, steps.context);
			const refusal = steps.upFront?.refusal;
			if (refusal) return out(failedPipeline(refusal), true);
			const hasFailed = result.steps.some((s) => s.status === 'failure');
			return out(result, hasFailed);
		}

		// Handle grouped tool calls (when toolStrategy === "grouped")
		if (toolStrategy === 'grouped') {
			const typedArgs = args as
				| { action?: string; params?: unknown; confirm?: unknown }
				| undefined;
			const action = typedArgs?.action;
			const commandParams = typedArgs?.params ?? {};

			if (devMode) {
				console.error(
					`[MCP Debug] Grouped tool call: toolName=${toolName}, action=${action}, args=${JSON.stringify(args)}`
				);
			}

			// Only the commands the call's `allow` permits, so a refused command is invisible here: it
			// cannot make an action ambiguous, and a group with none left is refused as a whole.
			const groupCommands = commands.filter((cmd) => commandGroup(cmd, groupByFn) === toolName);
			const allowedGroupCommands = filterAllowed(groupCommands, callContext);
			if (groupCommands.length > 0 && allowedGroupCommands.length === 0) {
				return out(failure(commandNotAllowed(toolName)), true);
			}

			if (action && typeof action === 'string') {
				const candidates = allowedGroupCommands.filter(
					(command) => commandAction(command) === action
				);
				if (candidates.length !== 1) {
					return out(
						failure({
							code: candidates.length ? 'AMBIGUOUS_ACTION' : 'COMMAND_NOT_FOUND',
							message: `Action '${truncateName(action)}' does not identify one command in group '${truncateName(toolName)}'`,
							suggestion:
								'Use afd-call with the full command name, or list tools to find a valid action.',
						}),
						true
					);
				}
				const actualCommandName = candidates[0]?.name as string;

				const refused = allowDenial(actualCommandName, callContext);
				if (refused) return refused;

				// Context check for grouped strategy
				const denied = contextDenial(candidates[0], actualCommandName, contextState, can);
				if (denied) return denied;

				const hostVerified = await runHostVerified(candidates[0], commandParams, 'trace');
				if (hostVerified) return hostVerified;

				const unconfirmed = await confirm(
					[{ command: actualCommandName, input: commandParams }],
					typedArgs?.confirm === true ? 'all' : undefined,
					`repeat the ${toolName} call with confirm: true`
				);
				if (unconfirmed) return unconfirmed;

				const dispatched = await runTask(candidates[0], commandParams, 'trace');
				if (dispatched) return dispatched;

				approvalRelay(callContext)?.route(actualCommandName);
				return run(actualCommandName, commandParams, traced('trace'));
			}

			// In grouped mode, if tool is a known group but action is missing/invalid,
			// return a helpful error instead of falling through. Only a group with a member the
			// caller is shown answers so, and it names only those members' actions (M6).
			const shownGroupCommands = shownOnly(allowedGroupCommands, callContext);
			if (shownGroupCommands.length > 0) {
				const availableActions = shownGroupCommands.map(commandAction);

				return out(
					{
						success: false,
						error: {
							code: 'INVALID_GROUPED_CALL',
							message: `Grouped tool '${toolName}' requires an 'action' parameter`,
							suggestion: `Provide { action: "<action>", params: {...} }. Available actions: ${availableActions.join(', ')}`,
						},
						_debug: devMode ? { receivedArgs: args } : undefined,
					},
					true
				);
			}
		}

		// Handle user-defined commands (individual mode or direct command calls)
		const refused = allowDenial(toolName, callContext);
		if (refused) return refused;
		// Context check: validate the command is accessible in current context
		const command = commands.find((c) => c.name === toolName);
		const denied = contextDenial(command, toolName, contextState, can);
		if (denied) return denied;

		// A confirm-gated tool advertises an optional `confirm` argument, removed here before the
		// command validates its input, unless the command's own schema declares `confirm`.
		// A host-verified command never advertises or accepts `confirm`, so its input is left intact.
		let input: unknown = args ?? {};
		const hostVerified = await runHostVerified(command, input, 'trace');
		if (hostVerified) return hostVerified;

		let acknowledged: Acknowledgement;
		if (
			gate &&
			gate.mode !== 'off' &&
			command?.confirmPrompt &&
			command.confirmationMode !== 'host-verified' &&
			isRecord(input)
		) {
			acknowledged = input.confirm === true ? 'all' : undefined;
			if (!declaresConfirmInput(command)) input = withoutConfirm(input);
		}
		const unconfirmed = await confirm(
			existing([{ command: toolName, input }]),
			acknowledged,
			'repeat the call with confirm: true'
		);
		if (unconfirmed) return unconfirmed;

		const dispatched = await runTask(command, input, 'trace');
		if (dispatched) return dispatched;

		approvalRelay(callContext)?.route(toolName);
		return run(toolName, input, traced('trace'));
	}

	const routeToolCall = async (toolName: string, args: unknown, callContext?: CommandContext) =>
		toolResultOf(await route(toolName, args, callContext));
	return Object.assign(routeToolCall, { route });
}
