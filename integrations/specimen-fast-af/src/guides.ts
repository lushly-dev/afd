import type { GuideSource, GuideSourceRule } from '@lushly-dev/specimen';

/**
 * FAST-AF's guide source: an attribute taxonomy, as `@lushly-dev/violet-elements` keeps in
 * `attribute-taxonomy.jsonc`, turned into shared rules, so what an attribute means is stated once
 * for every component that has it. Specimen runs it in Node, through the `guideSources` key; it
 * reads only through the context Specimen gives it, so it imports no Node module.
 */
export interface AttributeTaxonomyOptions {
	/** The taxonomy file, relative to the Specimen configuration. */
	file?: string;
	/** The first segment of each rule id. */
	prefix?: string;
}
/** One entry of the taxonomy's `attributes`, as far as rules need it. */
interface TaxonomyAttribute {
	name: string;
	definition: string;
	doNotUseFor?: string[];
	usedBy?: string[];
}

const LIMIT = 240;
const SEGMENT = /^[a-z0-9][a-z0-9-]*$/;
const length = (text: string) => [...text].length;
const line = (text: string) => text.replace(/\s+/g, ' ').trim();

/** JSON with `//` and `/* *\/` comments, as `.jsonc` files are written; no trailing commas. */
export function parseJsonc(text: string): unknown {
	let out = '';
	for (let index = 0; index < text.length; index++) {
		const character = text[index] as string;
		if (character === '"') {
			const start = index;
			for (index++; index < text.length && text[index] !== '"'; index++)
				if (text[index] === '\\') index++;
			out += text.slice(start, index + 1);
		} else if (character === '/' && text[index + 1] === '/')
			while (index < text.length && text[index] !== '\n') index++;
		else if (character === '/' && text[index + 1] === '*') {
			const end = text.indexOf('*/', index + 2);
			index = end < 0 ? text.length : end + 1;
		} else out += character;
	}
	return JSON.parse(out);
}

function entries(taxonomy: unknown): TaxonomyAttribute[] {
	const attributes = (taxonomy as { attributes?: unknown } | null)?.attributes;
	if (!Array.isArray(attributes)) throw new Error('the taxonomy has no attributes array');
	return attributes.map((entry: Partial<TaxonomyAttribute>, index) => {
		if (typeof entry?.name !== 'string' || !SEGMENT.test(entry.name))
			throw new Error(`attributes[${index}] has no attribute name`);
		if (typeof entry.definition !== 'string' || !entry.definition.trim())
			throw new Error(`attributes[${index}] (${entry.name}) has no definition`);
		return entry as TaxonomyAttribute;
	});
}

/**
 * The taxonomy's rules: one per attribute, its definition and what it is not for. When the two do
 * not fit one rule's 240 characters, what it is not for is a rule of its own, `<id>.not-for`. A
 * name the taxonomy defines once applies by attribute; a name it defines more than once, with a
 * meaning per component, applies to the tags each entry lists, as `<prefix>.<name>.<first tag>`.
 * Rules are sorted by id.
 */
export function taxonomyRules(taxonomy: unknown, prefix = 'taxonomy'): GuideSourceRule[] {
	if (!SEGMENT.test(prefix)) throw new Error(`'${prefix}' cannot start a rule id`);
	const all = entries(taxonomy);
	const count = new Map<string, number>();
	for (const entry of all) count.set(entry.name, (count.get(entry.name) ?? 0) + 1);
	const rules: GuideSourceRule[] = [];
	for (const entry of all) {
		const shared = count.get(entry.name) === 1;
		const tags = [...new Set(entry.usedBy ?? [])].sort();
		if (!shared && !tags.length)
			throw new Error(`'${entry.name}' is defined more than once and this entry names no tag`);
		const id = shared
			? `${prefix}.${entry.name}`
			: `${prefix}.${entry.name}.${(tags[0] as string).replace(/[^a-z0-9-]/g, '-')}`;
		const appliesTo = shared ? { attributes: [entry.name] } : { tags };
		const definition = line(entry.definition);
		const notFor = (entry.doNotUseFor ?? []).map(line).filter(Boolean);
		const both = notFor.length ? `${definition} Not for: ${notFor.join('; ')}.` : definition;
		if (length(both) <= LIMIT) rules.push({ id, text: both, appliesTo });
		else {
			rules.push({ id, text: definition, appliesTo });
			rules.push({
				id: `${id}.not-for`,
				text: `Do not use ${entry.name} for: ${notFor.join('; ')}.`,
				appliesTo,
			});
		}
	}
	return rules.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** A guide source reading an attribute taxonomy file; a rule over 240 characters is Specimen's to report. */
export function attributeTaxonomy(options: AttributeTaxonomyOptions = {}): GuideSource {
	const file = options.file ?? 'attribute-taxonomy.jsonc';
	return {
		id: 'fast-af-taxonomy',
		async rules({ read }) {
			return taxonomyRules(parseJsonc(await read(file)), options.prefix);
		},
	};
}
