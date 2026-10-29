import { z } from 'zod';
import { TokenMetadataSchema, TokenValueSchema } from './token.js';

/**
 * Operation types for modifying tokens
 */
export const OperationTypeSchema = z.enum(['add', 'override', 'subtract', 'reset', 'copy']);

export type OperationType = z.infer<typeof OperationTypeSchema>;

/**
 * Add operation - create a new token
 */
export const AddOperationSchema = z.object({
	type: z.literal('add'),
	tokenId: z.string().min(1),
	value: TokenValueSchema,
	metadata: TokenMetadataSchema.optional(),
	reason: z.string().optional(),
});

export type AddOperation = z.infer<typeof AddOperationSchema>;

/**
 * Override operation - change an inherited token's value
 */
export const OverrideOperationSchema = z.object({
	type: z.literal('override'),
	tokenId: z.string().min(1),
	value: TokenValueSchema,
	reason: z.string().optional(),
});

export type OverrideOperation = z.infer<typeof OverrideOperationSchema>;

/**
 * Subtract operation - remove a token from this node
 */
export const SubtractOperationSchema = z.object({
	type: z.literal('subtract'),
	tokenId: z.string().min(1),
	reason: z.string().optional(),
});

export type SubtractOperation = z.infer<typeof SubtractOperationSchema>;

/**
 * Reset operation - restore to ancestor value
 */
export const ResetOperationSchema = z.object({
	type: z.literal('reset'),
	tokenId: z.string().min(1),
	toAncestor: z.string().optional(), // Specific ancestor, defaults to root
	reason: z.string().optional(),
});

export type ResetOperation = z.infer<typeof ResetOperationSchema>;

/**
 * Copy operation - copy from another node
 */
export const CopyOperationSchema = z.object({
	type: z.literal('copy'),
	tokenId: z.string().min(1), // Source token id on `fromNode`
	fromNode: z.string().min(1),
	asTokenId: z.string().optional(), // Target token id on this node; defaults to `tokenId`
	reason: z.string().optional(),
});

export type CopyOperation = z.infer<typeof CopyOperationSchema>;

/**
 * Union of all operation types
 */
export const OperationSchema = z.discriminatedUnion('type', [
	AddOperationSchema,
	OverrideOperationSchema,
	SubtractOperationSchema,
	ResetOperationSchema,
	CopyOperationSchema,
]);

export type Operation = z.infer<typeof OperationSchema>;

/**
 * Stored operation record (in database)
 */
export interface OperationRecord {
	id: string;
	nodeId: string;
	sequence: number;
	type: OperationType;
	tokenId: string;
	value: string | null; // JSON serialized
	metadata: string | null; // JSON serialized
	fromNode: string | null;
	asTokenId: string | null;
	toAncestor: string | null;
	reason: string | null;
	author: string | null;
	createdAt: string;
}

/**
 * Audit event types
 */
export const AuditEventTypeSchema = z.enum([
	'node_created',
	'node_updated',
	'node_deleted',
	'operation_added',
	'operation_removed',
	'token_created',
	'token_updated',
	'token_deleted',
	'constraint_set',
	'constraint_removed',
	'webhook_registered',
	'webhook_updated',
	'webhook_deleted',
	'specimen_map_updated',
]);

export type AuditEventType = z.infer<typeof AuditEventTypeSchema>;

/**
 * Audit event record (immutable)
 */
export interface AuditEvent {
	id: string;
	timestamp: string;
	eventType: AuditEventType;
	actor: string;
	targetNode: string;
	targetToken: string | null;
	oldValue: string | null; // JSON serialized
	newValue: string | null; // JSON serialized
	metadata: string | null; // JSON serialized
}

/**
 * Exact-match filter for `Database.getAuditEvents`. Every given field must
 * match; an `undefined` field is ignored. Results are newest first, with
 * same-millisecond events in reverse write order, on every store (#111).
 */
export interface AuditEventFilter {
	targetNode?: string;
	targetToken?: string;
	eventType?: AuditEventType;
	actor?: string;
}

/**
 * Filtered, ranged, paged query over the audit log. Every filter is optional
 * and they combine with AND; `eventTypes` and `nodeIds` match any listed value.
 * `since` and `until` are ISO timestamps: `since` is inclusive, `until`
 * exclusive.
 */
export interface AuditEventQuery {
	nodeIds?: string[];
	tokenId?: string;
	eventTypes?: AuditEventType[];
	actor?: string;
	since?: string;
	until?: string;
	/** Page size; the page is ordered newest first */
	limit: number;
	offset: number;
}

/** Matching events per UTC day (`YYYY-MM-DD`) and event type, across every page */
export interface AuditDayCount {
	date: string;
	eventType: AuditEventType;
	count: number;
}

export interface AuditEventPage {
	events: AuditEvent[];
	/** Every event that matches the filters, not only this page */
	total: number;
	days: AuditDayCount[];
}
