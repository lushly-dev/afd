/**
 * @fileoverview Pure type contract for the runtime command kit passed to stage-B domain factories
 * (`late/command-kit.ts` constructs the frozen runtime object). Kept in `scope/` with zero runtime
 * code so every domain (`documents`, `identity`, `settings`, `copilot`, `server`) can type its
 * `kit` parameter without importing from `late/`.
 */

import type { CommandContext } from '@lushly-dev/afd-core';
import type { defineCommandWithSchema, success } from '@lushly-dev/afd-server/define';
import type {
	array,
	boolean,
	enum as choice,
	int,
	maximum,
	maxLength,
	minimum,
	minLength,
	nullable,
	number,
	optional,
	strictObject,
	string,
	union,
	unknown,
	xor,
} from 'zod/mini';
import type { kernelFailure } from '../errors.js';
import type { ScopeV1 } from '../types.js';
import type { personOf } from './access.js';
import type { archivedRefusal, setMain } from './main-state.js';
import type { projectNotFound } from './middleware.js';
import type { ScopeRuntime } from './runtime.js';
import type { scopeKeyOf, storeRecordId } from './store-id.js';

export interface DocumentKit {
	readonly define: typeof defineCommandWithSchema;
	readonly success: typeof success;
	readonly kernelFailure: typeof kernelFailure;
	readonly personOf: typeof personOf;
	readonly projectNotFound: typeof projectNotFound;
	readonly archivedRefusal: typeof archivedRefusal;
	readonly setMain: typeof setMain;
	readonly marked: (context: object) => boolean;
	readonly documentContentKey: (id: string) => string;
	readonly scopeKeyOf: typeof scopeKeyOf;
	readonly storeRecordId: typeof storeRecordId;
	readonly callNow: (context: CommandContext, clock?: { now(): number }) => number;
	readonly sameScope: (a: ScopeV1, b: ScopeV1) => boolean;
	readonly table: string;
	readonly maxBytes: number;
	readonly markOversized: (scope: ScopeRuntime, call: CommandContext) => void;
	readonly contentBytes: (key: string, value: unknown) => number;
	readonly z: Readonly<{
		array: typeof array;
		boolean: typeof boolean;
		enum: typeof choice;
		int: typeof int;
		maximum: typeof maximum;
		maxLength: typeof maxLength;
		minimum: typeof minimum;
		minLength: typeof minLength;
		nullable: typeof nullable;
		number: typeof number;
		optional: typeof optional;
		strictObject: typeof strictObject;
		string: typeof string;
		union: typeof union;
		unknown: typeof unknown;
		xor: typeof xor;
	}>;
}
