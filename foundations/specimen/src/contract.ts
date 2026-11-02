import { access, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { LoadedConfig } from './config.js';
import type { ComponentSchema } from './plugin.js';
import { DEFAULT_SUITE_WORKERS, pool, selectEntries } from './suite.js';
import type {
	ContractFinding,
	ContractRequest,
	ContractRun,
	ElementObservation,
	InspectResult,
	Observation,
	SpecimenEntry,
	StoryOutcome,
} from './types.js';

/**
 * The story contract FAST-AF's Fastbot enforces, on evidence from a run instead of source text.
 * Each code is the rule it replaces, so that the two can run side by side until a rule retires.
 * This is parity, not coverage: it asks what Fastbot asks, and coverage asks more.
 */
export const CONTRACT_RULES = 'fastbot-parity@1';

/** Attributes that need a story showing them, as Fastbot lists them. */
const STATE_ATTRIBUTES = ['disabled', 'invalid', 'readonly', 'checked', 'selected', 'busy'];
const BASELINE = /overview|default/i;
/** How a story file documents turning axe off, when no parameter does. */
const EXCEPTION_COMMENT = /A11Y_EXCEPTION:/;

export interface ContractHost {
	config: LoadedConfig;
	prepare(): Promise<void>;
	inspect(id: string): Promise<InspectResult>;
	runStory(
		id: string,
		timeoutMs: number | undefined,
		observe: Record<string, string[]>
	): Promise<{ outcome: StoryOutcome; observation: Observation | null }>;
}

interface Ran {
	entry: SpecimenEntry;
	outcome: StoryOutcome;
	observation: Observation | null;
}

const SUGGESTIONS: Record<string, string> = {
	MISSING_STORY: 'Add a story file next to the component, named for it.',
	MISSING_GLOBAL_A11Y_ERROR_POLICY: "Set parameters.a11y.test to 'error' in the preview.",
	MISSING_AUTODOCS_TAG: "Add tags: ['autodocs'] to the story file's default export.",
	MISSING_PLAY_FUNCTION: 'Add a play function that asserts what the story is for.',
	MISSING_DOCS_DESCRIPTION: 'Describe the component in parameters.docs.description.',
	MISSING_STORY_EXPORT: 'Export at least one named story from the file.',
	MISSING_BASELINE_STORY: 'Add a story named Overview or Default.',
	MISSING_STATE_STORY: 'Add a story that renders the component in this state.',
	MISSING_FORMDATA_ASSERTION:
		'In a play, read new FormData(form) with the component in the form, and assert on it.',
	MISSING_VALIDITY_ASSERTION: "In a play, call the component's checkValidity() and assert on it.",
	UNDOCUMENTED_A11Y_EXCEPTION:
		'Set parameters.a11yException to why this is valid, or restore the check.',
};

/**
 * Whether an element shows a state at capture: its attribute, its live property, or the
 * `data-` attribute a component derives from other inputs, as FAST-AF's `data-invalid` is.
 */
function shows(element: ElementObservation, attribute: string, property: string): boolean {
	for (const name of [attribute, `data-${attribute}`]) {
		const written = element.attributes[name];
		if (written !== undefined && written !== 'false') return true;
	}
	return element.state[`prop:${property}`] === true || element.state[property] === true;
}

/** The state members a component has, among those that need a story. */
function stateMembers(schema: ComponentSchema): { attribute: string; property: string }[] {
	return [...schema.properties, ...schema.attributes]
		.map((member) => ({ attribute: member.attribute ?? member.name, property: member.name }))
		.filter(({ attribute }) => STATE_ATTRIBUTES.includes(attribute));
}

const exists = (file: string) =>
	access(file).then(
		() => true,
		() => false
	);

export async function runContract(
	{ config, prepare, inspect, runStory }: ContractHost,
	request: ContractRequest
): Promise<ContractRun> {
	const started = performance.now();
	const base = config.manifestDirectory;
	if (!base)
		throw new Error('The story contract needs a custom elements manifest in the configuration.');
	const storyFileOf = (schema: ComponentSchema) =>
		schema.module ? join(base, schema.module.replace(/\.[cm]?[jt]s$/, '.stories.ts')) : null;
	const all = Object.values(config.schemas);
	if (request.component && !config.schemas[request.component])
		throw new Error(`The manifest does not describe ${request.component}.`);

	// One component's own story file, or those a filter selects, or everything.
	const own = request.component
		? storyFileOf(config.schemas[request.component] as ComponentSchema)
		: null;
	const entries = selectEntries(
		config.entries,
		own ? { file: own } : request.filter,
		config.root
	).filter((entry) => entry.story);
	const selectedFiles = new Set(entries.map((entry) => resolve(config.root, entry.module)));
	const scoped = request.component || request.filter;
	const components = all.filter((schema) => {
		if (request.component) return schema.tag === request.component;
		if (!request.filter) return true;
		const file = storyFileOf(schema);
		return file !== null && selectedFiles.has(file);
	});

	const workers = request.workers ?? config.config.test?.workers ?? DEFAULT_SUITE_WORKERS;
	await prepare();
	const observe = Object.fromEntries(
		components.map((schema) => [schema.tag, stateMembers(schema).map((member) => member.property)])
	);
	const failed: ContractRun['cases']['failed'] = [];
	const ran: Ran[] = [];
	await pool(entries, workers, async (entry) => {
		try {
			const { outcome, observation } = await runStory(entry.id, request.timeoutMs, observe);
			if (outcome.status === 'failed')
				failed.push({
					id: entry.id,
					message: outcome.failures[0]?.message ?? 'The story failed.',
				});
			ran.push({ entry, outcome, observation });
		} catch (error) {
			failed.push({
				id: entry.id,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	});

	const findings: ContractFinding[] = [];
	const find = (
		code: string,
		message: string,
		where: { component?: string; file?: string; attribute?: string },
		severity: ContractFinding['severity'] = 'error'
	) =>
		findings.push({
			code,
			severity,
			message,
			suggestion: SUGGESTIONS[code] ?? 'Fix this and run the contract again.',
			...where,
		});
	const relative = (file: string) =>
		file.startsWith(`${config.root}/`) ? `./${file.slice(config.root.length + 1)}` : file;

	// The preview's own policy, not any story's: what a story that says nothing inherits.
	const first = entries[0];
	if (first) {
		const policy = (await inspect(first.id)).story?.projectPolicy;
		if (policy !== 'error')
			find(
				'MISSING_GLOBAL_A11Y_ERROR_POLICY',
				`The preview's accessibility policy is ${policy ?? 'not set'}, not error.`,
				{}
			);
	}

	const byFile = new Map<string, Ran[]>();
	for (const item of ran) {
		const file = resolve(config.root, item.entry.module);
		byFile.set(file, [...(byFile.get(file) ?? []), item]);
	}

	for (const schema of components) {
		const file = storyFileOf(schema);
		if (!file) continue;
		const component = schema.tag;
		if (!(await exists(file))) {
			find('MISSING_STORY', `<${component}> has no story file next to it.`, {
				component,
				file: relative(file),
			});
			continue;
		}
		const cases = byFile.get(file) ?? [];
		const where = { component, file: relative(file) };
		if (
			!cases.length &&
			!config.entries.some((entry) => resolve(config.root, entry.module) === file)
		) {
			find('MISSING_STORY_EXPORT', 'The story file exports no story.', where);
			continue;
		}
		const elements = cases.flatMap(({ observation }) =>
			(observation?.channels.elements ?? []).filter((element) => element.tag === component)
		);
		// A play may set a state, assert on it and clear it, so what was set counts too.
		const set = new Set(
			cases.flatMap(({ observation }) => observation?.channels.evidence.attributesSet ?? [])
		);
		for (const { attribute, property } of stateMembers(schema))
			if (
				!set.has(`${component}:${attribute}`) &&
				!elements.some((element) => shows(element, attribute, property))
			)
				find('MISSING_STATE_STORY', `No story in this file shows <${component}> as ${attribute}.`, {
					...where,
					attribute,
				});
		if (elements.some((element) => element.state.formAssociated === true)) {
			const evidence = cases.map(({ observation }) => observation?.channels.evidence);
			if (!evidence.some((item) => item?.formData.includes(component)))
				find(
					'MISSING_FORMDATA_ASSERTION',
					`No play read FormData from a form holding <${component}>.`,
					where
				);
			if (!evidence.some((item) => item?.validity.includes(component)))
				find(
					'MISSING_VALIDITY_ASSERTION',
					`No play checked the validity of <${component}>.`,
					where
				);
		}
	}

	// A story file's own rules, whether or not the manifest names a component for it.
	for (const [file, cases] of byFile) {
		const where = { file: relative(file) };
		if (!cases.some(({ entry }) => entry.story?.tags.includes('autodocs')))
			find('MISSING_AUTODOCS_TAG', 'No story in this file has the autodocs tag.', where);
		if (!cases.some(({ outcome }) => outcome.play === 'ran'))
			find('MISSING_PLAY_FUNCTION', 'No story in this file ran a play.', where);
		if (!cases.some(({ entry }) => BASELINE.test(entry.exportName)))
			find('MISSING_BASELINE_STORY', 'No story here is named like Overview or Default.', where);
		let described = false;
		for (const { entry } of cases) {
			const docs = (await inspect(entry.id)).story?.parameters.docs as
				| { description?: unknown }
				| undefined;
			if (docs?.description) {
				described = true;
				break;
			}
		}
		if (!described)
			find('MISSING_DOCS_DESCRIPTION', 'No story here has a docs description.', where, 'warning');
		const off = cases.filter(({ outcome }) => ['off', 'disabled'].includes(outcome.a11y.policy));
		if (off.length) {
			const documented = EXCEPTION_COMMENT.test(await readFile(file, 'utf8'));
			for (const { entry } of off) {
				const parameters = (await inspect(entry.id)).story?.parameters;
				if (!documented && !parameters?.a11yException)
					find(
						'UNDOCUMENTED_A11Y_EXCEPTION',
						`${entry.id} turns axe off without saying why.`,
						where
					);
			}
		}
	}

	const errors = findings.filter((finding) => finding.severity === 'error').length;
	return {
		rules: CONTRACT_RULES,
		valid: errors === 0 && failed.length === 0,
		findings,
		counts: { errors, warnings: findings.length - errors },
		stats: {
			components: components.length,
			storyFiles: byFile.size,
			scoped: Boolean(scoped),
		},
		cases: {
			total: entries.length,
			passed: ran.filter(({ outcome }) => outcome.status === 'passed').length,
			failed: failed.sort((a, b) => a.id.localeCompare(b.id, 'en-US')),
		},
		workers,
		elapsedMs: performance.now() - started,
	};
}
