import {
	type CoverageLevel,
	type CoverageReport,
	defaultValue,
	fallbackValue,
	inDefaultState,
	same,
	schemaMembers,
} from './coverage.js';
import { attributeNames, type LoadedGuides } from './guides.js';
import { canonicalJson } from './pack.js';
import {
	PACK_FORMAT_VERSION,
	PACK_PATTERNS,
	PACK_TEXT_LIMITS,
	type PackComponent,
	type PackRules,
} from './pack-schema.js';
import type { ComponentSchema, SchemaValue } from './plugin.js';
import type { ElementObservation, GuideCoverage, Observation, PackConfig } from './types.js';

/**
 * A pack's committed form, built from what a run showed: the schemas say what a component
 * declares, the captures of the cases that passed in both passes say what was observed, the
 * claims say what was verified, and the guides say what a person wrote. Nothing here reads a
 * clock, a path or a version, so the same inputs give the same bytes.
 */

/** A case that passed, in both passes alike, with what the pack takes from it. */
export interface PackCase {
	id: string;
	/** The tag the entry names as its component, when it names one. */
	component?: string;
	observation: Observation;
}

/** Markup that rendered, mounted again and seen to give the same observation. */
export interface PackExample {
	tag: string;
	from: string;
	html: string;
}

export interface PackBuildInput {
	config: PackConfig;
	/** Every schema the run used; only the library's tags get a record. */
	schemas: readonly ComponentSchema[];
	guides?: LoadedGuides;
	coverage: Pick<CoverageReport, 'components'>;
	guideCoverage?: GuideCoverage;
	cases: readonly PackCase[];
	examples: readonly PackExample[];
}

/** Something the build left out of a record, and why. */
export interface PackOmission {
	tag: string;
	/** Where in the record, such as `api.attributes.size.type`. */
	field: string;
	reason: string;
}

export interface PackBuild {
	/** The committed form, by path relative to the pack's root, as canonical JSON. */
	files: Map<string, string>;
	tags: string[];
	gaps: { tag: string; gaps: PackComponent['gaps'] }[];
	omitted: PackOmission[];
}

type ApiBasis = 'verified' | 'observed' | 'declared';
const RANK: Record<ApiBasis, number> = { declared: 0, observed: 1, verified: 2 };
const best = (bases: ApiBasis[]): ApiBasis =>
	bases.reduce<ApiBasis>((top, basis) => (RANK[basis] > RANK[top] ? basis : top), 'declared');

/** A coverage level as a basis: only a claim verifies, and a case that showed it observed it. */
export function basisOf(level: CoverageLevel | undefined): ApiBasis {
	if (level === 'verified') return 'verified';
	if (level === 'asserted' || level === 'represented') return 'observed';
	return 'declared';
}

const byName = <T extends { name: string }>(items: T[]) =>
	items.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
const sorted = (items: Iterable<string>) => [...new Set(items)].sort();

/** A value as the format writes it: a string, a safe integer, a boolean or `null`. */
function packValue(value: SchemaValue): SchemaValue {
	if (typeof value === 'number' && !Number.isSafeInteger(value)) return String(value);
	return value;
}

/** Whether a value set is `true` and `false` alone, so listing it says nothing. */
const booleanOnly = (values: readonly SchemaValue[]) =>
	values.every((value) => value === true || value === false);

/** The parent's reference: the reference without its last segment. */
const parentRef = (ref: string) => ref.slice(0, ref.lastIndexOf('/'));

/** How an element's accessible name was given, as a reader can repeat it, when it can tell. */
function nameSource(element: ElementObservation): string | undefined {
	const name = element.accessibility?.name;
	if (!name) return undefined;
	const attributes = Object.keys(element.attributes)
		.filter((attribute) => element.attributes[attribute] === name)
		.sort();
	if (attributes[0]) return `from the ${attributes[0]} attribute`;
	// A name that refers to other elements has no source this capture can name.
	if ('aria-labelledby' in element.attributes) return undefined;
	return 'from its text';
}

class Texts {
	readonly omitted: PackOmission[] = [];
	constructor(private readonly tag: string) {}
	/** One line of the manifest's words: whitespace collapsed, or left out when it is too long. */
	line(value: string | undefined, field: string, max: number = PACK_TEXT_LIMITS.statement) {
		if (value === undefined) return undefined;
		const text = value.replace(/\s+/g, ' ').trim();
		if (!text) return undefined;
		// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are refused
		if (/[\u0000-\u001F\u007F-\u009F‪-‮⁦-⁩]/.test(text) || !text.isWellFormed()) {
			this.omitted.push({ tag: this.tag, field, reason: 'It holds a control character.' });
			return undefined;
		}
		if ([...text].length > max) {
			this.omitted.push({ tag: this.tag, field, reason: `It is longer than ${max} characters.` });
			return undefined;
		}
		return text;
	}
	/** An identifier the format can carry, or left out. */
	id(value: string, kind: keyof typeof PACK_PATTERNS, field: string): boolean {
		if (PACK_PATTERNS[kind].test(value)) return true;
		this.omitted.push({ tag: this.tag, field, reason: `It is not a ${kind} the format allows.` });
		return false;
	}
}

interface Rule {
	id: string;
	tags: string[];
	attributes: string[];
}

function componentRecord(
	schema: ComponentSchema,
	input: PackBuildInput,
	rules: readonly Rule[],
	statementLevel: (id: string) => 'verified' | 'authored'
): { record: PackComponent; omitted: PackOmission[] } {
	const { tag } = schema;
	const texts = new Texts(tag);
	const guide = input.guides?.components.find((item) => item.tag === tag);
	const coverage = input.coverage.components.find((item) => item.tag === tag);
	const level = (id: string) => coverage?.obligations.find((item) => item.id === id)?.level;
	const elements = input.cases.flatMap(({ observation }) =>
		observation.channels.elements.filter((element) => element.tag === tag)
	);
	const library = new Set(
		input.schemas.filter((item) => item.tag.startsWith(input.config.prefix)).map((s) => s.tag)
	);

	const attributes: PackComponent['api']['attributes'] = [];
	for (const { member, attribute } of schemaMembers(schema)) {
		if (attribute === undefined || !texts.id(attribute, 'attribute', `api.attributes`)) continue;
		const field = `api.attributes.${attribute}`;
		const values = member.values ?? [];
		const fallback = fallbackValue(member);
		const valueBasis = values.map((value) => ({
			value,
			basis: basisOf(level(`property:${member.name}=${String(value)}`)),
		}));
		// An attribute is known by the states it was seen set to: any other than its default.
		const basis = values.length
			? best(valueBasis.filter(({ value }) => !same(value, fallback)).map((item) => item.basis))
			: elements.some((element) => {
						const written = element.attributes[attribute];
						return written !== undefined && !same(written, defaultValue(member) ?? null);
					})
				? 'observed'
				: 'declared';
		const initial = defaultValue(member);
		const applying = rules.filter((rule) => rule.attributes.includes(attribute)).map((r) => r.id);
		const type = texts.line(member.type, `${field}.type`);
		const description = texts.line(member.description, `${field}.description`);
		attributes.push({
			name: attribute,
			...(schema.properties.includes(member) &&
			texts.id(member.name, 'property', `${field}.property`)
				? { property: member.name }
				: {}),
			...(type ? { type } : {}),
			...(description ? { description } : {}),
			...(values.length && !booleanOnly(values)
				? {
						values: valueBasis.map(({ value, basis }) => ({ value: packValue(value), basis })),
					}
				: {}),
			...(initial === undefined ? {} : { default: packValue(initial) }),
			...(applying.length ? { rules: sorted(applying) } : {}),
			basis,
		});
	}

	const slots: PackComponent['api']['slots'] = [];
	for (const slot of schema.slots) {
		if (!texts.id(slot.name, 'slot', 'api.slots')) continue;
		const key = slot.name || 'default';
		const hosts = new Set(elements.map((element) => element.ref));
		const accepts = sorted(
			input.cases.flatMap(({ observation }) =>
				observation.channels.elements
					.filter(
						(child) =>
							library.has(child.tag) &&
							(child.attributes.slot ?? '') === slot.name &&
							hosts.has(parentRef(child.ref)) &&
							observation.channels.elements.some(
								(host) => host.ref === parentRef(child.ref) && host.tag === tag
							)
					)
					.map((child) => child.tag)
			)
		);
		const description = texts.line(slot.description, `api.slots.${key}.description`);
		slots.push({
			name: slot.name,
			...(description ? { description } : {}),
			...(accepts.length ? { accepts } : {}),
			basis: best([basisOf(level(`slot:${key}=filled`)), basisOf(level(`slot:${key}=empty`))]),
		});
	}

	const events: PackComponent['api']['events'] = [];
	for (const event of schema.events) {
		if (!texts.id(event.name, 'event', 'api.events')) continue;
		const description = texts.line(event.description, `api.events.${event.name}.description`);
		const detail = texts.line(event.type, `api.events.${event.name}.detail`);
		events.push({
			name: event.name,
			...(description ? { description } : {}),
			...(detail ? { detail } : {}),
			basis: basisOf(level(`event:${event.name}`)),
		});
	}

	const commands: PackComponent['api']['commands'] = [];
	for (const command of schema.commands) {
		if (!texts.id(command.id, 'command', 'api.commands')) continue;
		const description = texts.line(
			command.description ?? command.label,
			`api.commands.${command.id}.description`
		);
		commands.push({
			name: command.id,
			...(description ? { description } : {}),
			basis: basisOf(level(`command:${command.id}`)),
		});
	}

	const cssProperties: PackComponent['api']['cssProperties'] = [];
	for (const property of schema.cssProperties) {
		if (!texts.id(property.name, 'cssProperty', 'api.cssProperties')) continue;
		const field = `api.cssProperties.${property.name}`;
		const description = texts.line(property.description, `${field}.description`);
		const initial = texts.line(property.default, `${field}.default`, PACK_TEXT_LIMITS.value);
		cssProperties.push({
			name: property.name,
			...(description ? { description } : {}),
			...(initial ? { default: initial } : {}),
			basis: 'declared',
		});
	}

	const associated = elements.some((element) => element.state.formAssociated === true);

	// A role is observed in the default state, when every instance there agrees on it; a guide
	// states the roles of other states, which stay authored.
	const isDefault = inDefaultState(schema);
	const roles: PackComponent['a11y']['role'] = [];
	const resting = elements.filter(isDefault);
	const seen = sorted(resting.flatMap((element) => element.accessibility?.role ?? []));
	const role = seen.length === 1 ? seen[0] : undefined;
	if (role && resting.every((element) => element.accessibility?.role === role)) {
		if (texts.id(role, 'role', 'a11y.role.default')) {
			const sources = sorted(resting.map((element) => nameSource(element) ?? ''));
			roles.push({
				state: 'default',
				role,
				...(sources.length === 1 && sources[0] ? { name: sources[0] } : {}),
				basis: 'observed',
			});
		}
	} else if (seen.length > 1)
		texts.omitted.push({
			tag,
			field: 'a11y.role.default',
			reason: `Its instances in the default state have different roles: ${seen.join(', ')}.`,
		});
	for (const authored of guide?.roles ?? [])
		if (!roles.some((item) => item.state === authored.state))
			roles.push({
				state: authored.state,
				role: authored.role,
				...(authored.name ? { name: authored.name } : {}),
				basis: 'authored',
			});
	roles.sort((a, b) => (a.state < b.state ? -1 : a.state > b.state ? 1 : 0));

	// The accessibility check counts for the component a case is about, not for every tag it renders.
	const checked = input.cases.flatMap(({ component, observation }) => {
		const axe = observation.channels.a11y.axe;
		return component === tag && axe !== 'not-run' ? [axe] : [];
	});
	const statement = ({ id, text }: { id: string; text: string }) => ({
		id,
		text,
		basis: statementLevel(id),
	});
	const examples = input.examples
		.filter((example) => example.tag === tag)
		.slice(0, input.config.examples ?? 3)
		.map(({ from, html }) => ({ from, html, basis: 'observed' as const }));
	const ruleIds = sorted(
		rules
			.filter(
				(rule) =>
					rule.tags.includes(tag) ||
					attributeNames(schema).some((name) => rule.attributes.includes(name))
			)
			.map((rule) => rule.id)
	);
	const usage = (guide?.usage ?? []).map(statement);
	const a11yStatements = (guide?.a11y ?? []).map(statement);
	const specifier = importOf(input.config, schema);

	const api = {
		attributes: byName(attributes),
		slots: byName(slots),
		events: byName(events),
		commands: byName(commands),
		cssProperties: byName(cssProperties),
		...(associated
			? {
					form: {
						associated: true,
						basis:
							level('form:participation') === 'verified'
								? ('verified' as const)
								: ('observed' as const),
					},
				}
			: {}),
	};
	const gaps: PackComponent['gaps'] = [
		...(guide?.summary ? [] : [{ kind: 'summary' as const }]),
		...(usage.length ? [] : [{ kind: 'usage' as const }]),
		...(a11yStatements.length ? [] : [{ kind: 'a11y-statement' as const }]),
		...(roles.length ? [] : [{ kind: 'role' as const }]),
		...(examples.length ? [] : [{ kind: 'example' as const }]),
		...(['attributes', 'slots'] as const).flatMap((section) =>
			api[section]
				.filter((member) => member.basis === 'declared')
				.map((member) => ({ kind: 'unobserved' as const, section, name: member.name }))
		),
	];
	const record: PackComponent = {
		format: PACK_FORMAT_VERSION,
		tag,
		...(guide?.summary ? { summary: guide.summary } : {}),
		status: guide?.status ?? 'stable',
		...(guide?.replacedBy ? { replacedBy: guide.replacedBy } : {}),
		...(specifier ? { import: specifier } : {}),
		api,
		a11y: {
			role: roles,
			statements: a11yStatements,
			...(checked.length
				? {
						axe: {
							violations: new Set(checked.flatMap((axe) => axe.violations.map((item) => item.id)))
								.size,
							exceptions: sorted(checked.flatMap((axe) => axe.exceptions.map((item) => item.rule))),
							basis: 'observed' as const,
						},
					}
				: {}),
		},
		usage,
		rules: ruleIds,
		examples,
		...(guide?.detail ? { detail: guide.detail } : {}),
		gaps,
	};
	return { record, omitted: texts.omitted };
}

/** The specifier that registers a component, from the configured template and its module. */
export function importOf(config: PackConfig, schema: ComponentSchema): string | undefined {
	if (!config.import) return undefined;
	if (config.import.includes('{module}') && !schema.module) return undefined;
	const specifier = config.import
		.replaceAll('{module}', (schema.module ?? '').replace(/^\.\//, ''))
		.replaceAll('{tag}', schema.tag)
		.replaceAll('{name}', schema.tag.slice(config.prefix.length));
	return PACK_PATTERNS.specifier.test(specifier) ? specifier : undefined;
}

/** The tags a library's pack describes: the schemas whose tag starts with its prefix. */
export function libraryTags(config: PackConfig, schemas: readonly ComponentSchema[]): string[] {
	return sorted(schemas.map((schema) => schema.tag).filter((tag) => tag.startsWith(config.prefix)));
}

/** Build the committed form: one record per library tag, and the library's rules. */
export function buildPack(input: PackBuildInput): PackBuild {
	const { config } = input;
	const levels = new Map(
		(input.guideCoverage?.statements ?? []).map((item) => [item.id.slice('guide:'.length), item])
	);
	const statementLevel = (id: string) =>
		levels.get(id)?.level === 'verified' ? ('verified' as const) : ('authored' as const);
	const tags = libraryTags(config, input.schemas);
	const rules: Rule[] = (input.guides?.rules ?? []).map((rule) => ({
		id: rule.id,
		tags: rule.appliesTo.tags ?? [],
		attributes: rule.appliesTo.attributes ?? [],
	}));
	const files = new Map<string, string>();
	const gaps: PackBuild['gaps'] = [];
	const omitted: PackOmission[] = [];
	for (const tag of tags) {
		const schema = input.schemas.find((item) => item.tag === tag) as ComponentSchema;
		const built = componentRecord(schema, input, rules, statementLevel);
		files.set(`data/${config.library}/components/${tag}.json`, canonicalJson(built.record));
		gaps.push({ tag, gaps: built.record.gaps });
		omitted.push(...built.omitted);
	}
	const rulesFile: PackRules = {
		format: PACK_FORMAT_VERSION,
		library: config.library,
		rules: (input.guides?.rules ?? [])
			.map((rule) => ({
				id: rule.id,
				text: rule.text,
				appliesTo: {
					...(rule.appliesTo.tags ? { tags: sorted(rule.appliesTo.tags) } : {}),
					...(rule.appliesTo.attributes ? { attributes: sorted(rule.appliesTo.attributes) } : {}),
				},
				basis: statementLevel(rule.id),
			}))
			.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
	};
	files.set(`rules/${config.library}.json`, canonicalJson(rulesFile));
	return { files, tags, gaps, omitted };
}
