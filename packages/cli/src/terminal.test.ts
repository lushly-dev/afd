import { describe, expect, it } from 'vitest';
import { sanitizeDeep, sanitizeForTerminal, terminalText } from './terminal.js';

const ESC = '\x1b';
const BEL = '\x07';
const ST = `${ESC}\\`;

/** Whether `text` has a C0 control other than \n and \t, DEL, or a C1 control. */
function hasControl(text: string): boolean {
	return [...text].some((char) => {
		const code = char.charCodeAt(0);
		return (code < 0x20 && char !== '\n' && char !== '\t') || (code >= 0x7f && code <= 0x9f);
	});
}

describe('sanitizeForTerminal', () => {
	it('removes OSC title, hyperlink and clipboard sequences with either terminator', () => {
		expect(sanitizeForTerminal(`a${ESC}]0;pwned${BEL}b`)).toBe('ab');
		expect(sanitizeForTerminal(`a${ESC}]2;pwned${ST}b`)).toBe('ab');
		expect(
			sanitizeForTerminal(`see ${ESC}]8;;https://evil.example${ST}docs${ESC}]8;;${ST} now`)
		).toBe('see docs now');
		expect(sanitizeForTerminal(`${ESC}]52;c;ZXZpbA==${BEL}copied`)).toBe('copied');
	});

	it('removes CSI cursor movement, erase and color sequences', () => {
		expect(sanitizeForTerminal(`ok${ESC}[2A${ESC}[2K✓ fake${ESC}[0m`)).toBe('ok✓ fake');
		expect(sanitizeForTerminal(`${ESC}[2J${ESC}[H${ESC}[?25lclear`)).toBe('clear');
		expect(sanitizeForTerminal(`${ESC}[1 qcursor`)).toBe('cursor');
		expect(sanitizeForTerminal(`${ESC}[31;1mred`)).toBe('red');
	});

	it('removes 8-bit C1 sequences', () => {
		expect(sanitizeForTerminal('a\x9b31mb')).toBe('ab');
		expect(sanitizeForTerminal('a\x9d0;title\x9cb')).toBe('ab');
		expect(sanitizeForTerminal('a\x9d0;title\x07b')).toBe('ab');
		expect(sanitizeForTerminal('a\x90dcs\x9cb\x85c')).toBe('abc');
	});

	it('removes DCS, SOS, PM and APC strings and two-byte escapes', () => {
		expect(sanitizeForTerminal(`${ESC}Pq#0;2;0;0;0${ST}x`)).toBe('x');
		expect(sanitizeForTerminal(`${ESC}_apc${ST}${ESC}^pm${ST}${ESC}Xsos${ST}x`)).toBe('x');
		expect(sanitizeForTerminal(`${ESC}c${ESC}7${ESC}8${ESC}Mreset`)).toBe('reset');
		expect(sanitizeForTerminal(`${ESC}(0charset${ESC}(B`)).toBe('charset');
	});

	it('removes C0 controls, DEL and a dangling ESC but keeps newlines and tabs', () => {
		expect(sanitizeForTerminal('line1\r\nline2\tcol')).toBe('line1\nline2\tcol');
		expect(sanitizeForTerminal('pass\rFAIL')).toBe('passFAIL');
		expect(sanitizeForTerminal('a\bb\x00c\x7fd\x07e')).toBe('abcde');
		expect(sanitizeForTerminal(`end${ESC}`)).toBe('end');
		expect(sanitizeForTerminal(`${ESC}\nnext`)).toBe('\nnext');
		expect(sanitizeForTerminal(`${ESC}é`)).toBe('é');
	});

	it('drops only the introducer of an unterminated or interrupted string sequence', () => {
		expect(sanitizeForTerminal(`${ESC}]0;title never ends`)).toBe('0;title never ends');
		expect(sanitizeForTerminal(`${ESC}]0;title${ESC}[31mred`)).toBe('0;titlered');
		expect(sanitizeForTerminal(`${ESC}[12`)).toBe('');
		expect(sanitizeForTerminal(`${ESC}[1\nx`)).toBe('\nx');
	});

	it('keeps ordinary and non-ASCII text unchanged', () => {
		const text = 'Création réussie ✓ — 日本語 🚀 {"a": [1, 2]}';
		expect(sanitizeForTerminal(text)).toBe(text);
		expect(sanitizeForTerminal('')).toBe('');
	});

	it('never lets a control character through for any mix of payloads', () => {
		const pieces = [ESC, BEL, '[', ']', '\\', '0;', '8;;', 'm', 'x', '\x9b', '\x9c', '\x9d', '\r'];
		const texts: string[] = [];
		// Every sequence of three pieces, then longer pseudo-random mixes.
		for (const a of pieces) for (const b of pieces) for (const c of pieces) texts.push(a + b + c);
		let state = 1;
		for (let n = 0; n < 500; n++) {
			let text = '';
			for (let i = 0; i < 12; i++) {
				state = (state * 1103515245 + 12345) % 2147483648;
				text += pieces[state % pieces.length] ?? '';
			}
			texts.push(text);
		}
		for (const text of texts) {
			expect(hasControl(sanitizeForTerminal(text)), JSON.stringify(text)).toBe(false);
		}
	});
});

describe('terminalText', () => {
	it('stringifies and sanitizes any value', () => {
		expect(terminalText(`${ESC}]0;x${BEL}ok`)).toBe('ok');
		expect(terminalText(42)).toBe('42');
		expect(terminalText(undefined)).toBe('undefined');
	});
});

describe('sanitizeDeep', () => {
	it('sanitizes nested strings and keys without mutating the input', () => {
		const date = new Date(0);
		const input = {
			message: `${ESC}[2Jboom`,
			nested: [{ [`k${ESC}[1A`]: `v${BEL}` }, 3, null],
			at: date,
		};
		const output = sanitizeDeep(input);

		expect(output).toEqual({ message: 'boom', nested: [{ k: 'v' }, 3, null], at: date });
		expect(output.at).toBe(date);
		expect(input.message).toBe(`${ESC}[2Jboom`);
	});

	it('keeps a __proto__ key as data and copes with cycles', () => {
		const withProto = JSON.parse('{"__proto__": "x"}') as Record<string, unknown>;
		expect(Object.keys(sanitizeDeep(withProto))).toEqual(['__proto__']);

		const cyclic: { self?: unknown; list: unknown[] } = { list: [] };
		cyclic.self = cyclic;
		cyclic.list.push(cyclic.list);
		const copy = sanitizeDeep(cyclic);
		expect(copy.self).toBe(copy);
		expect(copy.list[0]).toBe(copy.list);
	});
});
