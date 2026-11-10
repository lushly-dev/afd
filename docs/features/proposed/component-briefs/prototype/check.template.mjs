#!/usr/bin/env node
// Phase 0 stand-in for `components-check`. Throwaway.
//
//   node check.mjs <file>
//
// Reads the file as text and renders nothing. It reports library tags the pack does not know,
// attributes a component does not declare, and values outside an attribute's finite set.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const pack = JSON.parse(gunzipSync(Buffer.from('__PACK__', 'base64')).toString('utf8'));
const file = process.argv[2];
if (!file) {
	console.error('Usage: node check.mjs <file>');
	process.exit(2);
}
const text = readFileSync(file, 'utf8');
const lineOf = (index) => text.slice(0, index).split('\n').length;

const GLOBAL = new Set([
	...['id', 'class', 'slot', 'style', 'hidden', 'tabindex', 'title', 'lang', 'dir', 'role', 'part'],
	...['inert', 'name', 'for', 'ref'],
]);
const isGlobal = (name) => GLOBAL.has(name) || /^(aria-|data-)/.test(name);

const findings = [];
const used = new Set();

// Every library tag named in the text, in element position, in createElement, or elsewhere.
for (const match of text.matchAll(
	/(?<![A-Za-z0-9_-])violet-[a-z0-9]+(?:-[a-z0-9]+)*(?![A-Za-z0-9_-])/g
)) {
	const tag = match[0];
	const before = text.slice(Math.max(0, match.index - 30), match.index);
	const asElement = /<\/?$/.test(before) || /createElement\(\s*["'`]$/.test(before);
	if (pack.components[tag]) used.add(tag);
	else if (asElement) findings.push({ line: lineOf(match.index), problem: 'unknown-tag', tag });
}

// Attributes written in markup: <violet-x a="b" c ?d="${…}" :e="${…}" @f="${…}">.
for (const match of text.matchAll(/<(violet-[a-z0-9-]+)((?:\s+[^<>]*?)?)\/?>/g)) {
	const [, tag, body] = match;
	const component = pack.components[tag];
	if (!component) continue;
	const declared = new Map(component.attributes.map((attribute) => [attribute.name, attribute]));
	for (const attribute of body.matchAll(
		/\s([?:@]?[A-Za-z_][\w-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g
	)) {
		const [, written, double, single] = attribute;
		if (/^[:@]/.test(written)) continue; // a property or event binding, not an attribute
		const name = written.replace(/^\?/, '');
		const value = double ?? single;
		const line = lineOf(match.index + attribute.index);
		if (!declared.has(name)) {
			if (!isGlobal(name))
				findings.push({ line, problem: 'unknown-attribute', tag, attribute: name });
			continue;
		}
		const { values } = declared.get(name);
		if (values && value !== undefined && !value.includes('${') && !values.includes(value))
			findings.push({
				line,
				problem: 'value-not-allowed',
				tag,
				attribute: name,
				value,
				allowed: values,
			});
	}
}

// Attributes set in code: element.setAttribute("a", "b"). The element's tag is not known here, so
// only a name no component of this file declares is reported.
const everyDeclared = new Set(
	[...used].flatMap((tag) => pack.components[tag].attributes.map((attribute) => attribute.name))
);
for (const match of text.matchAll(/\.setAttribute\(\s*["'`]([\w-]+)["'`]/g)) {
	const name = match[1];
	if (!everyDeclared.has(name) && !isGlobal(name))
		findings.push({
			line: lineOf(match.index),
			problem: 'attribute-no-component-here-declares',
			attribute: name,
		});
}

console.log(
	JSON.stringify(
		{
			read: 'text only; nothing was rendered, and properties set in code were not checked',
			components: [...used].sort(),
			findings,
		},
		null,
		1
	)
);
process.exit(findings.length ? 1 : 0);
