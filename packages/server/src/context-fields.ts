/**
 * @fileoverview Declared context fields (`spec/context-fields.md`): named, schema-validated request
 * values a host declares, which reach the command context on every surface and, when declared
 * `journal: true`, the journal.
 */

import type { CommandContext, CommandResult } from '@lushly-dev/afd-core';
import { failure } from '@lushly-dev/afd-core';
import type { z } from 'zod';

/** A request value a host declares: where it lands in the context and how it is validated. */
export interface ContextField<T = unknown> {
	/** The command-context key the value lands under. Not a key AFD uses itself. */
	name: string;
	/** The MCP `_meta` key a caller sends the value in: a reverse-DNS prefix, `dev.example/scope`. */
	meta: string;
	/** Validates the value; its output is what the handler sees. */
	schema: z.ZodType<T>;
	/** Record the value in the journal. Default `false`: only for a field that never holds a secret. */
	journal?: boolean;
	/** Fail a call that has no value for this field. Default `false`. */
	required?: boolean;
}

/** Context keys AFD or its packages set, which a declared field cannot take. */
const RESERVED_NAMES = new Set([
	'actor',
	'approval',
	'auth',
	'clock',
	'credentials',
	'interface',
	'random',
	'session',
	'signal',
	'source',
	'timeout',
	'traceId',
]);

const LABEL = '[A-Za-z](?:[A-Za-z0-9-]*[A-Za-z0-9])?';
/** A reverse-DNS prefix of two or more labels, a slash, then the key's name. */
const META_KEY = new RegExp(
	`^${LABEL}(?:\\.${LABEL})+/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$`
);

/**
 * On a context the engine validated: the names of the declared fields marked `journal: true`, for
 * the journal middleware. A symbol, so it never shows up among the context's keys.
 */
export const JOURNALED_CONTEXT_FIELDS: unique symbol = Symbol('afd.journaledContextFields');

/**
 * Check declarations when a server or registry is created.
 *
 * @throws TypeError naming the field for a reserved or repeated name, a `meta` key without a
 * reverse-DNS prefix or with a reserved one, a repeated `meta` key, or a missing schema
 */
export function checkContextFields(
	fields: readonly ContextField[] | undefined
): readonly ContextField[] {
	if (fields === undefined) return [];
	if (!Array.isArray(fields)) throw new TypeError('contextFields must be an array');
	const names = new Set<string>();
	const metaKeys = new Set<string>();
	for (const field of fields) {
		const { name, meta, schema } = field ?? ({} as ContextField);
		if (typeof name !== 'string' || name.length === 0) {
			throw new TypeError('A context field needs a non-empty name');
		}
		if (RESERVED_NAMES.has(name)) {
			throw new TypeError(
				`Context field '${name}' uses a name AFD sets itself; choose another name`
			);
		}
		if (names.has(name)) throw new TypeError(`Context field '${name}' is declared twice`);
		if (typeof meta !== 'string' || !META_KEY.test(meta)) {
			throw new TypeError(
				`Context field '${name}' needs a meta key with a reverse-DNS prefix, such as 'dev.example/${name}'`
			);
		}
		const labels = meta.slice(0, meta.indexOf('/')).toLowerCase().split('.');
		if (meta.toLowerCase().startsWith('dev.afd/') || labels.some(isMcpLabel)) {
			throw new TypeError(
				`Context field '${name}' uses the reserved meta prefix of '${meta}'; use your own domain`
			);
		}
		if (metaKeys.has(meta)) throw new TypeError(`Meta key '${meta}' is declared twice`);
		if (!schema || typeof (schema as { safeParse?: unknown }).safeParse !== 'function') {
			throw new TypeError(`Context field '${name}' needs a Zod schema`);
		}
		names.add(name);
		metaKeys.add(meta);
	}
	return fields;
}

function isMcpLabel(label: string): boolean {
	return label === 'mcp' || label === 'modelcontextprotocol';
}

/**
 * Validate a call's declared fields on its context, in place: each value is replaced by its
 * schema's output, and the journaled names are marked for the journal. An absent or `null` value
 * is no value. A required field is not enforced for AFD's own `afd-*` commands, so a client can
 * discover the fields before it sends them.
 *
 * @returns a `VALIDATION_ERROR` result for an invalid value or a missing required one, else
 * `undefined`
 */
export function applyContextFields(
	fields: readonly ContextField[],
	context: CommandContext,
	commandName: string
): CommandResult | undefined {
	if (fields.length === 0) return undefined;
	const values = context as Record<string, unknown>;
	const ownCommand = commandName.startsWith('afd-');
	for (const field of fields) {
		const value = values[field.name];
		if (value === undefined || value === null) {
			if (field.required && !ownCommand) {
				return fieldFailure(field, `Context field '${field.name}' is required`, [
					{ path: '', message: 'Required' },
				]);
			}
			continue;
		}
		let parsed: ReturnType<z.ZodType['safeParse']>;
		try {
			parsed = field.schema.safeParse(value);
		} catch (error) {
			return fieldFailure(field, `Context field '${field.name}' is not valid`, [
				{ path: '', message: error instanceof Error ? error.message : String(error) },
			]);
		}
		if (!parsed.success) {
			return fieldFailure(
				field,
				`Context field '${field.name}' is not valid`,
				parsed.error.issues.map((issue) => ({
					path: issue.path.map(String).join('.'),
					message: issue.message,
				}))
			);
		}
		values[field.name] = parsed.data;
	}
	(context as Record<symbol, unknown>)[JOURNALED_CONTEXT_FIELDS] = fields
		.filter((field) => field.journal === true)
		.map((field) => field.name);
	return undefined;
}

function fieldFailure(
	field: ContextField,
	message: string,
	errors: Array<{ path: string; message: string }>
): CommandResult {
	return failure({
		code: 'VALIDATION_ERROR',
		message,
		suggestion: `Send '${field.name}' in _meta["${field.meta}"] as its schema describes (server/discover lists it under _meta["dev.afd/context-fields"])${field.required ? '; it is required' : ', or leave it out'}`,
		details: { field: field.name, meta: field.meta, errors },
	});
}
