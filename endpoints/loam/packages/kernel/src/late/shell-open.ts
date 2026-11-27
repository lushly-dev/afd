/**
 * @fileoverview `shell-open` and `canOpenInboxTarget` (phase 5 specification, 9.3), in the `late` chunk. `shell-open`
 * opens a {@link ResourceLinkV2} in main: it decides who may open what, then runs the shell's own handlers for it
 * (`scope-set`, `app-open`, `app-route-set`, `section-open`, `document-open`) inside its own call, so every check
 * those make still holds and the call is journaled once. A link is never a URL: no kind holds one.
 */

import type { CommandContext, CommandResult, JsonSchema } from '@lushly-dev/afd-core';
import { success } from '@lushly-dev/afd-core';
import { defineCommandWithSchema, type ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import type { DataAdapter } from '@lushly-dev/local-db';
import { z } from 'zod/mini';
import type { AppsRuntime } from '../apps-runtime.js';
import type { KernelFieldContext } from '../context-fields.js';
import { kernelFailure } from '../errors.js';
import { LIMIT_DEFAULTS, measureJson } from '../limits.js';
import type { AccessActorV1 } from '../scope/access.js';
import { canOpenInboxTarget } from '../scope/inbox-target.js';
import { canOpen } from '../scope/main-state.js';
import { projectNotFound } from '../scope/middleware.js';
import type { ScopeV1 } from '../scope/records.js';
import type { ScopeRuntime } from '../scope/runtime.js';
import type { MountedUiSlotV1, ResourceLinkV2, ViewBroker } from '../types.js';

/** A `ui://` URI: 1 to 256 characters, printable ASCII with no space or control character, and that scheme alone. */
const UI_URI = /^ui:\/\/[!-~]{1,251}$/;
const id = z.string().check(z.minLength(1), z.maxLength(128));
const scope = z.strictObject({ workspace: id, project: z.optional(id) });

const targetInput = z.discriminatedUnion('kind', [
	z.strictObject({
		kind: z.literal('document'),
		document: id,
		scope,
		anchor: z.optional(z.unknown()),
	}),
	z.strictObject({
		kind: z.literal('app'),
		instance: id,
		route: z.optional(z.string().check(z.maxLength(1024))),
		scope,
	}),
	z.strictObject({ kind: z.literal('project'), project: id, scope }),
	z.strictObject({
		kind: z.literal('section'),
		section: z.enum(['projects', 'documents', 'account', 'settings', 'inbox']),
		path: z.optional(z.string().check(z.maxLength(1024))),
		target: z.optional(z.string().check(z.minLength(1), z.maxLength(256))),
		scope,
	}),
	z.strictObject({
		kind: z.literal('mounted-ui'),
		instance: id,
		uri: z
			.string()
			.check(
				z.regex(UI_URI, { message: 'Use a ui:// resource URI advertised by the mounted instance' })
			),
		scope,
	}),
	z.strictObject({ kind: z.literal('confirmation'), notification: id, scope }),
]);
const openInput = z.strictObject({ target: targetInput });

/** `openInput` as JSON Schema, written out so the late chunk holds no schema converter (`literals.test.ts` holds it equal). */
const ID_JSON: JsonSchema = { type: 'string', minLength: 1, maxLength: 128 };
const SCOPE_JSON: JsonSchema = {
	type: 'object',
	properties: { workspace: ID_JSON, project: ID_JSON },
	required: ['workspace'],
	additionalProperties: false,
};
const variant = (
	kind: string,
	properties: Record<string, unknown>,
	required: string[]
): Record<string, unknown> => ({
	type: 'object',
	properties: { kind: { type: 'string', const: kind }, ...properties, scope: SCOPE_JSON },
	required: ['kind', ...required, 'scope'],
	additionalProperties: false,
});
const OPEN_JSON = {
	type: 'object',
	properties: {
		target: {
			oneOf: [
				variant('document', { document: ID_JSON, anchor: {} }, ['document']),
				variant('app', { instance: ID_JSON, route: { type: 'string', maxLength: 1024 } }, [
					'instance',
				]),
				variant('project', { project: ID_JSON }, ['project']),
				variant(
					'section',
					{
						section: {
							type: 'string',
							enum: ['projects', 'documents', 'account', 'settings', 'inbox'],
						},
						path: { type: 'string', maxLength: 1024 },
						target: { type: 'string', minLength: 1, maxLength: 256 },
					},
					['section']
				),
				variant(
					'mounted-ui',
					{ instance: ID_JSON, uri: { type: 'string', pattern: UI_URI.source } },
					['instance', 'uri']
				),
				variant('confirmation', { notification: ID_JSON }, ['notification']),
			],
		},
	},
	required: ['target'],
	additionalProperties: false,
} as unknown as JsonSchema;

/** What `shell-open` reads of `late/`'s deps. */
export interface ShellOpenDeps {
	store: DataAdapter;
	scope: ScopeRuntime;
	apps: () => AppsRuntime;
	state: { activeApp(): string | null };
	/** The kernel's limits, whose `messageBytes` gates the slot's frame, and its clock, for the slot's read window. */
	limits?: { values(): { messageBytes: number } };
	clock?: { now(): number };
	/** A replay's: a `shell-open` entry's result, which answers a `mounted-ui` open's `mountedView` (9.3). */
	internals?: { recordedResult?(traceId: string | undefined): CommandResult | undefined };
}

/** A registered command, whose handler `shell-open` runs inside its own call. */
type Held = { handler?: unknown } | undefined;

export { canOpenInboxTarget };

/** `shell-open`, and what tells it that main has moved since. */
export interface ShellOpenParts {
	command: ZodCommandDefinition;
	/**
	 * After each call `late/`'s `settle` sees: one other than `shell-open` whose `mainChanged` or `scopeChanged` note says
	 * it moved main or the scope replaced the mounted-ui slot's view, so opening that view again changes main (9.3).
	 */
	settled(
		name: string,
		seen: { mainChanged?: unknown; scopeChanged?: unknown; actorChanged?: unknown } | undefined,
		traceId?: string
	): void;
}

export function createShellOpen(
	given: ShellOpenDeps,
	editorOwner: () => Promise<string | null>,
	commandOf: (name: string) => Held
): ShellOpenParts {
	const deps = {
		...given,
		activeApp: () => given.state.activeApp(),
		editorOwner,
	};
	const run = async (name: string, input: unknown, context: CommandContext) => {
		const handler = commandOf(name)?.handler as
			| ((input: unknown, context: CommandContext) => Promise<CommandResult>)
			| undefined;
		if (!handler)
			return kernelFailure(
				'LATE_COMMANDS_UNAVAILABLE',
				`'${name}' is not loaded`,
				'Reload to try again'
			) as CommandResult<never>;
		return handler(input, context);
	};
	/**
	 * The mounted view the slot shows, by instance and URI, transient: a reload shows none (9.3). Another call that moves
	 * main or the scope replaces it (`settled`).
	 */
	let shownView: string | undefined;
	/** The slot's view, by the call that opened it; its HTML is held here alone, never answered or journaled (9.3). */
	let slot: MountedUiSlotV1 | undefined;
	/** What main shows, to tell whether the open changed anything. */
	const where = () =>
		JSON.stringify([deps.scope.active(), deps.activeApp(), deps.scope.workspace.id]);

	/** Replace the slot's view: the page drops its frame, by `traceId`'s note, and the next open of it changes main. */
	const drop = (traceId: string | undefined) => {
		shownView = undefined;
		if (slot) deps.scope.note(traceId, { mountedUi: null });
		slot = undefined;
	};

	/** Move to the target's scope first, when it is another, through `scope-set` (its own checks and undo). */
	const into = async (target: ScopeV1, context: CommandContext, app?: string | null) => {
		const active = deps.scope.active();
		if (active.project === target.project && app === undefined) return undefined;
		const moved = await run(
			'scope-set',
			{ project: target.project ?? null, ...(app !== undefined ? { app } : {}) },
			context
		);
		return moved.success ? undefined : moved;
	};

	const command = defineCommandWithSchema<
		typeof openInput,
		{ opened: ResourceLinkV2; changed: boolean }
	>({
		name: 'shell-open',
		title: 'Open in the shell',
		description:
			'Open a document, an app, a project, a section, a confirmation or a mounted ui:// view in main, within what you may enter. Never a URL',
		category: 'navigation',
		mutation: true,
		executionTime: 'instant',
		input: openInput,
		jsonSchema: OPEN_JSON,
		async handler(input, context) {
			const at = where();
			const result = await open(input.target as ResourceLinkV2, context);
			// Main moved, by `into()`'s `scope-set`, and then the open failed: the slot's view belongs to where it left (9.3).
			if (!result.success && where() !== at) drop(context.traceId);
			return result;
		},
	}) as unknown as ZodCommandDefinition;

	/** `shell-open`'s work, inside its call: who may open what, then the shell's own handler for it. */
	async function open(
		target: ResourceLinkV2,
		context: CommandContext
	): Promise<CommandResult<{ opened: ResourceLinkV2; changed: boolean }>> {
		const call = context as CommandContext & KernelFieldContext;
		const caller = call.caller;
		// T31: only the active app, or the active document's editor, may move main.
		if (
			caller !== undefined &&
			caller !== deps.activeApp() &&
			caller !== (await deps.editorOwner())
		)
			return kernelFailure(
				'SHELL_OPEN_NOT_ACTIVE',
				'This app is not the one the person is using',
				'Only the active app or active document editor may call shell-open'
			);
		if (target.scope.workspace !== deps.scope.workspace.id)
			return kernelFailure(
				'SCOPE_MISMATCH',
				'That target is in another workspace',
				'Open targets in the active workspace'
			);
		const project = target.kind === 'project' ? target.project : target.scope.project;
		if (caller !== undefined) {
			const apps = deps.apps();
			const levels: readonly string[] = apps.port(caller).manifest.app?.scope_levels ?? [
				'workspace',
			];
			if (project !== undefined && !levels.includes('project'))
				return kernelFailure(
					'SCOPE_NOT_GRANTED',
					'This app opens nothing in a project',
					'Open a workspace-level target'
				);
			if (
				project !== undefined &&
				(canOpen(apps, deps.scope, caller, project) !== undefined ||
					!deps.scope.allows(call.actor as AccessActorV1, { ...target.scope, project }))
			)
				return projectNotFound();
		} else if (
			project !== undefined &&
			(deps.scope.project(project) === undefined ||
				!deps.scope.allows(call.actor as AccessActorV1, { ...target.scope, project }))
		)
			return projectNotFound();
		const before = where();
		let opened: CommandResult;
		/** A replay's answer for a `mounted-ui` open, which holds no HTML and so makes no slot. */
		let recorded: CommandResult | undefined;
		switch (target.kind) {
			case 'document': {
				opened = await run('document-open', { document: target.document }, context);
				break;
			}
			case 'app': {
				const moved = await into(target.scope, context);
				if (moved) return moved as CommandResult<never>;
				opened = await run('app-open', { instance: target.instance }, context);
				if (opened.success && target.route)
					opened = await run(
						'app-route-set',
						{ instance: target.instance, path: target.route },
						context
					);
				break;
			}
			case 'project': {
				if (target.scope.project !== undefined && target.scope.project !== target.project)
					return kernelFailure(
						'SCOPE_MISMATCH',
						'The project and its scope name two projects',
						'Give the project once, or the same in both'
					);
				const moved = await into({ ...target.scope, project: target.project }, context);
				if (moved) return moved as CommandResult<never>;
				opened = await run('section-open', { section: 'projects' }, context);
				break;
			}
			case 'section': {
				if (target.section === 'inbox' && target.path) {
					const refused = await canOpenInboxTarget(deps, target.path, context, {
						requireConfirmation: false,
						scope: target.scope,
					});
					if (refused) return refused;
				}
				const moved = await into(target.scope, context);
				if (moved) return moved as CommandResult<never>;
				// A settings target is a place, not a value. An app opens only its own sections' places and the shell's
				// (`loam.*`), looked up as the shell does, since it reads no value; every other target, and one that does not
				// exist, gets one refusal, so no app lists another's sections or keys.
				const { caller: _caller, ...uncalled } = call;
				const plugin =
					caller === undefined ? undefined : deps.apps().port(caller).manifest.plugin.id;
				if (
					plugin !== undefined &&
					target.target !== undefined &&
					!target.target.startsWith(`${plugin}.`) &&
					!target.target.startsWith('loam.')
				)
					return noSuchSetting();
				opened = await run(
					'section-open',
					{
						section: target.section,
						...(target.path !== undefined ? { path: target.path } : {}),
						...(target.target !== undefined ? { target: target.target } : {}),
					},
					target.target !== undefined ? (uncalled as CommandContext) : context
				);
				if (plugin !== undefined && !opened.success && opened.error?.code === 'SETTING_NOT_FOUND')
					return noSuchSetting();
				break;
			}
			case 'confirmation': {
				const refused = await canOpenInboxTarget(deps, target.notification, context, {
					requireConfirmation: true,
					scope: target.scope,
				});
				if (refused) return refused;
				const moved = await into(target.scope, context);
				if (moved) return moved as CommandResult<never>;
				opened = await run(
					'section-open',
					{ section: 'inbox', path: target.notification },
					context
				);
				break;
			}
			case 'mounted-ui': {
				// A replay runs the open again, its move into the target's scope included, and answers the whole of
				// `mountedView` (the opt-in, the sandbox origin, the projects and the fetch) from the entry's result, so a
				// replay never contacts a mounted server (9.3, as the step 10 record amends it).
				recorded = deps.internals?.recordedResult?.(context.traceId);
				const view = deps.apps().mountedView;
				opened = recorded
					? recorded.success
						? success({})
						: recorded
					: view
						? await view(target.instance, target.uri, target.scope)
						: kernelFailure(
								'VIEW_RESOURCE_UNAVAILABLE',
								'This shell serves no mounted view yet',
								'Open the instance with kind app'
							);
				// Into the target's scope, as every other kind moves, once the view is known to open (9.3).
				if (opened.success) {
					const moved = await into(target.scope, context);
					if (moved) return moved as CommandResult<never>;
				}
				break;
			}
		}
		if (!opened.success) return opened as CommandResult<never>;
		// The mounted-ui slot's view, held transiently (9.3): the same view already open changes nothing; anything else
		// shown in main replaces it.
		// The view is the instance's URI in its scope: the same one in another project is another open.
		const view =
			target.kind === 'mounted-ui'
				? JSON.stringify([target.instance, target.uri, target.scope.project ?? null])
				: undefined;
		// The same view, still in the slot; or, in a replay, answered from the record as the live open was.
		const sameView =
			view !== undefined && view === shownView && (slot !== undefined || recorded !== undefined);
		shownView = view;
		// A replay has no page and no HTML: its view was answered from the record.
		const { html, origin } = (opened.data ?? {}) as { html?: unknown; origin?: string };
		if (target.kind === 'mounted-ui' && typeof html === 'string') {
			if (!sameView) {
				const { instance, scope: at } = target;
				slot = {
					instance,
					uri: target.uri,
					scope: { ...at },
					source: { read: async () => ({ html }) },
					view: slotBroker(
						origin ?? null,
						(uri) => deps.apps().mountedView?.(instance, uri, at),
						deps.limits,
						() => (deps.clock ?? Date).now()
					),
				};
				deps.scope.note(context.traceId, { mountedUi: slot });
			}
		} else if (slot) {
			slot = undefined;
			deps.scope.note(context.traceId, { mountedUi: null });
		}
		return success({
			opened: structuredClone(target),
			changed:
				where() !== before || (target.kind === 'mounted-ui' ? !sameView : openedChanged(opened)),
		});
	}
	return {
		command,
		settled(name, seen, traceId) {
			// Its own move is the open itself, which `shownView` already holds. A change of person drops it whatever main
			// does, since the view and its broker were the last person's (T32): `actorChanged`, and in `local` mode, which
			// notes none, any sign-in or sign-out, even one refused.
			if (
				seen?.actorChanged ||
				name === 'auth-sign-in' ||
				name === 'auth-sign-out' ||
				(name !== 'shell-open' && (seen?.mainChanged || seen?.scopeChanged))
			)
				drop(traceId);
		},
	};
}

/** How many reads a mounted view's broker starts in {@link SLOT_READ_WINDOW_MS}. */
export const SLOT_READS = 10;
/** The window {@link SLOT_READS} counts in, by the kernel's clock: each read lists and fetches again, up to 2 MiB. */
export const SLOT_READ_WINDOW_MS = 10_000;

/**
 * The mounted-ui slot's broker (9.3, T32): read-only. It answers no `tools/call`, of any instance, its own included, and
 * reads only a `ui://` view its instance lists, through `mountedView`'s checks and bounds, a few at a time. `limits` and
 * `clock` are the kernel's, as a view app's guard reads them.
 */
function slotBroker(
	sandboxOrigin: string | null,
	read: (uri: string) => Promise<CommandResult> | undefined,
	limits: ShellOpenDeps['limits'],
	clock: () => number
): ViewBroker {
	const refused = (message: string, suggestion: string) => ({
		code: 'VIEW_CALL_REFUSED',
		message,
		suggestion,
		details: { rpcCode: -32602 },
	});
	const none = async (): Promise<never> => {
		throw refused('A mounted view calls no tools', 'Open its instance as an app to run them');
	};
	let reading = 0;
	/** When the current read window opened, and the reads in it, so a view cannot loop on them. */
	let opened = 0;
	let reads = 0;
	return {
		sandboxOrigin,
		// The gate on every message the frame sends, as a view app's guard's (phase 4's section 11).
		admit(message) {
			// The owner's `loam.limits.messageBytes`, read live, as `createLimitGuard` reads it.
			const limit = (limits?.values() ?? LIMIT_DEFAULTS).messageBytes;
			return measureJson(message, limit).over
				? {
						code: 'INPUT_TOO_LARGE',
						rpcCode: -32602,
						message: `A message over ${limit} bytes of JSON was dropped`,
						suggestion: 'Send less, or ask an owner to raise loam.limits.messageBytes',
						details: { limit },
					}
				: undefined;
		},
		toolsCall: none,
		runBound: none,
		onLinkedCall: () => () => {},
		async resourcesRead(params) {
			const uri = (params as { uri?: unknown } | null)?.uri;
			const listed = typeof uri === 'string' && UI_URI.test(uri);
			const now = clock();
			if (now - opened >= SLOT_READ_WINDOW_MS) {
				opened = now;
				reads = 0;
			}
			if (listed && reading < 4 && ++reads > SLOT_READS)
				throw {
					code: 'RATE_LIMITED',
					message: `A mounted view reads at most ${SLOT_READS} views in ${SLOT_READ_WINDOW_MS / 1000} seconds`,
					suggestion: 'Wait, then read again',
					details: {
						rpcCode: -32602,
						limit: SLOT_READS,
						retryAfterMs: opened + SLOT_READ_WINDOW_MS - now,
					},
				};
			if (listed) reading++;
			try {
				// At most four in flight, as a view app's (phase 4's section 11).
				const html =
					listed && reading <= 4
						? ((await read(uri))?.data as { html?: unknown } | undefined)?.html
						: undefined;
				if (typeof html !== 'string')
					throw refused(
						'A mounted view reads only the ui:// views its instance lists',
						'Read one it lists, a few at a time'
					);
				return {
					contents: [{ uri: uri as string, mimeType: 'text/html;profile=mcp-app', text: html }],
				};
			} finally {
				if (listed) reading--;
			}
		},
	};
}

/** An app's settings target it may not open, or that does not exist: one refusal for both (9.3). */
const noSuchSetting = () =>
	kernelFailure(
		'SETTING_NOT_FOUND',
		'There is no such setting to open',
		"Open one of this app's own settings sections, or a shell section under loam."
	);

/** Whether the handler that opened it changed main: a section or tab it opened that was not already open. */
const openedChanged = (result: CommandResult): boolean => {
	const data = result.data as
		| { previous?: unknown; section?: unknown; opened?: unknown }
		| undefined;
	if (data === undefined) return false;
	if ('section' in data && 'previous' in data) return data.section !== data.previous;
	if ('opened' in data) return data.opened !== false;
	return true;
};
