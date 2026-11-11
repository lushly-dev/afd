import { type CoverageCase, GUIDE_PREFIX } from './coverage.js';
import { attributeNames, type LoadedGuides } from './guides.js';
import type { ComponentSchema } from './plugin.js';
import type { GuideCoverage, GuideLevel, GuideStatementCoverage } from './types.js';

/**
 * The guide statements' obligation set. Each statement is an obligation, `guide:<id>`, verified
 * only by a claim whose check ran and held in a case that passed. It has its own counts, invalid
 * claims and `complete`, so a statement nobody claims never touches `schema-partitions@1`.
 */
export const GUIDE_OBLIGATIONS = 'guides@1';

const MAX_EVIDENCE = 3;

interface Statement {
	coverage: GuideStatementCoverage;
	/** Whether the statement is about a component with this tag. */
	appliesTo(tag: string): boolean;
	/** What it is about, for a claim on something else. */
	about: string;
}

function statements(
	guides: LoadedGuides | undefined,
	schemas: ReadonlyMap<string, ComponentSchema>
): Map<string, Statement> {
	const found = new Map<string, Statement>();
	const add = (id: string, statement: Statement) => {
		// `specimen-validate` reports a duplicate id; the first one stands, as there.
		if (!found.has(id)) found.set(id, statement);
	};
	const entry = (
		id: string,
		kind: GuideStatementCoverage['kind'],
		file: string,
		tag?: string
	): GuideStatementCoverage => ({
		id: `${GUIDE_PREFIX}${id}`,
		kind,
		...(tag === undefined ? {} : { tag }),
		file,
		level: 'authored',
		evidence: [],
		evidenceCount: 0,
	});
	for (const guide of guides?.components ?? [])
		for (const kind of ['usage', 'a11y'] as const)
			for (const { id } of guide[kind] ?? [])
				add(id, {
					coverage: entry(id, kind, guide.file, guide.tag),
					appliesTo: (tag) => tag === guide.tag,
					about: `<${guide.tag}>`,
				});
	for (const rule of guides?.rules ?? []) {
		const { tags = [], attributes = [] } = rule.appliesTo;
		add(rule.id, {
			coverage: entry(rule.id, 'rule', rule.file),
			appliesTo: (tag) => {
				if (tags.includes(tag)) return true;
				const schema = schemas.get(tag);
				return schema !== undefined && attributeNames(schema).some((a) => attributes.includes(a));
			},
			about: [
				...tags.map((tag) => `<${tag}>`),
				...attributes.map((attribute) => `a component with '${attribute}'`),
			].join(' or '),
		});
	}
	return found;
}

/**
 * Each guide statement at the level these captures earn. With `component`, only the statements
 * about it, and only claims on it.
 */
export function computeGuideCoverage(
	guides: LoadedGuides | undefined,
	schemas: Iterable<ComponentSchema>,
	cases: readonly CoverageCase[],
	component?: string
): GuideCoverage {
	const byTag = new Map([...schemas].map((schema) => [schema.tag, schema]));
	const all = statements(guides, byTag);
	const invalidClaims: GuideCoverage['invalidClaims'] = [];
	// In case order, whatever order the workers finished in.
	const ordered = [...cases].sort((a, b) => a.id.localeCompare(b.id, 'en-US'));
	for (const { id: specimen, observation } of ordered) {
		const checkpoint = observation.manifest.checkpoint.name;
		const { claims, expectations } = observation.channels.evidence;
		for (const claim of claims) {
			if (claim.checkpoint !== checkpoint || !claim.obligation.startsWith(GUIDE_PREFIX)) continue;
			const element = observation.channels.elements.find((item) => item.ref === claim.ref);
			if (component !== undefined && element?.tag !== component) continue;
			const fail = (reason: string) =>
				invalidClaims.push({
					specimen,
					target: claim.target,
					obligation: claim.obligation,
					reason,
				});
			if (!element) {
				fail(`'${claim.target}' did not resolve to an element in the capture.`);
				continue;
			}
			const id = claim.obligation.slice(GUIDE_PREFIX.length);
			const statement = all.get(id);
			if (!statement) {
				fail(`No guide states '${id}'.`);
				continue;
			}
			if (claim.source === 'play' && claim.checked !== true) {
				fail('A story’s guide claim needs its check: pass it to claim(), which runs it.');
				continue;
			}
			if (!statement.appliesTo(element.tag)) {
				fail(`'${id}' is about ${statement.about}, not <${element.tag}>.`);
				continue;
			}
			const ran = expectations.filter((record) => claim.expectations.includes(record.id));
			const unrun = claim.expectations.filter((name) => !ran.some((record) => record.id === name));
			if (unrun.length) {
				fail(`Expectations did not run: ${unrun.join(', ')}.`);
				continue;
			}
			if (!ran.some((record) => record.target === claim.target || record.kind === 'play')) {
				fail(`No expectation it names is about '${claim.target}'.`);
				continue;
			}
			const owed = statement.coverage;
			owed.level = 'verified';
			owed.evidenceCount++;
			if (owed.evidence.length < MAX_EVIDENCE)
				owed.evidence.push({
					specimen,
					checkpoint,
					target: element.ref,
					expectations: claim.expectations,
				});
		}
	}
	const wanted = [...all.values()].filter(
		(statement) => component === undefined || statement.appliesTo(component)
	);
	const counts: Record<GuideLevel, number> = { verified: 0, authored: 0 };
	for (const { coverage } of wanted) counts[coverage.level]++;
	return {
		obligations: GUIDE_OBLIGATIONS,
		complete: wanted.length > 0 && counts.authored === 0 && invalidClaims.length === 0,
		statements: wanted.map(({ coverage }) => coverage),
		counts,
		invalidClaims,
	};
}
