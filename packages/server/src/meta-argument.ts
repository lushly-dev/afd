/**
 * @fileoverview The `meta` argument of the meta-tools (`spec/command-metadata.md`, "Decisions on
 * the tool surface (#466)"; `spec/context-fields.md`, "Clients that cannot set `_meta`").
 *
 * `afd-call`, `afd-batch`, `afd-pipe`, `afd-discover` and `afd-detail` take an optional `meta`
 * object for clients that cannot set `_meta`. Its keys are `dev.afd/context` and the declared
 * context fields' `_meta` keys, and each surface applies them as if the request had sent them in
 * `_meta`, before it reads `_meta`. Other keys are dropped, as undeclared `_meta` keys are, and
 * `null` (for `meta` or a value) is no value. A key
 * sent both ways must agree, or the call fails with `VALIDATION_ERROR`.
 */

import type { CommandContext, CommandError } from '@lushly-dev/afd-core';
import { AFD_META_TOOL_NAMES } from '@lushly-dev/afd-core';
import type { ContextField } from './context-fields.js';

const META_TOOLS = new Set<string>(AFD_META_TOOL_NAMES);

/**
 * `AFD_CONTEXT_META_KEY` of `bootstrap/afd-context.ts`, spelled here so the direct registry can
 * use this module without loading the bootstrap tools.
 */
export const CONTEXT_META_KEY = 'dev.afd/context';

/** The keys a `meta` argument may carry on a server with these declared fields. */
export function metaArgumentKeys(fields: readonly ContextField[] | undefined): ReadonlySet<string> {
	return new Set([CONTEXT_META_KEY, ...(fields ?? []).map((field) => field.meta)]);
}

/**
 * The `_meta` values an in-process call stands for: the `activeContext` option, and the declared
 * fields' values on the call's context, keyed by `_meta` key.
 */
export function inProcessMeta(
	fields: readonly ContextField[],
	context: CommandContext,
	activeContext: string | undefined
): Record<string, unknown> {
	const meta: Record<string, unknown> = {};
	if (activeContext !== undefined) meta[CONTEXT_META_KEY] = activeContext;
	for (const field of fields) {
		const value = (context as Record<string, unknown>)[field.name];
		if (value !== undefined && value !== null) meta[field.meta] = value;
	}
	return meta;
}

/** A meta-tool call with its `meta` argument moved into `meta`, or the error that refuses it. */
export type LiftedMetaArgument =
	| { ok: true; args: unknown; meta: unknown }
	| { ok: false; error: CommandError };

/**
 * Move a meta-tool's `meta` argument into the request's `_meta` values. Calls to other tools, and
 * meta-tool calls without `meta`, come back unchanged.
 *
 * @param meta - the request's `_meta` values, or the values standing for them in process
 */
export function liftMetaArgument(
	toolName: string,
	args: unknown,
	meta: unknown,
	keys: ReadonlySet<string>
): LiftedMetaArgument {
	if (!META_TOOLS.has(toolName) || !isRecord(args) || !('meta' in args)) {
		return { ok: true, args, meta };
	}
	const { meta: argument, ...rest } = args;
	if (argument === undefined || argument === null) return { ok: true, args: rest, meta };
	if (!isRecord(argument)) {
		return {
			ok: false,
			error: {
				code: 'VALIDATION_ERROR',
				message: `The meta argument of ${toolName} must be an object`,
				suggestion: `Send meta as an object whose keys are _meta keys: ${[...keys].join(', ')}`,
				details: { argument: 'meta' },
			},
		};
	}
	const sent = isRecord(meta) ? meta : {};
	const merged: Record<string, unknown> = { ...sent };
	for (const [key, value] of Object.entries(argument)) {
		if (!keys.has(key) || value === undefined || value === null) continue;
		const other = sent[key];
		if (other !== undefined && other !== null && !sameJson(other, value)) {
			return {
				ok: false,
				error: {
					code: 'VALIDATION_ERROR',
					message: `_meta["${key}"] and the meta argument of ${toolName} disagree`,
					suggestion: `Send ${key} in _meta or in the meta argument, or the same value in both`,
					details: { meta: key },
				},
			};
		}
		merged[key] = value;
	}
	return { ok: true, args: rest, meta: merged };
}

/** Whether two JSON values are equal, ignoring object key order. */
function sameJson(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (Array.isArray(a) || Array.isArray(b)) {
		return (
			Array.isArray(a) &&
			Array.isArray(b) &&
			a.length === b.length &&
			a.every((item, index) => sameJson(item, b[index]))
		);
	}
	if (!isRecord(a) || !isRecord(b)) return false;
	const keys = Object.keys(a).filter((key) => a[key] !== undefined);
	return (
		keys.length === Object.keys(b).filter((key) => b[key] !== undefined).length &&
		keys.every((key) => sameJson(a[key], b[key]))
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}
