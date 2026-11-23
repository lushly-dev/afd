/**
 * @fileoverview `VioletTreeContentV1` stored document shape, validation, and content digest (spec §4.1, §5.2).
 */
import type { AuditEvent, Constraint, Node, OperationRecord } from '@lushly-dev/violet-core/types';

export interface TreeFile {
	name: string;
	content: string;
}

export interface VioletTreeSeedV1 {
	files: TreeFile[];
	constraints?: Record<string, Constraint[]>;
}

export interface VioletTreeRecordsV1 {
	nodes: Node[];
	operations: OperationRecord[];
	constraints: Record<string, Constraint[]>;
	audit: AuditEvent[];
}

export interface VioletTreeContentV1 {
	format: 'violet-tree';
	version: 1;
	rev: number;
	syncedRev: number;
	seed?: VioletTreeSeedV1;
	records?: VioletTreeRecordsV1;
}

export const EMPTY_CONTENT: VioletTreeContentV1 = {
	format: 'violet-tree',
	version: 1,
	rev: 0,
	syncedRev: 0,
	seed: { files: [] },
};

export type ContentReadResult =
	| { ok: true; content: VioletTreeContentV1; json: string }
	| {
			ok: false;
			code: 'DOCUMENT_CONTENT_VERSION_NEWER' | 'VIOLET_CONTENT_INVALID';
			message: string;
			suggestion: string;
	  };

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonNegativeInt = (value: unknown): value is number =>
	typeof value === 'number' && Number.isInteger(value) && value >= 0;

function isValidSeed(value: unknown): value is VioletTreeSeedV1 {
	if (!isRecord(value) || !Array.isArray(value.files)) return false;
	for (const item of value.files) {
		if (!isRecord(item) || typeof item.name !== 'string' || typeof item.content !== 'string') {
			return false;
		}
	}
	if (value.constraints !== undefined && !isRecord(value.constraints)) return false;
	return true;
}

const isNonEmptyString = (value: unknown): value is string =>
	typeof value === 'string' && value.length > 0;

function isValidNodeRecord(value: unknown): boolean {
	if (!isRecord(value)) return false;
	return (
		isNonEmptyString(value.id) &&
		isNonEmptyString(value.type) &&
		(value.parentId === null || value.parentId === undefined || isNonEmptyString(value.parentId)) &&
		(value.deletedAt === null ||
			value.deletedAt === undefined ||
			typeof value.deletedAt === 'string')
	);
}

function isValidOperationRecord(value: unknown): boolean {
	if (!isRecord(value)) return false;
	return (
		isNonEmptyString(value.id) &&
		isNonEmptyString(value.nodeId) &&
		isNonNegativeInt(value.sequence) &&
		isNonEmptyString(value.type) &&
		isNonEmptyString(value.tokenId)
	);
}

function isValidConstraintRecord(value: unknown): boolean {
	if (!isRecord(value)) return false;
	return (
		isNonEmptyString(value.id) &&
		isNonEmptyString(value.name) &&
		isNonEmptyString(value.applyTo) &&
		isRecord(value.config)
	);
}

function isValidAuditRecord(value: unknown): boolean {
	if (!isRecord(value)) return false;
	return (
		isNonEmptyString(value.id) &&
		isNonEmptyString(value.timestamp) &&
		isNonEmptyString(value.eventType) &&
		typeof value.actor === 'string' &&
		isNonEmptyString(value.targetNode)
	);
}

function isValidRecords(value: unknown): value is VioletTreeRecordsV1 {
	if (!isRecord(value)) return false;
	if (
		!Array.isArray(value.nodes) ||
		!Array.isArray(value.operations) ||
		!isRecord(value.constraints) ||
		!Array.isArray(value.audit)
	) {
		return false;
	}
	if (!value.nodes.every(isValidNodeRecord)) return false;
	if (!value.operations.every(isValidOperationRecord)) return false;
	if (!value.audit.every(isValidAuditRecord)) return false;
	for (const list of Object.values(value.constraints)) {
		if (!Array.isArray(list) || !list.every(isValidConstraintRecord)) return false;
	}
	return true;
}

/** Validate a stored value from `store.get(documentContentKey(document))` (spec §4.1). */
export function parseStoredContent(raw: unknown): ContentReadResult {
	if (raw === undefined || raw === null) {
		return { ok: true, content: EMPTY_CONTENT, json: JSON.stringify(EMPTY_CONTENT) };
	}
	if (!isRecord(raw) || raw.format !== 'violet-tree') {
		return {
			ok: false,
			code: 'VIOLET_CONTENT_INVALID',
			message: 'Stored violet-tree document content does not match schema version 1',
			suggestion: 'Import the tree files again with violet-tree-import',
		};
	}
	if (typeof raw.version === 'number' && raw.version > 1) {
		return {
			ok: false,
			code: 'DOCUMENT_CONTENT_VERSION_NEWER',
			message: `Document content version ${raw.version} is newer than supported version 1`,
			suggestion: 'Update the Violet plugin before opening this document',
		};
	}
	const hasSeed = raw.seed !== undefined;
	const hasRecords = raw.records !== undefined;
	if (
		raw.version !== 1 ||
		!isNonNegativeInt(raw.rev) ||
		!isNonNegativeInt(raw.syncedRev) ||
		raw.syncedRev > raw.rev ||
		hasSeed === hasRecords ||
		(hasSeed && !isValidSeed(raw.seed)) ||
		(hasRecords && !isValidRecords(raw.records))
	) {
		return {
			ok: false,
			code: 'VIOLET_CONTENT_INVALID',
			message: 'Stored violet-tree document content is invalid or incomplete',
			suggestion: 'Import the tree files again with violet-tree-import',
		};
	}
	const content = raw as unknown as VioletTreeContentV1;
	return { ok: true, content, json: JSON.stringify(content) };
}

/** SHA-256 hex digest of stored content JSON (`crypto.subtle.digest` in Node and browsers, spec §5.2). */
export async function contentDigest(json: string): Promise<string> {
	const bytes = new TextEncoder().encode(json);
	const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Deterministic PRNG in [0, 1) seeded by a string, used only for scratch seed builds (spec §5.2). */
export function seededRandom(seed: string): () => number {
	let state = 2166136261;
	for (let i = 0; i < seed.length; i++) {
		state ^= seed.charCodeAt(i);
		state = Math.imul(state, 16777619);
	}
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
