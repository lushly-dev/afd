#!/usr/bin/env node
// Phase 0 prototype: a hand-built pack for the whole library. The API of every element comes from
// the manifest by this script; the guidance comes from guide files written by hand. Throwaway.
//
//   node build-pack.mjs <library dir> <guides dir> <out dir>
//
// Writes <out>/pack.json, and <out>/brief.mjs and <out>/check.mjs with the pack embedded, so an
// agent given one of the scripts gets its answers and not the pack as a file.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const [library, guides, out] = process.argv.slice(2).map((path) => resolve(path));
const here = import.meta.dirname;

const manifest = JSON.parse(readFileSync(join(library, 'custom-elements.json'), 'utf8'));
const declarations = manifest.modules
	.flatMap((module) => module.declarations ?? [])
	.filter((declaration) => declaration.tagName)
	.sort((a, b) => a.tagName.localeCompare(b.tagName));

function sources(directory, found = []) {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) sources(path, found);
		else if (/\.ts$/.test(entry.name) && !/\.(spec|stories|test|d)\.ts$/.test(entry.name))
			found.push(readFileSync(path, 'utf8'));
	}
	return found;
}
const source = sources(join(library, 'src')).join('\n');

const literals = (text) => [...text.matchAll(/["']([^"']+)["']/g)].map((match) => match[1]);

/** The finite values of an attribute's type: a literal union, or an alias the source defines as one. */
function valuesOf(type) {
	if (!type) return undefined;
	if (/["']/.test(type)) return literals(type);
	if (!/^[A-Z]\w+$/.test(type)) return undefined;
	const alias = source.match(new RegExp(`type ${type}\\s*=\\s*([^;]+);`))?.[1];
	if (!alias) return undefined;
	if (/["']/.test(alias) && !/typeof/.test(alias)) return literals(alias);
	const table = alias.match(/typeof (\w+)/)?.[1];
	const body =
		table && source.match(new RegExp(`const ${table}\\s*=\\s*\\{([^}]+)\\}\\s*as const`))?.[1];
	return body ? literals(body.replace(/\b\w+\s*:/g, '')) : undefined;
}

const guideFiles = readdirSync(guides).filter((name) => name.endsWith('.guide.json'));
const guideOf = new Map(
	guideFiles.map((name) => {
		const guide = JSON.parse(readFileSync(join(guides, name), 'utf8'));
		return [guide.tag, guide];
	})
);
const shared = JSON.parse(readFileSync(join(guides, 'shared.rules.json'), 'utf8')).rules;

const components = {};
for (const declaration of declarations) {
	const guide = guideOf.get(declaration.tagName);
	const firstSentence = (declaration.description ?? '').split(/(?<=\.)\s/)[0].slice(0, 160);
	components[declaration.tagName] = {
		summary: guide?.summary ?? firstSentence,
		...(guide?.import ? { import: guide.import } : {}),
		attributes: (declaration.attributes ?? []).map(({ name, type, default: initial }) => {
			const values = valuesOf(type?.text);
			return {
				name,
				type: values ? undefined : type?.text,
				values,
				default: initial,
			};
		}),
		slots: (declaration.slots ?? []).map(({ name }) => name || '(default)'),
		events: (declaration.events ?? []).map(({ name }) => name),
		...(guide
			? {
					usage: guide.usage.map(({ id, text }) => ({ id, text })),
					a11y: guide.a11y.map(({ id, text }) => ({ id, text })),
					rules: guide.rules,
				}
			: { guidance: 'none written' }),
	};
}

const pack = {
	library: 'violet-elements',
	package: '@lushly-dev/violet-elements',
	note: 'Attributes, slots and events are from the manifest. Usage and accessibility statements were written by a person from the source and are not checked by any test.',
	rules: Object.fromEntries(shared.map(({ id, text }) => [id, text])),
	components,
};

mkdirSync(out, { recursive: true });
const text = JSON.stringify(pack);
writeFileSync(join(out, 'pack.json'), text);
const embedded = gzipSync(text).toString('base64');
for (const name of ['brief', 'check']) {
	const template = readFileSync(join(here, `${name}.template.mjs`), 'utf8');
	writeFileSync(join(out, `${name}.mjs`), template.replace('__PACK__', embedded));
}

const guided = Object.values(components).filter((component) => component.usage).length;
const withValues = Object.values(components)
	.flatMap((component) => component.attributes)
	.filter((attribute) => attribute.values).length;
console.log(
	`${declarations.length} components, ${guided} with guidance, ${shared.length} shared rules, ` +
		`${withValues} attributes with finite values, pack.json ${Buffer.byteLength(text)} bytes`
);
