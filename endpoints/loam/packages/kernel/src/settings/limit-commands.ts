/**
 * @fileoverview The limits' commands and rules (phase 4 specification, section 11; D124), in the `late-settings` chunk
 * beside the settings: the quarter rule `loam.limits` writes keep, the workspace's values read into the kernel's
 * {@link KernelLimits} (which enforces the defaults from boot, whether or not this chunk ever loads), `limit-usage-get`
 * for owners, and boot's own `store-usage-settle`. Nothing of first paint is imported but types: the kernel's limits
 * object reaches here through the deps (phase 3 specification, 13).
 */

import type { CommandContext, CommandResult } from '@lushly-dev/afd-core';
import type { JsonSchema, ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import type { AppsRuntime } from '../apps-runtime.js';
import type { KernelFieldContext } from '../context-fields.js';
import type { KernelLimits, LimitKeyV1, LimitValuesV1 } from '../limits.js';
import type { AccessActorV1 } from '../scope/access.js';
import type { DocumentKit } from '../scope/command-kit.js';
import type { ScopeRuntime } from '../scope/runtime.js';
import { isHumanGesture } from './setting-rules.js';

/** The section's full id, and where its settings live (3.5). */
export const LIMITS_SECTION_ID = 'loam.limits';
export const LIMITS_ROUTE = `~/settings/${LIMITS_SECTION_ID}`;

/** The keys, in section 11's order; `limits.ts` holds the same, and a unit holds the two equal. */
export const LIMIT_KEY_ORDER: readonly LimitKeyV1[] = Object.freeze([
	'messageBytes',
	'inputBytes',
	'callsPerSecond',
	'storeBytes',
	'journalEntryBytes',
]);

/** Each limit's count among `refusals`, every key present, in section 11's order. */
export function countRefusals(
	refusals: ReadonlyArray<{ limit: LimitKeyV1 }>
): Record<LimitKeyV1, number> {
	const counts = Object.fromEntries(LIMIT_KEY_ORDER.map((key) => [key, 0])) as Record<
		LimitKeyV1,
		number
	>;
	for (const refusal of refusals) counts[refusal.limit] += 1;
	return counts;
}

/**
 * Most milliseconds a usage row is trusted before stage B counts its table again: `apps/store.ts`' `USAGE_RECOUNT_MS`,
 * repeated so this chunk imports nothing of `apps` (a unit holds them equal).
 */
export const USAGE_RECOUNT_MS = 86_400_000;

/** The owners' notice of an app's first refusal by a limit in an hour (section 11), in words. */
export function limitNotice(
	instance: string,
	limit: LimitKeyV1
): { title: string; body: string; tone: 'warning' } {
	return {
		title: `The app '${instance}' was refused by loam.limits.${limit}`,
		body: `The first refusal of this app in an hour. Read what each app uses in the shell's settings, at ${LIMITS_ROUTE}, and raise the limit there if the app needs it.`,
		tone: 'warning',
	};
}

/** `inputBytes` is at most a quarter of `journalEntryBytes` (section 11), so an entry holding one input fits. */
export const INPUT_SHARE = 4;

/** The suggestion that names the order (section 11), for a write that breaks the quarter rule. */
export const QUARTER_ORDER =
	'Lower inputBytes before journalEntryBytes; raise journalEntryBytes before inputBytes';

/**
 * Why `values`, the section's values as they would be after a write, break the quarter rule, or undefined. The values
 * read for a key that is not a whole number are not checked here: the key's own bounds refuse them first.
 */
export function quarterProblem(values: Record<string, unknown>): string | undefined {
	const { inputBytes, journalEntryBytes } = values;
	if (typeof inputBytes !== 'number' || typeof journalEntryBytes !== 'number') return undefined;
	return inputBytes * INPUT_SHARE > journalEntryBytes
		? `would make inputBytes (${inputBytes}) more than a quarter of journalEntryBytes (${journalEntryBytes})`
		: undefined;
}

/**
 * The values the kernel enforces, from what the workspace's section resolves to: whole numbers inside their bounds
 * only (a value that no longer validates was skipped for its default by resolution), and, should a stored pair break
 * the quarter rule, `inputBytes` lowered to a quarter, so the kernel never enforces less than the rule (fail closed).
 */
export function enforcedLimits(resolved: Record<LimitKeyV1, number>): LimitValuesV1 {
	const values = { ...resolved };
	values.inputBytes = Math.min(
		values.inputBytes,
		Math.floor(values.journalEntryBytes / INPUT_SHARE)
	);
	return values;
}

/** What this module reads of first paint's modules, given by `late/` (phase 3 specification, 13). */
export type LimitKit = Pick<
	DocumentKit,
	'define' | 'success' | 'kernelFailure' | 'z' | 'callNow'
> & {
	personKey(actor: AccessActorV1): string | undefined;
};

export interface LimitDeps {
	scope: ScopeRuntime;
	apps(): AppsRuntime;
	limits?: KernelLimits;
	/** Whether `person` is an owner, on the membership `call` reads: on the server its principal's (phase 3 specification, 7.1 and 9.5). */
	isOwner(person: string | undefined, call: { actor?: unknown }): boolean;
	/** Whether the deployment's identity is `provider`, where a signed-out call has no person. */
	provider: boolean;
	/**
	 * The owners' notice of an instance's first refusal in an hour (section 11), through step 5's inbox, in the call of
	 * `limit-notice-push`: how many owners it reached.
	 */
	notice?(
		context: CommandContext,
		refusal: { instance: string; limit: LimitKeyV1 }
	): Promise<number>;
	kit: LimitKit;
}

export interface LimitCommands {
	commands: ZodCommandDefinition[];
	/** Boot's own `store-usage-settle`: in `BOOT_ONLY`, so no caller reaches it. */
	settleCommand: ZodCommandDefinition;
	/** Boot's own `limit-notice-push`, the owners' notice journaled, so a replay sends the same: `BOOT_ONLY`. */
	noticeCommand: ZodCommandDefinition;
	/** What a settle would write now: each instance whose counted bytes differ from its row's. */
	usageChanges(now: number): Promise<Array<{ instance: string; used: number }>>;
}

const INSTANCE = /^[a-z][a-z0-9]{0,31}$/;

/** `limit-usage-get`'s output budget, in UTF-8 bytes (D115): a deployment's instances are few. */
export const LIMIT_OUTPUT_BUDGET = { defaultBytes: 65_536, maxBytes: 65_536 } as const;

export function createLimitCommands(deps: LimitDeps): LimitCommands {
	const { kit, scope } = deps;
	const { z } = kit;
	const fail = kit.kernelFailure;

	const workspace = () => scope.workspace.id;

	/** Every deployed instance, by id: the rail's, whatever state it is in. */
	const instances = (): string[] =>
		[
			...new Set(
				deps
					.apps()
					.summaries()
					.map((app) => app.instance)
			),
		].sort();

	const usageInput = z.strictObject({
		instance: z.optional(z.string().check(z.minLength(1), z.maxLength(32))),
	});

	type Usage = {
		instances: Array<{
			instance: string;
			storeBytes: { used: number; limit: number };
			refusals: Record<LimitKeyV1, number>;
		}>;
	};

	const usage = kit.define<typeof usageInput, Usage>({
		name: 'limit-usage-get',
		title: 'Show what each app uses of the limits',
		description:
			"Each app's stored bytes against loam.limits.storeBytes, and how often each limit refused it in the last hour. Owners only",
		category: 'setting',
		mutation: false,
		executionTime: 'instant',
		input: usageInput,
		jsonSchema: {
			type: 'object',
			properties: { instance: { type: 'string', minLength: 1, maxLength: 32 } },
			additionalProperties: false,
		} as unknown as JsonSchema,
		async handler(input, context: CommandContext): Promise<CommandResult<Usage>> {
			if ((context as KernelFieldContext).caller !== undefined)
				return fail(
					'CALL_NOT_GRANTED',
					'No app reads the limits’ usage',
					'Let an owner read it in the shell'
				);
			// Refused in its own handler, so the hand-off is its own (A-P3-1, F2): an agent, the copilot among them.
			if (!isHumanGesture(context)) {
				return fail(
					'HUMAN_REQUIRED',
					'Only a person who owns the workspace reads what each app uses of the limits',
					`Ask an owner to read it in the shell's settings, at ${LIMITS_ROUTE}`,
					{ details: { route: LIMITS_ROUTE, section: LIMITS_SECTION_ID, level: 'workspace' } }
				);
			}
			if (input.instance !== undefined && !INSTANCE.test(input.instance)) {
				return fail(
					'VALIDATION_ERROR',
					'`instance` is an instance id: a lowercase letter, then up to 31 letters and digits',
					'Name an instance as the rail lists it, or leave `instance` out'
				);
			}
			const person =
				kit.personKey(context.actor as AccessActorV1) ?? (deps.provider ? undefined : 'local');
			if (!deps.isOwner(person, context)) {
				return fail(
					'OWNER_REQUIRED',
					'Only an owner of the workspace reads what each app uses of the limits',
					'Ask an owner of the workspace to do this'
				);
			}
			const now = kit.callNow(context);
			const limit = (deps.limits?.values().storeBytes ?? 0) as number;
			const quota = deps.apps().storeQuota;
			const rows: Usage['instances'] = [];
			for (const instance of instances()) {
				if (input.instance !== undefined && instance !== input.instance) continue;
				rows.push({
					instance,
					storeBytes: { used: quota ? await quota.used(instance, workspace()) : 0, limit },
					refusals: deps.limits?.counts(instance, now) ?? countRefusals([]),
				});
			}
			const data: Usage = { instances: rows };
			if (new TextEncoder().encode(JSON.stringify(data)).length > LIMIT_OUTPUT_BUDGET.maxBytes) {
				return fail(
					'OUTPUT_BUDGET_EXCEEDED',
					'The usage of every app is over this command’s output budget',
					'Name one app with `instance`'
				);
			}
			return kit.success(structuredClone(data));
		},
	});

	const USAGE = z
		.array(
			z.strictObject({
				instance: z.string().check(z.minLength(1), z.maxLength(32)),
				used: z.int().check(z.minimum(0)),
			})
		)
		.check(z.maxLength(1_000));
	const settleInput = z.strictObject({ usage: USAGE });
	const settle = kit.define<typeof settleInput, { settled: number }>({
		name: 'store-usage-settle',
		description: "Boot's own: count each app's stored bytes afresh, for loam.limits.storeBytes",
		category: 'setting',
		mutation: true,
		executionTime: 'instant',
		input: settleInput,
		jsonSchema: {
			type: 'object',
			properties: {
				usage: {
					type: 'array',
					maxItems: 1_000,
					items: {
						type: 'object',
						properties: {
							instance: { type: 'string', minLength: 1, maxLength: 32 },
							used: { type: 'integer', minimum: 0 },
						},
						required: ['instance', 'used'],
						additionalProperties: false,
					},
				},
			},
			required: ['usage'],
			additionalProperties: false,
		} as unknown as JsonSchema,
		async handler(input, context) {
			// From the journaled counts, so a replay writes the same rows whatever its store holds.
			await deps.apps().storeQuota?.settle(workspace(), input.usage, kit.callNow(context));
			return kit.success({ settled: input.usage.length });
		},
	});

	const noticeInput = z.strictObject({
		instance: z.string().check(z.minLength(1), z.maxLength(32)),
		limit: z.enum([...LIMIT_KEY_ORDER] as [LimitKeyV1, ...LimitKeyV1[]]),
	});
	const notice = kit.define<typeof noticeInput, { noticed: number }>({
		name: 'limit-notice-push',
		description: "Boot's own: tell the owners of an app's first refusal by a limit in an hour",
		category: 'setting',
		mutation: true,
		executionTime: 'instant',
		input: noticeInput,
		jsonSchema: {
			type: 'object',
			properties: {
				instance: { type: 'string', minLength: 1, maxLength: 32 },
				limit: { type: 'string', enum: [...LIMIT_KEY_ORDER] },
			},
			required: ['instance', 'limit'],
			additionalProperties: false,
		} as unknown as JsonSchema,
		async handler(input, context) {
			return kit.success({ noticed: (await deps.notice?.(context, input)) ?? 0 });
		},
	});

	return {
		commands: [usage as unknown as ZodCommandDefinition],
		settleCommand: settle as unknown as ZodCommandDefinition,
		noticeCommand: notice as unknown as ZodCommandDefinition,
		async usageChanges(now) {
			const quota = deps.apps().storeQuota;
			if (!quota) return [];
			const changed: Array<{ instance: string; used: number }> = [];
			for (const instance of instances()) {
				const row = await quota.stored(instance, workspace());
				// Counted at most once a day per instance, and at once for one with no row (the trust review's 13): a row
				// another tab's write raced past is corrected within a day (14).
				const fresh =
					row?.countedAt !== undefined &&
					now - row.countedAt < USAGE_RECOUNT_MS &&
					now >= row.countedAt;
				if (fresh) continue;
				const counted = await quota.count(instance, workspace());
				// An instance with nothing stored and no row needs none.
				if (row === undefined && counted === 0) continue;
				changed.push({ instance, used: counted });
			}
			return changed;
		},
	};
}
