/**
 * @fileoverview Attachments on `copilot-message-send` (phase 5 specification, 3.5, 5.1, 5.3; #1508):
 * strict `ResourceLinkV1` validation and reading each link as the calling person under `decideAccess`,
 * bounded in size so nothing oversized crosses the model port. Every attachment is given to the model
 * inside a `<loam-content>` block from its source and taints the session before the turn starts.
 *
 * In the `late-copilot` chunk; it imports types alone.
 */

import type { CommandContext, CommandResult } from '@lushly-dev/afd-core';
import type { JsonSchema } from '@lushly-dev/afd-server/define';
import type { ResourceLinkV1 } from '@lushly-dev/loam-sdk';
import type { LoamKernelErrorCode } from '../errors.js';
import type { DocumentKit } from '../scope/command-kit.js';
import type { AttachedContentV1 } from './types.js';

/** 3.5: at most 10 attached links per message. */
export const ATTACHMENT_MAX_COUNT = 10;
/** Same bound as notification links (phase 4's 10.1): 1 KiB of JSON for a document anchor. */
export const ATTACHMENT_ANCHOR_BYTES = 1024;
/** Same bound as notification links (phase 4's 10.1): 1024 characters for an app route. */
export const ATTACHMENT_ROUTE_MAX = 1024;
/** Bound on one resolved attachment's JSON payload given to the model (matching step 5's 64 KiB preview cap). */
export const ATTACHMENT_MAX_BYTES = 64 * 1024;
/** Per-link deadline for reading one attachment, keeping reads bounded inside `MESSAGE_WAIT_MS`. */
export const ATTACHMENT_READ_DEADLINE_MS = 10_000;

export type AttachmentReader = (
	link: ResourceLinkV1,
	context?: CommandContext
) => Promise<AttachedContentV1 | CommandResult<never>>;

type Fail = (
	code: LoamKernelErrorCode,
	message: string,
	suggestion: string,
	retryable?: boolean
) => CommandResult<never>;

const textJson = (maxLength: number): JsonSchema => ({ type: 'string', minLength: 1, maxLength });
const scopeJson: JsonSchema = {
	type: 'object',
	properties: { workspace: textJson(128), project: textJson(128) },
	required: ['workspace'],
	additionalProperties: false,
};

/** 3.5's `attach?: ResourceLinkV1[]` JSON Schema (0 to 10 items), matching `notifications.ts`'s `linkJson`. */
export const ATTACH_JSON: JsonSchema = {
	type: 'array',
	maxItems: ATTACHMENT_MAX_COUNT,
	items: {
		anyOf: [
			{
				type: 'object',
				properties: {
					kind: { type: 'string', enum: ['document'] },
					document: textJson(128),
					scope: scopeJson,
					anchor: {},
				},
				required: ['kind', 'document', 'scope'],
				additionalProperties: false,
			},
			{
				type: 'object',
				properties: {
					kind: { type: 'string', enum: ['app'] },
					instance: textJson(64),
					route: textJson(ATTACHMENT_ROUTE_MAX),
					scope: scopeJson,
				},
				required: ['kind', 'instance', 'scope'],
				additionalProperties: false,
			},
		],
	} as unknown as JsonSchema,
};

/** Strict Zod Mini schema for `attach?: ResourceLinkV1[]`, using only `DocumentKit['z']`. */
export function attachSchema(z: DocumentKit['z']) {
	const scope = z.strictObject({
		workspace: z.string().check(z.minLength(1), z.maxLength(128)),
		project: z.optional(z.string().check(z.minLength(1), z.maxLength(128))),
	});
	const link = z.union([
		z.strictObject({
			kind: z.enum(['document']),
			document: z.string().check(z.minLength(1), z.maxLength(128)),
			scope,
			anchor: z.optional(z.unknown()),
		}),
		z.strictObject({
			kind: z.enum(['app']),
			instance: z.string().check(z.minLength(1), z.maxLength(64)),
			route: z.optional(z.string().check(z.minLength(1), z.maxLength(ATTACHMENT_ROUTE_MAX))),
			scope,
		}),
	]);
	return z.optional(z.array(link).check(z.maxLength(ATTACHMENT_MAX_COUNT)));
}

const isRefusal = (value: unknown): value is CommandResult<never> =>
	typeof value === 'object' && value !== null && 'success' in value;

/** Serialize plain JSON once so byte checks and clones come from the exact same snapshot. */
function serializeJson(value: unknown): { text: string; bytes: number } | undefined {
	if (value === undefined) return undefined;
	try {
		const text = JSON.stringify(value);
		if (text === undefined) return undefined;
		return { text, bytes: new TextEncoder().encode(text).length };
	} catch {
		return undefined;
	}
}

/**
 * Validate `attach` links beyond structural schema checks: workspace match, safe route segments
 * (no empty, `.` or `..`), and plain JSON anchor within {@link ATTACHMENT_ANCHOR_BYTES}.
 * Returns cloned `ResourceLinkV1[]` or a `VALIDATION_ERROR` refusal.
 */
export function validateAttachments(
	links: readonly ResourceLinkV1[] | undefined,
	workspace: string,
	fail: Fail
): ResourceLinkV1[] | CommandResult<never> {
	if (!links || links.length === 0) return [];
	const out: ResourceLinkV1[] = [];
	for (const link of links) {
		if (link.scope.workspace !== workspace) {
			return fail(
				'VALIDATION_ERROR',
				'A link leads within this workspace',
				'Link to a resource in this workspace, by its id and its scope'
			);
		}
		if (link.kind === 'app') {
			if (link.route?.split('/').some((part) => part === '' || part === '.' || part === '..')) {
				return fail(
					'VALIDATION_ERROR',
					"A link's route has no empty, '.' or '..' segment",
					'Link to a resource in this workspace, by its id and its scope'
				);
			}
			out.push({
				kind: 'app',
				instance: link.instance,
				...(link.route !== undefined ? { route: link.route } : {}),
				scope: {
					workspace: link.scope.workspace,
					...(link.scope.project !== undefined ? { project: link.scope.project } : {}),
				},
			});
			continue;
		}
		let anchor: unknown;
		if (link.anchor !== undefined) {
			const serialized = serializeJson(link.anchor);
			if (!serialized) {
				return fail(
					'VALIDATION_ERROR',
					"A link's anchor must be plain JSON",
					'Pass plain JSON in anchor, or omit it'
				);
			}
			if (serialized.bytes > ATTACHMENT_ANCHOR_BYTES) {
				return fail(
					'VALIDATION_ERROR',
					`A link's anchor is at most ${ATTACHMENT_ANCHOR_BYTES} bytes`,
					'Shorten the anchor, or omit it'
				);
			}
			anchor = JSON.parse(serialized.text);
		}
		out.push({
			kind: 'document',
			document: link.document,
			scope: {
				workspace: link.scope.workspace,
				...(link.scope.project !== undefined ? { project: link.scope.project } : {}),
			},
			...(anchor !== undefined ? { anchor } : {}),
		});
	}
	return out;
}

/** Validate and snapshot one read result in a single JSON serialization pass. */
function snapshotAttachment(
	item: AttachedContentV1 | CommandResult<never>,
	fail: Fail
): AttachedContentV1 | CommandResult<never> {
	if (isRefusal(item)) return item;
	if (item.content === undefined) {
		return fail(
			'HANDLER_RESULT_INVALID',
			'The attached resource returned no content',
			'Send the text alone, or check the app that owns this resource'
		);
	}
	const serialized = serializeJson({ link: item.link, content: item.content });
	if (!serialized) {
		return fail(
			'HANDLER_RESULT_INVALID',
			'The attached resource could not be serialized as JSON',
			'Send the text alone, or check the app that owns this resource'
		);
	}
	if (serialized.bytes > ATTACHMENT_MAX_BYTES) {
		return fail(
			'INPUT_TOO_LARGE',
			`The attached resource is over ${ATTACHMENT_MAX_BYTES} bytes`,
			'Attach a smaller resource, or ask the copilot to read only the part you need'
		);
	}
	const parsed = JSON.parse(serialized.text) as { link: ResourceLinkV1; content: unknown };
	return { source: item.source, link: parsed.link, content: parsed.content };
}

/** Read one link bounded by {@link ATTACHMENT_READ_DEADLINE_MS}. */
async function readBounded(
	link: ResourceLinkV1,
	context: CommandContext | undefined,
	reader: AttachmentReader,
	fail: Fail,
	deadlineMs = ATTACHMENT_READ_DEADLINE_MS
): Promise<AttachedContentV1 | CommandResult<never>> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const raw = await Promise.race([
			reader(link, context),
			new Promise<CommandResult<never>>((done) => {
				timer = setTimeout(
					() =>
						done(
							fail(
								'HANDLER_TIMEOUT',
								'Reading the attached resource timed out',
								'Retry the message, or send it without this attachment',
								true
							)
						),
					deadlineMs
				);
			}),
		]);
		return snapshotAttachment(raw, fail);
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Read every validated attachment link in parallel as the calling person, checking results in input
 * order and enforcing {@link ATTACHMENT_MAX_BYTES} and {@link ATTACHMENT_READ_DEADLINE_MS} per link
 * before anything is stored or sent.
 */
export async function readAttachments(
	links: readonly ResourceLinkV1[],
	context: CommandContext,
	reader: AttachmentReader | undefined,
	fail: Fail,
	deadlineMs = ATTACHMENT_READ_DEADLINE_MS
): Promise<AttachedContentV1[] | CommandResult<never>> {
	if (links.length === 0) return [];
	if (!reader) {
		return fail(
			'VALIDATION_ERROR',
			'This kernel cannot read attachments',
			'Send the text alone, or wire an attachment reader on the kernel'
		);
	}
	const outcomes = await Promise.all(
		links.map((link) => readBounded(link, context, reader, fail, deadlineMs))
	);
	const resolved: AttachedContentV1[] = [];
	for (const item of outcomes) {
		if (isRefusal(item)) return item;
		resolved.push(item);
	}
	return resolved;
}

/**
 * Re-read a waiting turn's attached links under the current person's access before continuing (3.5):
 * any link whose access was revoked, whose resource disappeared, or that fails is dropped rather than
 * leaking stale content or blocking continuation.
 */
export async function rebuildAttachments(
	links: readonly ResourceLinkV1[],
	reader: AttachmentReader | undefined,
	fail: Fail,
	deadlineMs = ATTACHMENT_READ_DEADLINE_MS
): Promise<AttachedContentV1[]> {
	if (links.length === 0 || !reader) return [];
	const outcomes = await Promise.all(
		links.map((link) =>
			readBounded(link, undefined, reader, fail, deadlineMs).catch(() => undefined)
		)
	);
	const resolved: AttachedContentV1[] = [];
	for (const item of outcomes) {
		if (item !== undefined && !isRefusal(item)) resolved.push(item);
	}
	return resolved;
}
