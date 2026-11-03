/**
 * @fileoverview The declared context fields on both registries (phase 1 specification, 7.6). The
 * kernel alone sets them, and each holds an id, so the journal keeps them all.
 */

import type { DirectRegistryOptions } from '@lushly-dev/afd-server/direct';
import * as z from 'zod/mini';

const id = z.string().check(z.minLength(1), z.maxLength(128));

export const KERNEL_CONTEXT_FIELDS: NonNullable<DirectRegistryOptions['contextFields']> =
	Object.freeze([
		{ name: 'caller', meta: 'dev.loam/caller', schema: id, journal: true },
		{ name: 'app', meta: 'dev.loam/app', schema: id, journal: true },
		{ name: 'instance', meta: 'dev.loam/instance', schema: id, journal: true },
		{ name: 'replay', meta: 'dev.loam/replay', schema: z.literal('recorded'), journal: true },
		{ name: 'parent', meta: 'dev.loam/parent', schema: id, journal: true },
	]);

/** What the kernel sets for a call. */
export interface KernelCallFields {
	/** The calling instance, when an app called. Absent for a person or agent. */
	caller?: string;
	/** The outer call's trace ID, on a nested call. */
	parent?: string;
}

/** The fields a handler reads back from its command context. */
export interface KernelFieldContext extends KernelCallFields {
	app?: string;
	instance?: string;
	replay?: 'recorded';
}
