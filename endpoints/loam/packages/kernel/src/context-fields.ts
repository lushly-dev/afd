/**
 * @fileoverview The declared context fields on both registries (phase 1 specification, 7.6), with
 * `scope` (phase 2 specification, 3.2), `persona` (phase 3 specification, 6.2) and `migration` (phase 4 specification,
 * 3.6: the literal `true`, on the kernel's own move of an old appearance record). The kernel alone sets them, and none
 * holds a secret, so the journal keeps them all.
 */

import type { Actor } from '@lushly-dev/afd-core';
import type { DirectRegistryOptions } from '@lushly-dev/afd-server/direct';
import * as z from 'zod/mini';
import { id, SCOPE_FIELD } from './scope/field.js';
import type { KernelPrincipalV1 } from './scope/principal.js';
import type { ScopeV1 } from './scope/records.js';

export const KERNEL_CONTEXT_FIELDS: NonNullable<DirectRegistryOptions['contextFields']> =
	Object.freeze([
		{ name: 'caller', meta: 'dev.loam/caller', schema: id, journal: true },
		{ name: 'app', meta: 'dev.loam/app', schema: id, journal: true },
		{ name: 'instance', meta: 'dev.loam/instance', schema: id, journal: true },
		{ name: 'replay', meta: 'dev.loam/replay', schema: z.literal('recorded'), journal: true },
		{ name: 'parent', meta: 'dev.loam/parent', schema: id, journal: true },
		SCOPE_FIELD,
		// The active persona's id, when not `default` (phase 3 specification, 6.2; D89): journaled, set by the kernel
		// alone, never declared to a server, never given to an app, and never read by a decision.
		{ name: 'persona', meta: 'dev.loam/persona', schema: id, journal: true },
		// Stage B's own move of an old appearance record (phase 4 specification, 3.6): set by the kernel alone, on that
		// call alone, and journaled, so a replay of its entry carries it and a person's forged `migrated` never does.
		{ name: 'migration', meta: 'dev.loam/migration', schema: z.literal(true), journal: true },
		// A call the kernel's input bound refused, whose input the journal keeps as its document's id alone (documents
		// specification, 4.4): set by the kernel alone, so a replay compares such an entry by that id and the bound, and
		// every other entry by its whole input (#859).
		{ name: 'oversized', meta: 'dev.loam/oversized', schema: z.literal(true), journal: true },
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
	/**
	 * The request's principal on a principal-gated kernel (phase 3 specification, 9.5): never declared to a server, never
	 * journaled (the journal keeps `actor`) and never on an app handler's context. `execute` fills a nested call's from
	 * its copied actor alone, never from this field, so every path a call can take under a request carries it; the gate
	 * trusts only one its kernel minted, and stamps the actor from it.
	 */
	principal?: KernelPrincipalV1;
	/** Stage B's own move of an old appearance record (phase 4 specification, 3.6): the kernel's alone. */
	migration?: true;
}

/** The fields a handler reads back from its command context. */
export interface KernelFieldContext extends KernelCallFields {
	app?: string;
	instance?: string;
	replay?: 'recorded';
	/** The kernel's input bound refused the call, and the journal keeps its input as its document's id alone. */
	oversized?: true;
}
