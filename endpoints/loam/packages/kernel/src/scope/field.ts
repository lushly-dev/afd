/**
 * @fileoverview Scope as a declared context field (phase 2 specification, 3.1 to 3.3; D71): `scope`,
 * `dev.loam/scope`, journaled, holding ids alone.
 */

import type { DirectRegistryOptions } from '@lushly-dev/afd-server/direct';
import * as z from 'zod/mini';

/** A declared context field, as the direct registry and `createMcpHandler` take one. */
export type ContextField = NonNullable<DirectRegistryOptions['contextFields']>[number];

/** An id: 1 to 128 characters. The kernel's other context fields share it. */
export const id = z.string().check(z.minLength(1), z.maxLength(128));

/** `ScopeV1`'s schema: a strict object with `workspace` and an optional `project`. */
export const SCOPE_V1 = z.strictObject({ workspace: id, project: z.optional(id) });

export const SCOPE_FIELD: ContextField = {
	name: 'scope',
	meta: 'dev.loam/scope',
	schema: SCOPE_V1,
	journal: true,
};

/**
 * The fields declared to a server: `scope` alone. The others are set by trusted code, and declaring them
 * over MCP would let a caller claim them (phase 2 specification, 3.3).
 */
export const MCP_CONTEXT_FIELDS: readonly ContextField[] = Object.freeze([SCOPE_FIELD]);
