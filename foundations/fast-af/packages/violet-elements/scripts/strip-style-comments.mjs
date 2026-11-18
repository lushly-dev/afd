#!/usr/bin/env node
/**
 * Remove the comments from the component styles in `dist`, after `tsc`.
 *
 * The styles are `css` tagged templates. A minifier leaves a template's text as
 * it is, so every comment in a style ships to every page that loads the
 * component. The comments stay in `src`, where they explain the styles; the
 * built files lose them.
 *
 * A comment is replaced by the line breaks it held, so the line numbers, and
 * the source maps, still match.
 *
 * Run by `build`. Prints how many comments and bytes it removed.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

function* files(dir) {
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) yield* files(path);
		else if (name.endsWith('.js')) yield path;
	}
}

/**
 * The end of the template that opens at `start` (just after its backtick): the
 * index of its closing backtick. Interpolations are skipped by counting braces,
 * which holds for the plain expressions the styles interpolate.
 */
function templateEnd(code, start) {
	let i = start;
	while (i < code.length) {
		const c = code[i];
		if (c === '\\') i += 2;
		else if (c === '`') return i;
		else if (c === '$' && code[i + 1] === '{') {
			let depth = 1;
			i += 2;
			while (i < code.length && depth > 0) {
				if (code[i] === '{') depth++;
				else if (code[i] === '}') depth--;
				else if (code[i] === '`') i = templateEnd(code, i + 1);
				i++;
			}
		} else i++;
	}
	throw new Error('unclosed template');
}

const comment = /[ \t]*\/\*[\s\S]*?\*\//g;
let comments = 0;
let bytes = 0;
for (const file of files(dist)) {
	const code = readFileSync(file, 'utf8');
	let out = '';
	let from = 0;
	// A tag, not the word in a comment: `= css `, `(css `, `, css ` or `return css `.
	for (const match of code.matchAll(/(?<=(?:[=(,[]|\breturn)\s*)css\s*`/g)) {
		const open = match.index + match[0].length;
		if (open <= from) continue;
		const close = templateEnd(code, open);
		const text = code.slice(open, close).replace(comment, (found, at, whole) => {
			// Remove only a comment alone on its line that spans no interpolation: a `/*` inside a
			// CSS string sits after code, and code after a comment would move columns.
			const before = whole.slice(whole.lastIndexOf('\n', at - 1) + 1, at);
			const after = whole.slice(at + found.length).match(/^[^\n]*/)[0];
			if (before.trim() !== '' || after.trim() !== '' || found.includes('${')) {
				throw new Error(
					`${file}: a style comment that is not alone on its line, or spans \${}: ${found.trim().slice(0, 60)}`
				);
			}
			comments++;
			return '\n'.repeat(found.split('\n').length - 1);
		});
		out += code.slice(from, open) + text;
		from = close;
	}
	if (from === 0) continue;
	out += code.slice(from);
	if (out !== code) {
		bytes += code.length - out.length;
		writeFileSync(file, out);
	}
}
console.log(`strip-style-comments: ${comments} comments, ${bytes.toLocaleString('en-US')} bytes`);
