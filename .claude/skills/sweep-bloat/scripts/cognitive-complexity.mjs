#!/usr/bin/env node
/**
 * Advisory cognitive-complexity measurement for trend tracking (not a blocking gate).
 *
 * Computes Sonar-style cognitive complexity per function across JavaScript/TypeScript,
 * Python, Rust and C++ tracked source files (respecting botcore.toml `[sweep]` settings
 * and skipping tests, output directories and Botcore-seeded skills). Always exits 0 on a
 * valid run so it never blocks a commit; use `--measures-out` to emit a Health 1.0
 * measures JSON file for trend tracking.
 *
 * Needs only Node and git. Usage:
 *   node cognitive-complexity.mjs [--root <dir>] [--threshold <n>] [--top <n>]
 *                                 [--target <id>] [--json] [--measures-out <file>]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { isMeasured, readSettings, seededSkillPrefixes } from './sweep.mjs';

/** Advisory threshold used to count high-complexity findings (matches Biome/Sonar default). */
export const DEFAULT_THRESHOLD = 15;
export const MEASURES_SCHEMA_VERSION = '1.0';
const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

const EXTRA_CPP_EXTENSIONS = ['.cpp', '.cc', '.cxx', '.hpp', '.h'];
const JS_EXTS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const RUST_EXTS = new Set(['.rs']);
const CPP_EXTS = new Set(EXTRA_CPP_EXTENSIONS);
const PY_EXTS = new Set(['.py']);

const CONTROL_KEYWORDS = new Set([
	'if',
	'else',
	'for',
	'while',
	'do',
	'switch',
	'catch',
	'with',
	'return',
	'throw',
	'new',
	'typeof',
	'delete',
	'void',
	'await',
	'yield',
	'case',
	'default',
	'match',
	'loop',
	'namespace',
	'class',
	'struct',
	'enum',
	'union',
	'sizeof',
	'alignof',
	'decltype',
	'static_assert',
]);

const JS_REGEX_KEYWORDS = new Set([
	'return',
	'typeof',
	'instanceof',
	'in',
	'of',
	'new',
	'delete',
	'void',
	'throw',
	'case',
	'do',
	'else',
	'yield',
	'await',
]);

function languageOf(file) {
	const ext = extname(file).toLowerCase();
	if (JS_EXTS.has(ext)) return 'javascript';
	if (PY_EXTS.has(ext)) return 'python';
	if (RUST_EXTS.has(ext)) return 'rust';
	if (CPP_EXTS.has(ext)) return 'cpp';
	return undefined;
}

// ── Masking comments and string/regex literals ───────────────────────────────

function blankRange(chars, from, to) {
	for (let i = from; i < to; i++) if (chars[i] !== '\n') chars[i] = ' ';
}

/** Mask comments, strings, templates (preserving `${...}` code) and JS/TS regex literals. */
export function maskBraceSource(text, lang) {
	const out = text.split('');
	let i = 0;
	const n = text.length;
	let previous = '';
	const regexMayFollow = () => previous !== 'x' && previous !== '++' && previous !== '--';

	function skipQuoted(quote, allowMultiline) {
		const start = i;
		i += 1;
		while (i < n && text[i] !== quote && (allowMultiline || text[i] !== '\n')) {
			if (text[i] === '\\') i += 2;
			else i += 1;
		}
		blankRange(out, start + 1, i);
		if (i < n && text[i] === quote) i += 1;
	}

	function skipTemplate() {
		i += 1;
		let segStart = i;
		while (i < n && text[i] !== '`') {
			if (text[i] === '\\') {
				i += 2;
				continue;
			}
			if (text[i] === '$' && text[i + 1] === '{') {
				blankRange(out, segStart, i + 2);
				i += 2;
				previous = '';
				scan('}');
				if (i > 0 && out[i - 1] === '}') out[i - 1] = ' ';
				segStart = i;
				continue;
			}
			i += 1;
		}
		blankRange(out, segStart, i);
		if (i < n && text[i] === '`') i += 1;
	}

	function skipRegex() {
		const start = i;
		i += 1;
		let inClass = false;
		while (i < n && text[i] !== '\n') {
			const c = text[i];
			if (c === '\\') {
				i += 2;
				continue;
			}
			if (c === '[') inClass = true;
			else if (c === ']') inClass = false;
			else if (c === '/' && !inClass) break;
			i += 1;
		}
		blankRange(out, start + 1, i);
		if (i < n && text[i] === '/') i += 1;
	}

	function scan(closeChar) {
		let depth = 0;
		while (i < n) {
			const c = text[i];
			const next = text[i + 1];
			if (c === '/' && next === '/') {
				const end = text.indexOf('\n', i);
				const stop = end === -1 ? n : end;
				blankRange(out, i, stop);
				i = stop;
				continue;
			}
			if (c === '/' && next === '*') {
				const end = text.indexOf('*/', i + 2);
				const stop = end === -1 ? n : end + 2;
				blankRange(out, i, stop);
				i = stop;
				continue;
			}
			if (lang === 'rust' && c === 'r' && (next === '"' || next === '#')) {
				let hashes = 0;
				let j = i + 1;
				while (j < n && text[j] === '#') {
					hashes += 1;
					j += 1;
				}
				if (text[j] === '"') {
					const close = `"${'#'.repeat(hashes)}`;
					const end = text.indexOf(close, j + 1);
					const stop = end === -1 ? n : end + close.length;
					blankRange(out, i, stop);
					i = stop;
					previous = 'x';
					continue;
				}
			}
			if (c === '"') {
				skipQuoted('"', lang === 'rust');
				previous = 'x';
				continue;
			}
			if (c === '`' && lang === 'javascript') {
				skipTemplate();
				previous = 'x';
				continue;
			}
			if (c === "'") {
				if (lang === 'rust') {
					const isEscapedChar = text[i + 1] === '\\' && text[i + 3] === "'";
					const isShortChar = text[i + 1] !== '\\' && text[i + 2] === "'";
					const isHexChar = text[i + 1] === '\\' && text[i + 2] === 'x' && text[i + 5] === "'";
					if (!isEscapedChar && !isShortChar && !isHexChar) {
						i += 1;
						continue;
					}
				}
				skipQuoted("'", false);
				previous = 'x';
				continue;
			}
			if (lang === 'javascript' && c === '/' && regexMayFollow()) {
				skipRegex();
				previous = 'x';
				continue;
			}
			if (c === '{') depth += 1;
			else if (c === '}') {
				if (depth === 0 && closeChar === '}') {
					i += 1;
					return;
				}
				depth -= 1;
			}
			if (lang === 'javascript') {
				if (/[A-Za-z_$]/.test(c)) {
					const word = /^[A-Za-z0-9_$]+/.exec(text.slice(i, i + 64))[0];
					let before = i - 1;
					while (before >= 0 && /\s/.test(out[before])) before -= 1;
					const isProp = before >= 0 && out[before] === '.';
					previous = JS_REGEX_KEYWORDS.has(word) && !isProp ? word : 'x';
					i += word.length;
					continue;
				}
				if ((c === '+' || c === '-') && next === c) {
					previous = previous === 'x' ? `${c}${c}` : c;
					i += 2;
					continue;
				}
				if (!/\s/.test(c)) previous = /[\w$)\]]/.test(c) ? 'x' : c;
			}
			i += 1;
		}
	}

	scan(null);
	return out.join('');
}

/** Mask `#` comments and single/double/triple-quoted strings in Python source. */
export function maskPythonSource(text) {
	const out = text.split('');
	let i = 0;
	const n = text.length;
	while (i < n) {
		const c = text[i];
		if (c === '#') {
			const end = text.indexOf('\n', i);
			const stop = end === -1 ? n : end;
			blankRange(out, i, stop);
			i = stop;
			continue;
		}
		if (c === '"' || c === "'") {
			const triple = text[i + 1] === c && text[i + 2] === c;
			const start = i;
			if (triple) {
				i += 3;
				const close = c.repeat(3);
				while (i < n && !text.startsWith(close, i)) {
					if (text[i] === '\\') i += 2;
					else i += 1;
				}
				blankRange(out, start + 3, i);
				i += 3;
			} else {
				i += 1;
				while (i < n && text[i] !== c && text[i] !== '\n') {
					if (text[i] === '\\') i += 2;
					else i += 1;
				}
				blankRange(out, start + 1, i);
				i += 1;
			}
			continue;
		}
		i += 1;
	}
	return out.join('');
}

// ── Brace-language cognitive complexity (JS/TS, Rust, C++) ───────────────────

const BRACE_TOKENS =
	/&&|\|\||\?\?|\?\.|=>|::|===|!==|==|!=|<=|>=|[{}()[\]?:;,'"`=]|(?:\b(?:async|function|fn|if|else|for|while|do|switch|match|loop|catch|break|continue|goto)\b)|(?:\b[A-Za-z_$][A-Za-z0-9_$]*\b)|(?:\b\d+\b)/g;

function tokenizeBrace(masked) {
	const tokens = [];
	let line = 1;
	let lastIndex = 0;
	for (const match of masked.matchAll(BRACE_TOKENS)) {
		for (let k = lastIndex; k < match.index; k++) if (masked[k] === '\n') line += 1;
		lastIndex = match.index;
		tokens.push({ value: match[0], index: match.index, line });
	}
	return tokens;
}

/** Find matching closing delimiter index, or -1 if unbalanced. */
function matchClose(tokens, start, open, close) {
	let depth = 0;
	for (let i = start; i < tokens.length; i++) {
		if (tokens[i].value === open) depth += 1;
		else if (tokens[i].value === close) {
			depth -= 1;
			if (depth === 0) return i;
		}
	}
	return -1;
}

/** Infer the binding name preceding a JS/TS arrow function `=>` at index `arrowIdx`. */
function inferArrowName(tokens, arrowIdx) {
	let back = arrowIdx - 1;
	if (tokens[back]?.value === ')') {
		let depth = 0;
		while (back >= 0) {
			if (tokens[back].value === ')') depth += 1;
			else if (tokens[back].value === '(') {
				depth -= 1;
				if (depth === 0) break;
			}
			back -= 1;
		}
		back -= 1;
	} else if (back >= 0 && /^[A-Za-z_$]/.test(tokens[back].value)) {
		// Single bare parameter `x => ...`
		back -= 1;
	}
	if (back >= 0 && tokens[back]?.value === 'async') back -= 1;
	if (back >= 0 && tokens[back]?.value === '=') back -= 1;
	if (
		back >= 0 &&
		/^[A-Za-z_$]/.test(tokens[back].value) &&
		!CONTROL_KEYWORDS.has(tokens[back].value)
	) {
		return tokens[back].value;
	}
	return '<arrow>';
}

/** Whether `=>` at `arrowIdx` looks like a TypeScript function-type annotation `name: (...) => T`. */
function isTsFunctionType(tokens, arrowIdx) {
	if (tokens[arrowIdx + 1]?.value === '{') return false;
	let back = arrowIdx - 1;
	if (tokens[back]?.value !== ')') return false;
	let depth = 0;
	while (back >= 0) {
		if (tokens[back].value === ')') depth += 1;
		else if (tokens[back].value === '(') {
			depth -= 1;
			if (depth === 0) break;
		}
		back -= 1;
	}
	const before = tokens[back - 1]?.value;
	return before === ':' || before === '=>';
}

/** Find end token index (inclusive) of an expression-bodied arrow starting at `arrowIdx + 1`. */
function findArrowExprEnd(tokens, start) {
	let paren = 0;
	let brace = 0;
	let bracket = 0;
	for (let i = start; i < tokens.length; i++) {
		const v = tokens[i].value;
		if (v === '(') paren += 1;
		else if (v === ')') {
			if (paren === 0 && brace === 0 && bracket === 0) return i - 1;
			paren = Math.max(0, paren - 1);
		} else if (v === '{') brace += 1;
		else if (v === '}') {
			if (paren === 0 && brace === 0 && bracket === 0) return i - 1;
			brace = Math.max(0, brace - 1);
		} else if (v === '[') bracket += 1;
		else if (v === ']') {
			if (paren === 0 && brace === 0 && bracket === 0) return i - 1;
			bracket = Math.max(0, bracket - 1);
		} else if (
			(v === ';' || v === ',' || v === '=') &&
			paren === 0 &&
			brace === 0 &&
			bracket === 0
		) {
			return i - 1;
		}
	}
	return tokens.length - 1;
}

/** Detect function declarations (including expression-bodied JS arrows) in a token stream. */
function findBraceFunctions(tokens, lang) {
	const functions = [];
	for (let i = 0; i < tokens.length; i++) {
		const tok = tokens[i];
		if (lang === 'javascript' && tok.value === 'function') {
			let j = i + 1;
			let name = '<anonymous>';
			if (tokens[j] && /^[A-Za-z_$]/.test(tokens[j].value) && tokens[j].value !== '(') {
				name = tokens[j].value;
				j += 1;
			}
			while (j < tokens.length && tokens[j].value !== '(' && tokens[j].value !== '{') j += 1;
			if (tokens[j]?.value !== '(') continue;
			const closeParen = matchClose(tokens, j, '(', ')');
			if (closeParen === -1) continue;
			let k = closeParen + 1;
			while (k < tokens.length && tokens[k].value !== '{' && tokens[k].value !== ';') k += 1;
			if (tokens[k]?.value === '{') {
				const end = matchClose(tokens, k, '{', '}');
				if (end !== -1) functions.push({ name, line: tok.line, bodyStart: k, bodyEnd: end });
			}
			continue;
		}
		if (lang === 'javascript' && tok.value === '=>') {
			if (isTsFunctionType(tokens, i)) continue;
			if (tokens[i + 1]?.value === '{') {
				const end = matchClose(tokens, i + 1, '{', '}');
				if (end !== -1) {
					functions.push({
						name: inferArrowName(tokens, i),
						line: tok.line,
						bodyStart: i + 1,
						bodyEnd: end,
					});
				}
			} else if (i + 1 < tokens.length) {
				const exprEnd = findArrowExprEnd(tokens, i + 1);
				if (exprEnd >= i + 1) {
					functions.push({
						name: inferArrowName(tokens, i),
						line: tok.line,
						bodyStart: i,
						bodyEnd: exprEnd + 1,
						expression: true,
					});
				}
			}
			continue;
		}
		if (lang === 'rust' && tok.value === 'fn') {
			const nameTok = tokens[i + 1];
			if (!nameTok || !/^[A-Za-z_]/.test(nameTok.value)) continue;
			let j = i + 2;
			while (j < tokens.length && tokens[j].value !== '(' && tokens[j].value !== ';') j += 1;
			if (tokens[j]?.value !== '(') continue;
			const closeParen = matchClose(tokens, j, '(', ')');
			if (closeParen === -1) continue;
			let k = closeParen + 1;
			while (k < tokens.length && tokens[k].value !== '{' && tokens[k].value !== ';') k += 1;
			if (tokens[k]?.value === '{') {
				const end = matchClose(tokens, k, '{', '}');
				if (end !== -1)
					functions.push({ name: nameTok.value, line: tok.line, bodyStart: k, bodyEnd: end });
			}
			continue;
		}
		if (
			(lang === 'javascript' || lang === 'cpp') &&
			/^[A-Za-z_$]/.test(tok.value) &&
			!CONTROL_KEYWORDS.has(tok.value) &&
			tokens[i + 1]?.value === '('
		) {
			const prev = tokens[i - 1]?.value;
			if (prev === 'function' || prev === 'new' || prev === 'return') continue;
			const closeParen = matchClose(tokens, i + 1, '(', ')');
			if (closeParen === -1) continue;
			let k = closeParen + 1;
			let parenOrBraceSeen = false;
			while (
				k < tokens.length &&
				tokens[k].value !== '{' &&
				tokens[k].value !== ';' &&
				tokens[k].value !== '=>' &&
				k - closeParen <= 16
			) {
				if (tokens[k].value === '(') {
					parenOrBraceSeen = true;
					break;
				}
				k += 1;
			}
			if (!parenOrBraceSeen && tokens[k]?.value === '{') {
				const end = matchClose(tokens, k, '{', '}');
				if (end !== -1)
					functions.push({ name: tok.value, line: tok.line, bodyStart: k, bodyEnd: end });
			}
		}
	}
	return functions;
}

/** Score cognitive complexity for one top-level function body `[bodyStart..bodyEnd]`. */
function scoreBraceBody(tokens, bodyStart, bodyEnd, nestedBodyStarts, lang) {
	let complexity = 0;
	let nesting = 0;
	const braceStack = [];
	let pendingNest = false;
	let pendingIsDo = false;
	let justClosedDo = false;
	let parenDepth = 0;
	let lastLogicOp = null;

	for (let i = bodyStart + 1; i < bodyEnd; i++) {
		const tok = tokens[i];
		const val = tok.value;
		const next = tokens[i + 1]?.value;

		if (val === '(') parenDepth += 1;
		else if (val === ')') parenDepth = Math.max(0, parenDepth - 1);

		if (val === '&&' || val === '||' || val === '??') {
			if (lastLogicOp !== val) {
				complexity += 1;
				lastLogicOp = val;
			}
			continue;
		}
		if (val === ';' || val === '{' || val === '}' || val === ')' || val === ',') {
			lastLogicOp = null;
		}
		if (val === ';' && parenDepth === 0) {
			pendingNest = false;
			pendingIsDo = false;
			justClosedDo = false;
			continue;
		}

		if (val === '{') {
			const isNestedFn = nestedBodyStarts.has(i);
			const increments = pendingNest || isNestedFn;
			braceStack.push({ increments, isDo: pendingIsDo });
			if (increments) nesting += 1;
			pendingNest = false;
			pendingIsDo = false;
			justClosedDo = false;
			continue;
		}
		if (val === '}') {
			const frame = braceStack.pop();
			if (frame?.increments) nesting = Math.max(0, nesting - 1);
			justClosedDo = Boolean(frame?.isDo);
			continue;
		}

		if (val === 'while' && justClosedDo) {
			// Closing `while (cond)` of a `do { ... } while (cond);` loop does not double-count.
			justClosedDo = false;
			continue;
		}
		justClosedDo = false;

		if (val === 'else' && next === 'if') {
			complexity += 1;
			pendingNest = true;
			i += 1;
			continue;
		}
		if (val === 'else') {
			complexity += 1;
			pendingNest = true;
			continue;
		}
		if (
			val === 'if' ||
			val === 'for' ||
			val === 'while' ||
			val === 'do' ||
			val === 'switch' ||
			val === 'match' ||
			val === 'loop' ||
			val === 'catch'
		) {
			complexity += 1 + nesting;
			pendingNest = true;
			pendingIsDo = val === 'do';
			continue;
		}
		if (val === '?') {
			// Rust has no ternary operator; `?` is error propagation.
			if (lang === 'rust') continue;
			const looksLikeOptional = next === ':' || next === ',' || next === ')' || next === ';';
			if (!looksLikeOptional) {
				complexity += 1 + nesting;
			}
			continue;
		}
		if (
			(val === 'break' || val === 'continue') &&
			next &&
			tokens[i + 1].line === tok.line &&
			/^[A-Za-z_$]/.test(next) &&
			!CONTROL_KEYWORDS.has(next)
		) {
			complexity += 1;
			continue;
		}
		if (val === 'goto') {
			complexity += 1;
		}
	}
	return complexity;
}

function analyzeBraceFile(file, text, lang) {
	const masked = maskBraceSource(text, lang);
	const tokens = tokenizeBrace(masked);
	const allFns = findBraceFunctions(tokens, lang);
	const byBody = new Map();
	for (const fn of allFns) if (!byBody.has(fn.bodyStart)) byBody.set(fn.bodyStart, fn);
	const unique = [...byBody.values()].sort((a, b) => a.bodyStart - b.bodyStart);
	const nestedStarts = new Set();
	const topLevel = [];
	for (const fn of unique) {
		const enclosed = topLevel.some(
			(outer) => fn.bodyStart > outer.bodyStart && fn.bodyEnd <= outer.bodyEnd
		);
		if (enclosed) nestedStarts.add(fn.bodyStart);
		else topLevel.push(fn);
	}
	return topLevel.map((fn) => ({
		file,
		name: fn.name,
		line: fn.line,
		complexity: scoreBraceBody(tokens, fn.bodyStart, fn.bodyEnd, nestedStarts, lang),
	}));
}

// ── Python cognitive complexity ──────────────────────────────────────────────

function countLogicRuns(line) {
	let score = 0;
	let lastOp = null;
	for (const match of line.matchAll(/\b(and|or)\b/g)) {
		const op = match[1];
		if (op !== lastOp) {
			score += 1;
			lastOp = op;
		}
	}
	return score;
}

function delimiterDelta(line) {
	let delta = 0;
	for (const c of line) {
		if (c === '(' || c === '[' || c === '{') delta += 1;
		else if (c === ')' || c === ']' || c === '}') delta -= 1;
	}
	return delta;
}

function analyzePythonFile(file, text) {
	const masked = maskPythonSource(text);
	const lines = masked.split(/\r?\n/);
	const results = [];
	let current = null;
	let parenDepth = 0;

	const finish = () => {
		if (!current) return;
		results.push({
			file,
			name: current.name,
			line: current.line,
			complexity: current.complexity,
		});
		current = null;
	};

	for (let idx = 0; idx < lines.length; idx++) {
		const raw = lines[idx];
		const trimmed = raw.trim();
		if (!trimmed) continue;
		const indent = raw.match(/^[ \t]*/)[0].replaceAll('\t', '    ').length;
		const wasContinued = parenDepth > 0;
		parenDepth = Math.max(0, parenDepth + delimiterDelta(trimmed));

		if (wasContinued) {
			if (current && !current.inSignature) {
				current.complexity += countLogicRuns(trimmed);
			}
			if (current?.inSignature && parenDepth === 0 && trimmed.endsWith(':')) {
				current.inSignature = false;
			}
			continue;
		}

		if (current && indent <= current.indent) {
			finish();
		}

		const defMatch = /^(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(trimmed);
		if (defMatch) {
			const signatureOpen = parenDepth > 0 || !trimmed.endsWith(':');
			if (!current) {
				current = {
					name: defMatch[1],
					line: idx + 1,
					indent,
					complexity: 0,
					stack: [],
					inSignature: signatureOpen,
				};
			} else {
				while (current.stack.length > 0 && current.stack.at(-1).indent >= indent)
					current.stack.pop();
				current.stack.push({ indent, kind: 'def' });
				if (signatureOpen) current.inSignature = true;
			}
			continue;
		}

		if (!current) continue;
		if (current.inSignature) {
			if (parenDepth === 0 && trimmed.endsWith(':')) current.inSignature = false;
			continue;
		}

		while (current.stack.length > 0 && current.stack.at(-1).indent >= indent) {
			current.stack.pop();
		}
		const nesting = current.stack.length;

		if (/^elif\b/.test(trimmed)) {
			current.complexity += 1 + countLogicRuns(trimmed);
			current.stack.push({ indent, kind: 'elif' });
		} else if (/^else\s*:/.test(trimmed)) {
			current.complexity += 1;
			current.stack.push({ indent, kind: 'else' });
		} else if (/^(?:if|for|async\s+for|while|except|match)\b/.test(trimmed)) {
			current.complexity += 1 + nesting + countLogicRuns(trimmed);
			current.stack.push({ indent, kind: 'branch' });
		} else {
			const inlineIfs = [...trimmed.matchAll(/\bif\b.*\belse\b/g)].length;
			if (inlineIfs > 0) current.complexity += inlineIfs * (1 + nesting);
			current.complexity += countLogicRuns(trimmed);
		}
	}
	finish();
	return results;
}

/** Analyze one file's functions and cognitive complexity scores. */
export function analyzeSource(file, text) {
	const lang = languageOf(file);
	if (!lang) return [];
	if (lang === 'python') return analyzePythonFile(file, text);
	return analyzeBraceFile(file, text, lang);
}

// ── Repository scan & measures output ────────────────────────────────────────

function gitRunner(root) {
	const env = { ...process.env };
	for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
	return (args) =>
		execFileSync('git', args, {
			cwd: root,
			encoding: 'utf8',
			env,
			stdio: ['ignore', 'pipe', 'pipe'],
			maxBuffer: 256 * 1024 * 1024,
		});
}

function loadSettings(root) {
	const botcore = join(root, 'botcore.toml');
	if (existsSync(botcore)) return readSettings(readFileSync(botcore, 'utf8'));
	const pyproject = join(root, 'pyproject.toml');
	if (existsSync(pyproject))
		return readSettings(readFileSync(pyproject, 'utf8'), { pyproject: true });
	return readSettings('');
}

export function measureCognitiveComplexity({
	root = process.cwd(),
	threshold = DEFAULT_THRESHOLD,
} = {}) {
	const git = gitRunner(root);
	const paths = git(['ls-files', '-z']).split('\0').filter(Boolean);
	const configured = loadSettings(root);
	const readTracked = (p) => {
		const full = join(root, p);
		return existsSync(full) ? readFileSync(full, 'utf8') : undefined;
	};
	const seeded = seededSkillPrefixes(paths, configured.skillsDir, readTracked);
	const extensions = [...new Set([...configured.extensions, ...EXTRA_CPP_EXTENSIONS])];
	const settings = { ...configured, extensions, exclude: [...configured.exclude, ...seeded] };

	const functions = [];
	let filesMeasured = 0;
	for (const path of paths) {
		if (!isMeasured(path, settings)) continue;
		const content = readTracked(path);
		if (content === undefined) continue;
		filesMeasured += 1;
		functions.push(...analyzeSource(path, content));
	}
	const findings = functions
		.filter((fn) => fn.complexity > threshold)
		.sort((a, b) => b.complexity - a.complexity || a.file.localeCompare(b.file) || a.line - b.line);
	const maxComplexity = functions.reduce((max, fn) => Math.max(max, fn.complexity), 0);
	const totalComplexity = functions.reduce((sum, fn) => sum + fn.complexity, 0);
	return {
		advisory: true,
		threshold,
		filesMeasured,
		functionsMeasured: functions.length,
		findingsCount: findings.length,
		maxComplexity,
		totalComplexity,
		findings,
	};
}

/** Build a Health 1.0 measures document from a cognitive complexity report. */
export function toMeasuresDocument(report, { source = 'cognitive-complexity', target } = {}) {
	if (target !== undefined && !IDENTIFIER.test(target)) {
		throw new Error(`Invalid measure target identifier: ${target}`);
	}
	if (!IDENTIFIER.test(source)) {
		throw new Error(`Invalid measure source identifier: ${source}`);
	}
	return {
		schema_version: MEASURES_SCHEMA_VERSION,
		source,
		...(target !== undefined ? { target } : {}),
		measures: [
			{
				key: 'cognitive_complexity_findings',
				label: `Functions over cognitive complexity ${report.threshold}`,
				value: report.findingsCount,
				unit: 'functions',
				direction: 'lower_is_better',
			},
			{
				key: 'cognitive_complexity_max',
				label: 'Max function cognitive complexity',
				value: report.maxComplexity,
				unit: 'score',
				direction: 'lower_is_better',
			},
			{
				key: 'cognitive_complexity_total',
				label: 'Total cognitive complexity',
				value: report.totalComplexity,
				unit: 'score',
				direction: 'neutral',
			},
			{
				key: 'cognitive_complexity_functions',
				label: 'Measured functions',
				value: report.functionsMeasured,
				unit: 'functions',
				direction: 'neutral',
			},
		],
	};
}

export function formatReport(report, top = 15) {
	const lines = [
		`Cognitive complexity (advisory trend only, recording threshold > ${report.threshold})`,
		`  files measured: ${report.filesMeasured}`,
		`  functions measured: ${report.functionsMeasured}`,
		`  functions over ${report.threshold}: ${report.findingsCount} (max ${report.maxComplexity}, total ${report.totalComplexity})`,
	];
	if (report.findings.length > 0) {
		lines.push('', `Highest-complexity functions (top ${Math.min(top, report.findings.length)}):`);
		for (const fn of report.findings.slice(0, top)) {
			lines.push(`  ${String(fn.complexity).padStart(4)}  ${fn.file}:${fn.line}  ${fn.name}`);
		}
	}
	return lines.join('\n');
}

export function main(argv) {
	const { values } = parseArgs({
		args: argv,
		options: {
			root: { type: 'string' },
			threshold: { type: 'string' },
			top: { type: 'string' },
			target: { type: 'string' },
			json: { type: 'boolean' },
			'measures-out': { type: 'string' },
		},
	});
	const root = values.root
		? resolve(values.root)
		: gitRunner(process.cwd())(['rev-parse', '--show-toplevel']).trim();
	const threshold = values.threshold === undefined ? DEFAULT_THRESHOLD : Number(values.threshold);
	if (!Number.isInteger(threshold) || threshold < 1) {
		throw new Error('--threshold takes a positive whole number.');
	}
	const top = values.top === undefined ? 15 : Number(values.top);
	if (!Number.isInteger(top) || top < 1) {
		throw new Error('--top takes a positive whole number.');
	}
	if (values['measures-out'] !== undefined && !values['measures-out'].trim()) {
		throw new Error('--measures-out takes a non-empty file path.');
	}
	const report = measureCognitiveComplexity({ root, threshold });
	if (values['measures-out'] !== undefined) {
		const outPath = resolve(values['measures-out']);
		const doc = toMeasuresDocument(report, { target: values.target });
		mkdirSync(dirname(outPath), { recursive: true });
		writeFileSync(outPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
	}
	return values.json ? JSON.stringify(report, null, 2) : formatReport(report, top);
}

if (
	process.argv[1] &&
	realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
	try {
		console.log(main(process.argv.slice(2)));
	} catch (cause) {
		console.error(cause instanceof Error ? cause.message : String(cause));
		process.exitCode = 1;
	}
}
