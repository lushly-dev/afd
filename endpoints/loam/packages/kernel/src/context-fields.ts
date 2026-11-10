/**
 * @fileoverview The declared context fields on both registries (phase 1 specification, 7.6), with
 * `scope` (phase 2 specification, 3.2). The kernel alone sets them, and each holds an id, so the journal
 * keeps them all.
 */

import type { Actor } from '@lushly-dev/afd-core';
import type { DirectRegistryOptions } from '@lushly-dev/afd-server/direct';
import * as z from 'zod/mini';
import { id, SCOPE_FIELD } from './scope/field.js';
import type { ScopeV1 } from './scope/records.js';

export const KERNEL_CONTEXT_FIELDS: NonNullable<DirectRegistryOptions['contextFields']> =
	Object.freeze([
		{ name: 'caller', meta: 'dev.loam/caller', schema: id, journal: true },
		{ name: 'app', meta: 'dev.loam/app', schema: id, journal: true },
		{ name: 'instance', meta: 'dev.loam/instance', schema: id, journal: true },
		{ name: 'replay', meta: 'dev.loam/replay', schema: z.literal('recorded'), journal: true },
		{ name: 'parent', meta: 'dev.loam/parent', schema: id, journal: true },
		SCOPE_FIELD,
	]);

/** What the kernel sets for a call. */
export interface KernelCallFields {
	/** The calling instance, when an app called. Absent for a person or agent. */
	caller?: string;
	/** The outer call's trace ID, on a nested call. */
	parent?: string;
	/** The requested scope: a surface's, or a nested call's outer effective scope (phase 2 specification, 3.2). */
	scope?: ScopeV1;
	/**
	 * The outer call's actor, copied onto a port's, a surface port's or a nested call (phase 3 specification,
	 * 3.1): `execute` puts it on the call's context before the chain, so the call is decided for the person,
	 * and the agent, the outer call was for. Absent: the session's person, or the agent interface's agent.
	 */
	actor?: Actor;
}

/** The fields a handler reads back from its command context. */
export interface KernelFieldContext extends KernelCallFields {
	app?: string;
	instance?: string;
	replay?: 'recorded';
}
