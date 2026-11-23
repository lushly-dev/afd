/**
 * @fileoverview A mounted command's preview as the shell shows it (phase 5 specification, 7.2): plain lines of text,
 * one per value, for the slot's prompt, the inbox and the copilot's card. The server's words are never markup, never a
 * label of the shell's, never cut: each line is `path: value` as text, its line breaks and controls shown as code points, and with `labels = "per-part"` every value inside a part
 * labelled `"trust": "content"` is marked as written by others, as 5.1 reads it; with `whole`, all of it is.
 */

import type { ConfirmationPreviewV1 } from '@lushly-dev/loam-sdk';

/**
 * Characters a value may not show as themselves: line and paragraph breaks, which would start a line the shell did not
 * write, bidirectional and other invisible format characters, which reorder or hide what is read, and every control. Each is shown as its
 * code point instead (the trust review's B1, B6), so one value is always one visual line, read in order.
 */
/**
 * Control, format, line or paragraph separator and lone surrogate characters, by their Unicode categories, but the tab,
 * and every space but U+0020, which would read as one (the re-check).
 */
const UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}\p{Zs}]/u;
const unsafe = (char: string): boolean => char !== '\t' && char !== ' ' && UNSAFE.test(char);

/**
 * `text` with every unsafe character shown as `\u{…}`, and a backslash as `\\`, so a line break and the six characters
 * `\u{A}` never read alike (#2137's re-review).
 */
export function visible(text: string): string {
	let out = '';
	for (const char of text) {
		const code = char.codePointAt(0) ?? 0;
		out += char === '\\' ? '\\\\' : unsafe(char) ? `\\u{${code.toString(16).toUpperCase()}}` : char;
	}
	return out;
}

/**
 * A key as one step of a path: bare when it can read as nothing else, otherwise as JSON in brackets, so `mail.to` from
 * `mail` and `to`, `[0]` from an index, `a: b` from a value and an empty key stay apart (#2137's re-review).
 */
function step(key: string): string {
	return /^[^\s.[\]:"\\()]+$/u.test(key) ? key : `[${JSON.stringify(key)}]`;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A value as text, so no two values read alike (#2137): a string as itself unless it would read as another value (a
 * number, `true`, `null`, `{}`, `[]` or empty), then quoted as JSON; every other value as JSON.
 */
function textOf(value: unknown): string {
	if (typeof value !== 'string') return JSON.stringify(value) ?? String(value);
	// Empty, or padded, whose edges would not show (the re-review).
	if (value.trim() !== value || value === '') return JSON.stringify(value);
	try {
		JSON.parse(value);
		return JSON.stringify(value);
	} catch {
		return value;
	}
}

/** One line: its path and its whole value as text, never cut (the kernel asks only for a preview it can show whole). */
function lineOf(path: string, shown: string, content: boolean): string {
	// A preview that is one value has no key, and is named by words no key's step can be.
	return `${content ? '(written by others) ' : ''}${visible(path || '(the preview)')}: ${visible(shown)}`;
}

/** The preview's lines: what changed, whose words they are, then each value. */
export function previewWords(preview: ConfirmationPreviewV1 | undefined): string[] {
	if (!preview) return [];
	const head = [
		...(preview.changed ? ['Changed since you looked.'] : []),
		`What ${preview.command} shows it will do:`,
	];
	if (preview.data === undefined) return head;
	const whole = preview.labels !== 'per-part';
	if (whole) head.push("All of it is the server's report, and may be written by others.");
	const lines: string[] = [];
	const walk = (value: unknown, path: string, content: boolean) => {
		if (Array.isArray(value)) {
			if (value.every((item) => !isRecord(item) && !Array.isArray(item))) {
				// Each item as JSON, in brackets, so the boundaries between them, `null` from `"null"` and an empty list from
				// an empty string stay visible.
				const items = value.map((item) => JSON.stringify(item) ?? String(item));
				lines.push(lineOf(path, `[${items.join(', ')}]`, content));
				return;
			}
			value.forEach((item, index) => {
				walk(item, `${path}[${index}]`, content);
			});
			return;
		}
		if (isRecord(value)) {
			const inner = content || (!whole && value.trust === 'content');
			// An empty object is a value too, never nothing (#2137).
			if (Object.keys(value).length === 0) {
				lines.push(lineOf(path, '{}', content));
				return;
			}
			for (const [key, child] of Object.entries(value)) {
				// The label itself, read as 5.1 reads it; any other `trust` value is the server's and shown.
				if (key === 'trust' && child === 'content' && !whole) continue;
				const next = step(key);
				walk(
					child,
					path ? (next.startsWith('[') ? `${path}${next}` : `${path}.${next}`) : next,
					inner
				);
			}
			return;
		}
		lines.push(lineOf(path, textOf(value), content));
	};
	walk(preview.data, '', false);
	return [...head, ...lines];
}

/** A confirmation's details in the slot: "Changed since you looked." first, then the input, then the preview (7.2). */
export function slotWords(input: string, preview: readonly string[]): string {
	const [first, ...rest] = preview;
	return (
		first === 'Changed since you looked.' ? [first, input, ...rest] : [input, ...preview]
	).join('\n');
}
