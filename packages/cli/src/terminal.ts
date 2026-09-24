/**
 * @fileoverview Make server-controlled text safe to print to a terminal.
 *
 * A server decides the text of error messages, suggestions, reasoning, warnings,
 * tool names and descriptions, and stream data. Printed raw, an escape sequence
 * in any of them can set the window title (OSC 0/2), plant a hyperlink (OSC 8),
 * write the clipboard (OSC 52), move the cursor to overwrite earlier output (CSI),
 * or reset the terminal. Text mode passes every such string through
 * {@link sanitizeForTerminal}. JSON mode needs no sanitizing: `JSON.stringify`
 * escapes control characters.
 */

const ESC = 0x1b;
const BEL = 0x07;
const TAB = 0x09;
const LF = 0x0a;
const DEL = 0x7f;

/** 8-bit (C1) CSI and string terminator. */
const C1_CSI = 0x9b;
const C1_ST = 0x9c;

/** 8-bit string introducers: DCS, SOS, OSC, PM, APC. */
const C1_STRING_INTRODUCERS = new Set([0x90, 0x98, 0x9d, 0x9e, 0x9f]);

/** Second byte of a 7-bit string sequence: OSC `]`, DCS `P`, SOS `X`, PM `^`, APC `_`. */
const STRING_INTRODUCERS = new Set([']', 'P', 'X', '^', '_']);

function isC1(code: number): boolean {
	return code >= 0x80 && code <= 0x9f;
}

/**
 * End of a CSI sequence whose parameters start at `start`: parameter bytes
 * (0x30–0x3F), intermediate bytes (0x20–0x2F), then one final byte (0x40–0x7E).
 * A malformed sequence ends before the first unexpected character.
 */
function skipCsi(text: string, start: number): number {
	let i = start;
	while (i < text.length) {
		const code = text.charCodeAt(i);
		if (code >= 0x20 && code <= 0x3f) {
			i++;
			continue;
		}
		return code >= 0x40 && code <= 0x7e ? i + 1 : i;
	}
	return i;
}

/**
 * End of a string sequence (OSC, DCS, SOS, PM, APC) whose payload starts at
 * `start`, including its BEL or ST terminator. An unterminated sequence returns
 * `start`, so only the introducer is dropped and the payload prints as plain
 * text (its control characters are still removed).
 */
function skipString(text: string, start: number): number {
	for (let i = start; i < text.length; i++) {
		const code = text.charCodeAt(i);
		if (code === BEL || code === C1_ST) return i + 1;
		if (code === ESC) return text.charAt(i + 1) === '\\' ? i + 2 : start;
	}
	return start;
}

/** End of the escape or control sequence that starts at `start`. */
function skipControlSequence(text: string, start: number): number {
	const code = text.charCodeAt(start);
	if (code !== ESC) {
		if (code === C1_CSI) return skipCsi(text, start + 1);
		if (C1_STRING_INTRODUCERS.has(code)) return skipString(text, start + 1);
		return start + 1;
	}

	const next = text.charAt(start + 1);
	if (next === '[') return skipCsi(text, start + 2);
	if (STRING_INTRODUCERS.has(next)) return skipString(text, start + 2);

	// nF sequences (e.g. `ESC ( 0` charset selection): intermediates, then a final byte.
	let i = start + 1;
	while (i < text.length && text.charCodeAt(i) >= 0x20 && text.charCodeAt(i) <= 0x2f) i++;
	const final = text.charCodeAt(i);
	// Fp/Fe/Fs (e.g. `ESC c` reset, `ESC 7` save cursor) or the end of an nF sequence.
	if (final >= 0x30 && final <= 0x7e) return i + 1;
	return i;
}

/**
 * Remove terminal control characters and escape sequences from `text`.
 *
 * Strips every C0 control character except newline and tab (including CR and
 * backspace, which can overwrite a line), DEL, every C1 control character, and
 * complete ESC/C1 sequences: CSI (cursor movement, erase, colors), OSC (title,
 * hyperlinks, clipboard), DCS/SOS/PM/APC strings, and two-byte escapes. Visible
 * text, including non-ASCII characters, is kept.
 */
export function sanitizeForTerminal(text: string): string {
	let out = '';
	let i = 0;
	while (i < text.length) {
		const code = text.charCodeAt(i);
		if (code === ESC || isC1(code)) {
			i = skipControlSequence(text, i);
			continue;
		}
		if ((code < 0x20 && code !== LF && code !== TAB) || code === DEL) {
			i++;
			continue;
		}
		const end = nextControl(text, i);
		out += text.slice(i, end);
		i = end;
	}
	return out;
}

/** Index of the next character that {@link sanitizeForTerminal} must inspect. */
function nextControl(text: string, start: number): number {
	for (let i = start; i < text.length; i++) {
		const code = text.charCodeAt(i);
		if ((code < 0x20 && code !== LF && code !== TAB) || (code >= DEL && code <= 0x9f)) return i;
	}
	return text.length;
}

/** Render any server-provided value as terminal-safe text. */
export function terminalText(value: unknown): string {
	return sanitizeForTerminal(typeof value === 'string' ? value : String(value));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

/**
 * Copy `value` with every string (and object key) passed through
 * {@link sanitizeForTerminal}. Used before handing server results to a printer
 * the CLI does not own, such as the scenario reporter. Non-plain objects such as
 * dates are kept as they are.
 */
export function sanitizeDeep<T>(value: T): T {
	return sanitizeValue(value, new WeakMap()) as T;
}

function sanitizeValue(value: unknown, seen: WeakMap<object, unknown>): unknown {
	if (typeof value === 'string') return sanitizeForTerminal(value);
	if (Array.isArray(value)) {
		const cached = seen.get(value);
		if (cached) return cached;
		const copy: unknown[] = [];
		seen.set(value, copy);
		for (const item of value) copy.push(sanitizeValue(item, seen));
		return copy;
	}
	if (isPlainObject(value)) {
		const cached = seen.get(value);
		if (cached) return cached;
		const copy: Record<string, unknown> = {};
		seen.set(value, copy);
		for (const [key, item] of Object.entries(value)) {
			Object.defineProperty(copy, sanitizeForTerminal(key), {
				value: sanitizeValue(item, seen),
				enumerable: true,
				writable: true,
				configurable: true,
			});
		}
		return copy;
	}
	return value;
}
