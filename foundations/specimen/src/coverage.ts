import type { ComponentSchema, PropertySchema, SchemaValue } from './plugin.js';
import type {
	ClaimRecord,
	CoverageWaivers,
	ElementObservation,
	ExpectationRecord,
	Observation,
} from './types.js';

/**
 * What a run shows of a component's required partitions. A schema says which states a component
 * can have, not that anything exercised them, so a level is earned only from observations: an
 * element with the component's tag, seen in that state at a recorded checkpoint.
 */

/** The obligations this version requires of a component; a report names the version it used. */
export const COVERAGE_OBLIGATIONS = 'schema-partitions@1';

/**
 * `represented`: observed in that state. `asserted`: in that state, and a claim's expectations
 * ran and held, without being about this. `verified`: they were. `missing`: no specimen shows it.
 * `unknown`: the capture could not tell. Only `verified` counts toward completion.
 */
export type CoverageLevel = 'verified' | 'asserted' | 'represented' | 'missing' | 'unknown';

export interface CoverageEvidence {
	specimen: string;
	checkpoint: string;
	/** The element's reference within the capture. */
	target: string;
	/** The expectations a claim links to this state. */
	expectations?: string[];
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
	/** Why it is not required, from the configuration's waivers. */
	waiver?: string;
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
export interface InvalidClaim {
	specimen: string;
	target: string;
	obligation: string;
	reason: string;
}
export interface CoverageReport {
	complete: boolean;
	components: ComponentCoverage[];
	counts: Record<CoverageLevel, number>;
	waived: number;
	unusedWaivers: CoverageWaivers['entries'];
	invalidClaims: InvalidClaim[];
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

type Holds = (element: ElementObservation) => boolean;

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
		evidence: matches.slice(0, MAX_EVIDENCE).map(({ specimen, checkpoint, element }) => ({
			specimen,
			checkpoint,
			target: element.ref,
		})),
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
): { coverage: ComponentCoverage; holds: Map<string, Holds> } {
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
	const holds = new Map<string, Holds>();
	const state = (id: string, kind: CoverageObligation['kind'], test: Holds, absent: string) => {
		holds.set(id, test);
		obligations.push(
			obligation(
				id,
				kind,
				targets.filter(({ element }) => test(element)),
				rendered ? absent : none
			)
		);
	};

	state(
		'default',
		'default',
		(element) =>
			finite.every(({ member, attribute }) => {
				const observed = read(element, member, attribute);
				const fallback = defaultValue(member) ?? (member.values?.includes(false) ? false : null);
				return observed === undefined || same(observed, fallback as SchemaValue);
			}),
		'No case shows every finite member at its default.'
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
				holds.set(id, (element) => same(read(element, member, attribute), value));
				continue;
			}
			state(
				id,
				'property',
				(element) => same(read(element, member, attribute), value),
				`No case shows ${member.name} as ${String(value)}.`
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
			state(
				`slot:${name || 'default'}=${partition}`,
				'slot',
				(element) => {
					const count = element.state[key];
					return typeof count === 'number' && test(count);
				},
				`No case shows ${label} ${partition}.`
			);
	}
	for (const { name } of schema.events) {
		const seen = cases
			.filter(({ observation }) =>
				observation.channels.events.history.some((event) => event.type === name)
			)
			.flatMap(({ id }) => targets.filter((target) => target.specimen === id).slice(0, 1));
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

	return {
		coverage: {
			tag: schema.tag,
			sources: schema.sources,
			cases: rendered,
			obligations,
			counts: { verified: 0, asserted: 0, represented: 0, missing: 0, unknown: 0 },
			openEnded: members
				.filter(({ member }) => !member.values?.length)
				.map(({ member }) => member.name),
			unknownToSchema: schema.unknown,
		},
		holds,
	};
}

/** Why these expectations do not prove this obligation on this target, or `null` when they do. */
function unproven(
	id: string,
	claim: ClaimRecord,
	ran: ExpectationRecord[],
	commands: readonly string[]
): string | null {
	const onTarget = (record: ExpectationRecord) =>
		record.target === claim.target || record.kind === 'play';
	if (!ran.some(onTarget)) return `No expectation it names is about '${claim.target}'.`;
	if (id.startsWith('event:')) {
		const name = id.slice('event:'.length);
		if (!ran.some((record) => record.kind === 'event' && record.event === name))
			return `No expectation it names saw the event '${name}'.`;
	}
	if (id.startsWith('command:')) {
		const name = id.slice('command:'.length);
		if (!commands.includes(name)) return `The scenario did not run the command '${name}'.`;
	}
	if (id === 'form:participation' && !ran.some((record) => record.kind === 'form'))
		return 'No expectation it names read real FormData.';
	if (id === 'form:validity' && !ran.some((record) => record.kind === 'validity'))
		return 'No expectation it names read checkValidity().';
	return null;
}

const RANK: Record<CoverageLevel, number> = {
	missing: 0,
	unknown: 0,
	represented: 1,
	asserted: 2,
	verified: 3,
};

/** Raise obligations by the claims these captures hold, and report those they cannot honor. */
function applyClaims(
	components: ComponentCoverage[],
	holds: Map<string, Map<string, Holds>>,
	cases: readonly CoverageCase[]
): InvalidClaim[] {
	const invalid: InvalidClaim[] = [];
	for (const { id: specimen, observation } of cases) {
		const checkpoint = observation.manifest.checkpoint.name;
		const { claims, expectations, commands } = observation.channels.evidence;
		for (const claim of claims.filter((item) => item.checkpoint === checkpoint)) {
			const fail = (reason: string) =>
				invalid.push({ specimen, target: claim.target, obligation: claim.obligation, reason });
			const element = observation.channels.elements.find((item) => item.ref === claim.ref);
			if (!element) {
				fail(`'${claim.target}' did not resolve to an element in the capture.`);
				continue;
			}
			const component = components.find((item) => item.tag === element.tag);
			if (!component) continue;
			const owed = component.obligations.find((item) => item.id === claim.obligation);
			if (!owed) {
				fail(`<${element.tag}> has no obligation '${claim.obligation}'.`);
				continue;
			}
			const ran = expectations.filter((record) => claim.expectations.includes(record.id));
			const unrun = claim.expectations.filter((id) => !ran.some((record) => record.id === id));
			if (unrun.length) {
				fail(`Expectations did not run: ${unrun.join(', ')}.`);
				continue;
			}
			// A claim about a state the target is not in is false, and proves nothing at any level.
			const holding = holds.get(element.tag)?.get(claim.obligation);
			if (holding && !holding(element)) {
				fail(`'${claim.target}' was not observed in this state at ${checkpoint}.`);
				continue;
			}
			const why = unproven(claim.obligation, claim, ran, commands);
			const level: CoverageLevel = why ? 'asserted' : 'verified';
			if (RANK[level] < RANK[owed.level]) continue;
			if (RANK[level] > RANK[owed.level]) owed.evidence = [];
			owed.level = level;
			if (why) owed.reason = why;
			else delete owed.reason;
			owed.evidenceCount = owed.evidence.length + 1;
			owed.evidence = [
				...owed.evidence,
				{ specimen, checkpoint, target: element.ref, expectations: claim.expectations },
			].slice(0, MAX_EVIDENCE);
		}
	}
	return invalid;
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
	cases: readonly CoverageCase[],
	waivers?: CoverageWaivers
): CoverageReport {
	const built = [...schemas].map((schema) => componentCoverage(schema, cases));
	const components = built.map(({ coverage }) => coverage);
	const invalidClaims = applyClaims(
		components,
		new Map(built.map(({ coverage, holds }) => [coverage.tag, holds])),
		cases
	);
	const counts: Record<CoverageLevel, number> = {
		verified: 0,
		asserted: 0,
		represented: 0,
		missing: 0,
		unknown: 0,
	};
	const unusedWaivers: CoverageWaivers['entries'] = [];
	for (const entry of waivers?.entries ?? []) {
		const owed = components
			.find((component) => component.tag === entry.component)
			?.obligations.find((item) => item.id === entry.obligation);
		if (owed) owed.waiver = entry.reason;
		else unusedWaivers.push(entry);
	}
	let waived = 0;
	let open = 0;
	for (const component of components)
		for (const { level, waiver } of component.obligations) {
			component.counts[level]++;
			counts[level]++;
			if (waiver) waived++;
			else if (level !== 'verified') open++;
		}
	return {
		complete: components.length > 0 && open === 0 && invalidClaims.length === 0,
		components,
		counts,
		waived,
		unusedWaivers,
		invalidClaims,
	};
}
