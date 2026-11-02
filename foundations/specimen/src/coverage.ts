import type { ComponentSchema, PropertySchema, SchemaValue } from './plugin.js';
import type { ElementObservation, Observation } from './types.js';

/**
 * What a run shows of a component's required partitions. A schema says which states a component
 * can have, not that anything exercised them, so a level is earned only from observations: an
 * element with the component's tag, seen in that state at a recorded checkpoint.
 */

/** The obligations this version requires of a component; a report names the version it used. */
export const COVERAGE_OBLIGATIONS = 'schema-partitions@1';

/**
 * `represented`: observed in that state. `asserted` and `verified` need a claim linking an
 * expectation to the state. `missing`: no specimen shows it. `unknown`: the capture could not
 * tell. Only `verified` counts toward completion.
 */
export type CoverageLevel = 'verified' | 'asserted' | 'represented' | 'missing' | 'unknown';

export interface CoverageEvidence {
	specimen: string;
	checkpoint: string;
	/** The element's reference within the capture. */
	target: string;
}
export interface CoverageObligation {
	/** Such as `default`, `property:size=small`, `slot:after=filled` or `event:change`. */
	id: string;
	kind: 'default' | 'property' | 'slot' | 'event' | 'command' | 'form';
	level: CoverageLevel;
	/** The first few cases that show it; `evidenceCount` is how many do. */
	evidence: CoverageEvidence[];
	evidenceCount: number;
	reason?: string;
}
export interface ComponentCoverage {
	tag: string;
	sources: string[];
	/** How many cases render this component, directly or inside another. */
	cases: number;
	obligations: CoverageObligation[];
	counts: Record<CoverageLevel, number>;
	/** Members with no finite partition: open-ended, so nothing is required of them until declared. */
	openEnded: string[];
	/** What the schema's sources could not say. */
	unknownToSchema: string[];
}

const MAX_EVIDENCE = 3;

/** A case's capture, from a run that passed. */
export interface CoverageCase {
	id: string;
	observation: Observation;
}

interface Target {
	specimen: string;
	checkpoint: string;
	element: ElementObservation;
}

/** A manifest's default, as written in source: `"primary"`, `false`, `undefined`. */
function defaultValue(member: PropertySchema): SchemaValue | undefined {
	const written = member.default?.trim();
	if (written === undefined || written === 'undefined') return undefined;
	if (written === 'true') return true;
	if (written === 'false') return false;
	if (written === 'null') return null;
	const number = Number(written);
	if (written !== '' && !Number.isNaN(number)) return number;
	return written.replace(/^(['"`])(.*)\1$/, '$2');
}

/** Whether a capture can read this member at all: only through its attribute or live state. */
function attributeOf(member: PropertySchema, isAttribute: boolean): string | undefined {
	return member.attribute ?? (isAttribute ? member.name : undefined);
}

/** The member's value on this element, or `undefined` when the element does not say. */
function read(
	element: ElementObservation,
	member: PropertySchema,
	attribute: string | undefined
): SchemaValue | undefined {
	const live = element.state[`prop:${member.name}`] ?? element.state[member.name];
	if (live !== undefined) return live;
	if (attribute === undefined) return undefined;
	const written = element.attributes[attribute];
	const boolean = member.values?.includes(true) || member.values?.includes(false);
	if (boolean) return written !== undefined && written !== 'false';
	if (written === undefined) return defaultValue(member) ?? null;
	return written;
}

const same = (observed: SchemaValue | undefined, value: SchemaValue) =>
	observed !== undefined &&
	(observed === value ||
		(observed !== null && value !== null && String(observed) === String(value)));

function obligation(
	id: string,
	kind: CoverageObligation['kind'],
	matches: Target[],
	absent: string
): CoverageObligation {
	return {
		id,
		kind,
		level: matches.length ? 'represented' : 'missing',
		evidence: matches
			.slice(0, MAX_EVIDENCE)
			.map(({ specimen, checkpoint, element }) => ({ specimen, checkpoint, target: element.ref })),
		evidenceCount: matches.length,
		...(matches.length ? {} : { reason: absent }),
	};
}

function unknown(id: string, kind: CoverageObligation['kind'], reason: string): CoverageObligation {
	return { id, kind, level: 'unknown', evidence: [], evidenceCount: 0, reason };
}

function componentCoverage(
	schema: ComponentSchema,
	cases: readonly CoverageCase[]
): ComponentCoverage {
	const targets: Target[] = cases.flatMap(({ id, observation }) =>
		observation.channels.elements
			.filter((element) => element.tag === schema.tag)
			.map((element) => ({
				specimen: id,
				checkpoint: observation.manifest.checkpoint.name,
				element,
			}))
	);
	const rendered = new Set(targets.map((target) => target.specimen)).size;
	const none = `No case renders <${schema.tag}>.`;
	const members = [
		...schema.properties.map((member) => ({ member, attribute: attributeOf(member, false) })),
		...schema.attributes.map((member) => ({ member, attribute: attributeOf(member, true) })),
	];
	const finite = members.filter(({ member }) => member.values?.length);
	const obligations: CoverageObligation[] = [];

	obligations.push(
		obligation(
			'default',
			'default',
			targets.filter(({ element }) =>
				finite.every(({ member, attribute }) => {
					const observed = read(element, member, attribute);
					const fallback = defaultValue(member) ?? (member.values?.includes(false) ? false : null);
					return observed === undefined || same(observed, fallback as SchemaValue);
				})
			),
			rendered ? 'No case shows every finite member at its default.' : none
		)
	);
	for (const { member, attribute } of finite) {
		const observable = targets.some(
			({ element }) => read(element, member, attribute) !== undefined
		);
		for (const value of member.values ?? []) {
			const id = `property:${member.name}=${String(value)}`;
			if (targets.length && !observable) {
				obligations.push(
					unknown(id, 'property', `${member.name} could not be read on any <${schema.tag}>.`)
				);
				continue;
			}
			obligations.push(
				obligation(
					id,
					'property',
					targets.filter(({ element }) => same(read(element, member, attribute), value)),
					rendered ? `No case shows ${member.name} as ${String(value)}.` : none
				)
			);
		}
	}
	for (const { name } of schema.slots) {
		const key = `slot:${name}`;
		const label = name || 'the default slot';
		for (const [partition, test] of [
			['filled', (count: number) => count > 0],
			['empty', (count: number) => count === 0],
		] as const)
			obligations.push(
				obligation(
					`slot:${name || 'default'}=${partition}`,
					'slot',
					targets.filter(({ element }) => {
						const count = element.state[key];
						return typeof count === 'number' && test(count);
					}),
					rendered ? `No case shows ${label} ${partition}.` : none
				)
			);
	}
	for (const { name } of schema.events) {
		const seen = cases
			.filter(({ observation }) =>
				observation.channels.events.history.some((event) => event.type === name)
			)
			.flatMap(({ id, observation }) =>
				targets
					.filter((target) => target.specimen === id)
					.slice(0, 1)
					.map((target) => ({ ...target, checkpoint: observation.manifest.checkpoint.name }))
			);
		obligations.push(
			seen.length
				? obligation(`event:${name}`, 'event', seen, '')
				: rendered
					? unknown(`event:${name}`, 'event', 'No case that renders it declares this event.')
					: obligation(`event:${name}`, 'event', [], none)
		);
	}
	for (const { id } of schema.commands)
		obligations.push(
			rendered
				? unknown(`command:${id}`, 'command', 'No claim links a command step to this component.')
				: obligation(`command:${id}`, 'command', [], none)
		);
	if (targets.some(({ element }) => element.state.formAssociated === true))
		for (const [id, what] of [
			['form:participation', 'its FormData entries'],
			['form:validity', 'its validity'],
		] as const)
			obligations.push(unknown(id, 'form', `No claim links an expectation to ${what}.`));

	const counts: Record<CoverageLevel, number> = {
		verified: 0,
		asserted: 0,
		represented: 0,
		missing: 0,
		unknown: 0,
	};
	for (const { level } of obligations) counts[level]++;
	return {
		tag: schema.tag,
		sources: schema.sources,
		cases: rendered,
		obligations,
		counts,
		openEnded: members
			.filter(({ member }) => !member.values?.length)
			.map(({ member }) => member.name),
		unknownToSchema: schema.unknown,
	};
}

/** The properties with finite partitions, by tag: what a coverage run reads live on its targets. */
export function observedProperties(schemas: Iterable<ComponentSchema>): Record<string, string[]> {
	return Object.fromEntries(
		[...schemas].map((schema) => [
			schema.tag,
			schema.properties.filter((member) => member.values?.length).map((member) => member.name),
		])
	);
}

/** Each schema's required partitions, at the level these captures earn. */
export function computeCoverage(
	schemas: Iterable<ComponentSchema>,
	cases: readonly CoverageCase[]
): ComponentCoverage[] {
	return [...schemas].map((schema) => componentCoverage(schema, cases));
}
