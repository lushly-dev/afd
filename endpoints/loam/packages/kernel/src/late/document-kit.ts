/**
 * @fileoverview What the `late-documents` and `late-editor` chunks use at run time, handed to them by `late`
 * (phase 2 specification, 2.4). `documents.ts` and `editor-commands.ts` import types alone: a module first paint or `late` also imports,
 * imported statically by that chunk too, would be parted by the bundler into a chunk of its own, and first
 * paint would load more chunks, each an import line and its gzip overhead (measured at 255 bytes and 653
 * gzip on step 9's first build). So every shared function reaches it here.
 */

import { defineCommandWithSchema, success } from '@lushly-dev/afd-server/define';
import {
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
	unknown,
} from 'zod/mini';
import { kernelFailure } from '../errors.js';
import { actorKey } from '../scope/access.js';
import { projectNotFound } from '../scope/middleware.js';
import { scopeKeyOf, storeRecordId } from '../scope/store-id.js';
import {
	callNow,
	DOCUMENT_INPUT_MAX_BYTES,
	DOCUMENT_TABLE,
	documentContentKey,
	markOversized,
	sameScope,
} from './document-types.js';
import { archivedRefusal, setMain } from './main-state.js';

export const DOCUMENT_KIT = Object.freeze({
	define: defineCommandWithSchema,
	success,
	kernelFailure,
	actorKey,
	projectNotFound,
	archivedRefusal,
	setMain,
	documentContentKey,
	scopeKeyOf,
	storeRecordId,
	callNow,
	sameScope,
	table: DOCUMENT_TABLE,
	maxBytes: DOCUMENT_INPUT_MAX_BYTES,
	markOversized,
	z: Object.freeze({
		array,
		boolean,
		enum: choice,
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
		unknown,
	}),
});

export type DocumentKit = typeof DOCUMENT_KIT;
