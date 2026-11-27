/**
 * @fileoverview The approval display rules (`spec/approvals.md`, "Approval display"):
 * what a person must be able to read in full before approving an action.
 *
 * An approver, or any surface that shows a person a held call, shows the call's validated input
 * only when {@link approvalDisplay} accepts it, and otherwise shows none of it and offers no
 * approval: a person cannot approve what they cannot see, and truncating is not showing.
 *
 * Ported from Lushly's `packages/core/src/approval-display.ts` (lushly-dev/lushly at `7ffae684`,
 * 2026-11-03) and its caller `displayableArguments`, rewritten for AFD: sizes are measured on the
 * canonical JSON, the checks run in a fixed order, and a refusal is named, so every language
 * gives the same answer (`spec/vectors/approver-client.json`, `display`). Browser-safe.
 */

import { canonicalJson } from './canonical-json.js';

/** The limits of {@link approvalDisplay}. Lengths count UTF-16 code units. */
export const APPROVAL_DISPLAY_LIMITS = {
	/** The input's canonical JSON. */
	maxSerializedLength: 8_000,
	/** One string value. */
	maxStringLength: 2_000,
	/** One object key. */
	maxKeyLength: 200,
	/** Nesting: the input is at depth 0, its members and items at 1. */
	maxDepth: 6,
	/** Values visited, the input itself included. */
	maxValues: 400,
} as const;

/** Why {@link approvalDisplay} refused an input, in the order the checks run. */
export type ApprovalDisplayRefusal =
	| 'not-json'
	| 'too-long'
	| 'too-many-values'
	| 'too-deep'
	| 'string-too-long'
	| 'key-too-long'
	| 'hidden-characters';

/** The verdict of {@link approvalDisplay}: the input as plain JSON to show, or why not. */
export type ApprovalDisplay =
	| { ok: true; value: unknown }
	| { ok: false; refusal: ApprovalDisplayRefusal };

/** Combining marks this many in a row draw over the lines around them. */
const STACKED_MARKS = /\p{M}{6,}/u;

/**
 * Whether one code point makes what a person reads differ from what runs, or draws nothing:
 * controls other than tab and line feed, the soft hyphen, bidirectional marks, embeddings,
 * overrides and isolates, zero-width characters, line and paragraph separators, invisible
 * operators, blank look-alikes, variation selectors other than U+FE0E and U+FE0F, the byte order
 * mark, interlinear annotations, format controls, tags and reserved ignorables, and surrogates
 * (which a string holds only unpaired).
 */
export function isHiddenCodePoint(code: number): boolean {
	return (
		(code < 0x20 && code !== 0x09 && code !== 0x0a) ||
		(code >= 0x7f && code <= 0x9f) ||
		code === 0x00ad ||
		code === 0x034f ||
		code === 0x061c ||
		code === 0x115f ||
		code === 0x1160 ||
		code === 0x17b4 ||
		code === 0x17b5 ||
		(code >= 0x180b && code <= 0x180f) ||
		(code >= 0x200b && code <= 0x200f) ||
		code === 0x2028 ||
		code === 0x2029 ||
		(code >= 0x202a && code <= 0x202e) ||
		(code >= 0x2060 && code <= 0x206f) ||
		code === 0x2800 ||
		code === 0x3164 ||
		(code >= 0xd800 && code <= 0xdfff) ||
		(code >= 0xfe00 && code <= 0xfe0d) ||
		code === 0xfeff ||
		code === 0xffa0 ||
		(code >= 0xfff0 && code <= 0xfffb) ||
		(code >= 0x1bca0 && code <= 0x1bca3) ||
		(code >= 0x1d173 && code <= 0x1d17a) ||
		(code >= 0xe0000 && code <= 0xe0fff)
	);
}

/**
 * Whether `text` holds a hidden code point ({@link isHiddenCodePoint}) or a run of six or more
 * combining marks (Unicode general category M).
 */
export function hidesCharacters(text: string): boolean {
	for (const character of text) {
		if (isHiddenCodePoint(character.codePointAt(0) ?? 0)) return true;
	}
	return STACKED_MARKS.test(text);
}

/**
 * Whether a person can be shown `input` in full before approving it, and if so the input as plain
 * JSON, as parsed from its canonical JSON. The checks, in order: the input is plain JSON (the
 * approval tokens' canonical JSON accepts it); its canonical JSON is at most 8000 UTF-16 code
 * units; then, depth first through keys in canonical order, each value is at most the 400th
 * visited and at depth 6 or less, each string at most 2000 code units and each key at most 200,
 * and none hides characters. The first failure is the refusal. An absent (`undefined`) input is `{}`; `null` is `null`.
 */
export function approvalDisplay(input: unknown): ApprovalDisplay {
	let text: string;
	try {
		text = canonicalJson(input === undefined ? {} : input);
	} catch {
		return { ok: false, refusal: 'not-json' };
	}
	if (text.length > APPROVAL_DISPLAY_LIMITS.maxSerializedLength) {
		return { ok: false, refusal: 'too-long' };
	}
	const value: unknown = JSON.parse(text);
	let visited = 0;
	const check = (item: unknown, depth: number): ApprovalDisplayRefusal | undefined => {
		visited += 1;
		if (visited > APPROVAL_DISPLAY_LIMITS.maxValues) return 'too-many-values';
		if (depth > APPROVAL_DISPLAY_LIMITS.maxDepth) return 'too-deep';
		if (typeof item === 'string') {
			if (item.length > APPROVAL_DISPLAY_LIMITS.maxStringLength) return 'string-too-long';
			return hidesCharacters(item) ? 'hidden-characters' : undefined;
		}
		if (Array.isArray(item)) {
			for (const element of item) {
				const refusal = check(element, depth + 1);
				if (refusal) return refusal;
			}
			return undefined;
		}
		if (item !== null && typeof item === 'object') {
			// Canonical order: a parsed object lists integer-like keys first, so sort again.
			const record = item as Record<string, unknown>;
			for (const key of Object.keys(record).sort()) {
				if (key.length > APPROVAL_DISPLAY_LIMITS.maxKeyLength) return 'key-too-long';
				if (hidesCharacters(key)) return 'hidden-characters';
				const refusal = check(record[key], depth + 1);
				if (refusal) return refusal;
			}
		}
		return undefined;
	};
	const refusal = check(value, 0);
	return refusal ? { ok: false, refusal } : { ok: true, value };
}
