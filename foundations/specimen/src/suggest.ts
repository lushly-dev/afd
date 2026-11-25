import { DEFAULT_PATTERN_LIBRARY, matchesPatternRef, parsePatternFilter } from './pattern-gates.js';
import type { LoadedPatterns } from './patterns.js';
import type { ComponentSchema, PropertySchema, SchemaValue } from './plugin.js';
import type { PatternFile, PatternSetupBinding, SuggestRun } from './types.js';

/**
 * Proposed specimens for a component's gaps: a starting point an agent runs and corrects. Nothing
 * here is evidence. What a generator can derive from the schema it writes as an expectation that
 * holds or fails on its merits. What only a person knows, such as what a command changes, it
 * writes as an expectation that fails until someone replaces it, so that it can never pass unread.
 */

/** In an expectation only a person can complete: it fails until replaced. */
export const REPLACE_ME = 'REPLACE_WITH_WHAT_THIS_SHOULD_BE';

export const PATTERN_GAP_PREFIX = 'pattern:';

interface PatternKeepCandidate {
	library: string;
	external: boolean;
	pattern: PatternFile;
	statementId: string;
	gateName?: string;
}

function findPatternKeep(
	patterns: LoadedPatterns | undefined,
	localLibrary: string | undefined,
	obligation: string,
	patternFilter?: string
): PatternKeepCandidate | string {
	if (!patterns) return `No patterns are configured to resolve '${obligation}'.`;
	const rest = obligation.slice(PATTERN_GAP_PREFIX.length);
	const parsed = parsePatternFilter(rest);
	const wantedLib = parsed.library;
	const colon = parsed.pattern.indexOf(':');
	const qualifiedPattern = colon >= 0 ? parsed.pattern.slice(0, colon) : undefined;
	const statementId = colon >= 0 ? parsed.pattern.slice(colon + 1) : parsed.pattern;
	const localLib = localLibrary ?? DEFAULT_PATTERN_LIBRARY;
	const filterLib = patternFilter ? parsePatternFilter(patternFilter).library : undefined;
	// Per spec §4.5: `pattern:<id>` resolves in the local library; `pattern:<library>/<id>`
	// resolves in the named library (unless `patternFilter` explicitly targets an external library).
	const effectiveLib = wantedLib ?? filterLib;

	const candidates: PatternKeepCandidate[] = [];
	const searchLocal = effectiveLib === undefined || effectiveLib === localLib;
	if (searchLocal) {
		for (const local of patterns.patterns) {
			if (qualifiedPattern !== undefined && local.pattern !== qualifiedPattern) continue;
			if (patternFilter !== undefined && !matchesPatternRef(localLib, local.pattern, patternFilter))
				continue;
			const keep = local.keep?.find((item) => item.id === statementId);
			if (keep) {
				candidates.push({
					library: localLib,
					external: false,
					pattern: local,
					statementId: keep.id,
					...(keep.gate ? { gateName: keep.gate } : {}),
				});
			}
		}
	}
	if (effectiveLib !== undefined) {
		for (const ext of Object.values(patterns.external)) {
			if (ext.library !== effectiveLib) continue;
			if (qualifiedPattern !== undefined && ext.pattern !== qualifiedPattern) continue;
			if (
				patternFilter !== undefined &&
				!matchesPatternRef(ext.library, ext.pattern, patternFilter)
			)
				continue;
			const keep = ext.data.keep?.find((item) => item.id === statementId);
			if (keep) {
				candidates.push({
					library: ext.library,
					external: true,
					pattern: ext.data,
					statementId: keep.id,
					...(keep.gate ? { gateName: keep.gate } : {}),
				});
			}
		}
	}

	if (candidates.length === 0) {
		return `No configured pattern declares keep statement '${statementId}'.`;
	}
	if (candidates.length > 1) {
		return `Keep statement '${statementId}' matches multiple patterns; qualify with pattern:<pattern>:${statementId}, pattern:<library>/<pattern>:${statementId}, or pass pattern.`;
	}
	return candidates[0] as PatternKeepCandidate;
}

export interface SuggestPatternsOptions {
	patterns?: LoadedPatterns;
	localLibrary?: string;
	patternFilter?: string;
}

interface Proposal {
	/** Statements in `render`, with `element` in scope. */
	setup: string[];
	/** Wraps the element in a form, for form obligations. */
	inForm?: boolean;
	/** Scenario steps before the expectation. */
	before?: unknown[];
	events?: unknown[];
	/** The expectation, without its target. */
	expect: Record<string, unknown>;
	/** What this assumes, or what must be replaced. */
	note?: string;
	/** It fails until someone replaces it. */
	placeholder?: boolean;
}

const exportNameOf = (obligation: string) =>
	obligation
		.split(/[^A-Za-z0-9]+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join('')
		.replace(/^(\d)/, 'Case$1');

/** How to put an element in a member's state, and what shows it is. */
function memberProposal(
	member: PropertySchema,
	attribute: string | undefined,
	value: string
): Proposal {
	const finite = (member.values ?? []).find((item) => String(item) === value) as SchemaValue;
	if (attribute === undefined)
		return {
			setup: [`Reflect.set(element, ${JSON.stringify(member.name)}, ${JSON.stringify(finite)});`],
			expect: { state: { property: member.name, equals: finite } },
		};
	if (finite === false || finite === null)
		return { setup: [], expect: { state: { attribute, equals: null } } };
	const written = finite === true ? '' : String(finite);
	return {
		setup: [`element.setAttribute(${JSON.stringify(attribute)}, ${JSON.stringify(written)});`],
		expect: { state: { attribute, equals: written } },
	};
}

function proposalFor(schema: ComponentSchema, obligation: string): Proposal | string {
	if (obligation === 'default') {
		const member = [...schema.properties, ...schema.attributes].find(
			(item) => item.values?.length && (item.attribute ?? item.name)
		);
		const attribute = member?.attribute ?? (member ? member.name : undefined);
		return attribute
			? {
					setup: [],
					expect: { state: { attribute, equals: null } },
					note: `Assumes ${attribute} is absent by default.`,
				}
			: { setup: [], expect: { state: { property: 'localName', equals: schema.tag } } };
	}
	const property = /^property:(.+?)=(.*)$/.exec(obligation);
	if (property) {
		const [, name, value] = property as unknown as [string, string, string];
		const declared = schema.properties.find((item) => item.name === name);
		if (declared) return memberProposal(declared, declared.attribute, value);
		const attribute = schema.attributes.find((item) => item.name === name);
		if (attribute) return memberProposal(attribute, attribute.name, value);
		return `The schema of <${schema.tag}> has no member '${name}'.`;
	}
	const slot = /^slot:(.+)=(filled|empty)$/.exec(obligation);
	if (slot) {
		const [, name, partition] = slot as unknown as [string, string, string];
		if (partition === 'empty')
			return { setup: [], expect: { state: { property: 'childElementCount', equals: 0 } } };
		return name === 'default'
			? {
					setup: ["element.append('Content');"],
					expect: { state: { property: 'textContent', equals: 'Content' } },
				}
			: {
					setup: [
						"const content = document.createElement('span');",
						`content.slot = ${JSON.stringify(name)};`,
						'element.append(content);',
					],
					expect: { state: { property: 'childElementCount', equals: 1 } },
				};
	}
	const event = /^event:(.+)$/.exec(obligation);
	if (event) {
		const type = event[1] as string;
		return {
			setup: [],
			events: [{ type, target: 'control' }],
			before: [{ id: 'act', action: { click: 'control' } }],
			expect: { event: type, since: 'act' },
			note: `Assumes a click causes ${type}. Replace the action with what really does.`,
		};
	}
	const command = /^command:(.+)$/.exec(obligation);
	if (command) {
		const runner = schema.sources.find((source) => source !== 'manifest');
		if (!runner)
			return `No plugin described <${schema.tag}>, so no runner is known for this command.`;
		return {
			setup: [],
			before: [{ id: 'run', command: { runner, name: command[1], target: 'control' } }],
			expect: { state: { attribute: 'data-replace-me', equals: REPLACE_ME } },
			note: 'Replace this expectation with what the command changes.',
			placeholder: true,
		};
	}
	if (obligation === 'form:participation')
		return {
			setup: ["element.setAttribute('name', 'field');"],
			inForm: true,
			expect: { form: { name: 'field', value: REPLACE_ME } },
			note: 'Set a value, and replace this with what the form should submit.',
			placeholder: true,
		};
	if (obligation === 'form:validity')
		return {
			setup: [],
			inForm: true,
			expect: { validity: { valid: true } },
			note: 'Assumes it is valid as rendered. A required field needs a value first.',
		};
	return `There is no way to propose '${obligation}'.`;
}

/** The module and entries proposed for these gaps, all of it unverified. */
export function suggestSpecimens(
	schema: ComponentSchema | undefined,
	gaps: readonly string[],
	options: SuggestPatternsOptions = {}
): Omit<SuggestRun, 'elapsedMs'> {
	const patternSlug = options.patternFilter?.split('/').at(-1)?.replaceAll('.', '-') ?? 'pattern';
	const file = schema
		? (schema.module ?? `${schema.tag}.ts`).replace(/\.[cm]?[jt]s$/, '.specimens.ts')
		: `${patternSlug}.specimens.ts`;
	const base = (schema?.module ?? '')
		.split('/')
		.at(-1)
		?.replace(/\.[cm]?[jt]s$/, '');
	const moduleRel = `./${file.split('/').at(-1)}`;
	const suggestions: SuggestRun['suggestions'] = [];
	const skipped: SuggestRun['skipped'] = [];
	const entries: SuggestRun['entries'] = [];
	const blocks: string[] = [];
	const used = new Set<string>();
	const emittedSetups = new Map<string, string>();

	const allocExportName = (seed: string): string => {
		let exportName = exportNameOf(seed) || 'Case';
		for (let index = 2; used.has(exportName); index++) {
			exportName = `${exportNameOf(seed)}${index}`;
		}
		used.add(exportName);
		return exportName;
	};

	for (const obligation of gaps) {
		if (obligation.startsWith(PATTERN_GAP_PREFIX)) {
			const candidate = findPatternKeep(
				options.patterns,
				options.localLibrary,
				obligation,
				options.patternFilter
			);
			if (typeof candidate === 'string') {
				skipped.push({ obligation, reason: candidate });
				continue;
			}
			if (!candidate.gateName) {
				skipped.push({
					obligation,
					reason: `Keep statement '${candidate.statementId}' has no gate; nothing to set up.`,
				});
				continue;
			}
			const gate = candidate.pattern.gates?.[candidate.gateName];
			if (!gate) {
				skipped.push({
					obligation,
					reason: `Pattern '${candidate.pattern.pattern}' does not declare gate '${candidate.gateName}'.`,
				});
				continue;
			}
			const setup = candidate.pattern.setups?.[gate.setup];
			if (!setup) {
				skipped.push({
					obligation,
					reason: `Pattern '${candidate.pattern.pattern}' does not declare setup '${gate.setup}'.`,
				});
				continue;
			}
			const setupKey = `${candidate.library}\0${candidate.pattern.pattern}\0${gate.setup}`;
			const existingExport = emittedSetups.get(setupKey);
			const note = `Mount setup '${gate.setup}' for pattern '${candidate.pattern.pattern}': ${setup.text}`;
			if (existingExport !== undefined) {
				suggestions.push({
					obligation,
					exportName: existingExport,
					note,
					placeholder: true,
				});
				continue;
			}
			const exportName = allocExportName(`${candidate.pattern.pattern}-${gate.setup}-setup`);
			emittedSetups.set(setupKey, exportName);
			const binding: PatternSetupBinding = {
				...(candidate.external ? { library: candidate.library } : {}),
				pattern: candidate.pattern.pattern,
				setup: gate.setup,
			};
			const targetAliases = Object.keys(setup.targets).join(', ');
			const placeholderMessage = `${REPLACE_ME}: mount setup '${gate.setup}' (${setup.text})`;
			blocks.push(
				[
					`/** Pattern setup placeholder for ${candidate.pattern.pattern} / ${gate.setup}. */`,
					`export const ${exportName} = {`,
					`\tpatternSetup: ${JSON.stringify(binding)},`,
					'\trender: () => {',
					`\t\t// Required portable target aliases: ${targetAliases}`,
					...(schema
						? [
								`\t\t// const element = document.createElement(${JSON.stringify(schema.tag)});`,
								'\t\t// return element;',
							]
						: ['\t\t// Return the mounted HTMLElement for this pattern setup.']),
					`\t\tthrow new Error(${JSON.stringify(placeholderMessage)});`,
					'\t},',
					'};',
				].join('\n')
			);
			const slug = exportName.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
			entries.push({
				id: schema ? `${schema.tag}-${slug}` : slug,
				title: schema
					? `${schema.tag}/${exportName}`
					: `${candidate.pattern.pattern}/${exportName}`,
				module: moduleRel,
				exportName,
				...(schema ? { component: schema.tag } : {}),
				patternSetup: binding,
			});
			suggestions.push({
				obligation,
				exportName,
				note,
				placeholder: true,
			});
			continue;
		}
		if (!schema) {
			skipped.push({
				obligation,
				reason: `Schema obligation '${obligation}' requires a component tag in the manifest.`,
			});
			continue;
		}
		const proposal = proposalFor(schema, obligation);
		if (typeof proposal === 'string') {
			skipped.push({ obligation, reason: proposal });
			continue;
		}
		const exportName = allocExportName(obligation);
		const scenario = [
			...(proposal.before ?? []),
			{ id: 'holds', expect: { target: 'control', ...proposal.expect } },
		];
		const claim = {
			target: 'control',
			obligation,
			checkpoint: 'after-run',
			expectations: ['holds'],
		};
		blocks.push(
			[
				...(proposal.note ? [`/** ${proposal.note} */`] : []),
				`export const ${exportName} = {`,
				'\trender: () => {',
				`\t\tconst element = document.createElement(${JSON.stringify(schema.tag)});`,
				...proposal.setup.map((line) => `\t\t${line}`),
				...(proposal.inForm
					? [
							"\t\tconst form = document.createElement('form');",
							'\t\tform.append(element);',
							'\t\treturn form;',
						]
					: ['\t\treturn element;']),
				'\t},',
				`\ttargets: { control: { selector: ${JSON.stringify(schema.tag)} } },`,
				...(proposal.events ? [`\tevents: ${JSON.stringify(proposal.events)},`] : []),
				`\tscenario: ${JSON.stringify(scenario)},`,
				`\tcoverage: [${JSON.stringify(claim)}],`,
				'};',
			].join('\n')
		);
		entries.push({
			id: `${schema.tag}-${exportName.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}`,
			title: `${schema.tag}/${exportName}`,
			module: moduleRel,
			exportName,
			component: schema.tag,
		});
		suggestions.push({
			obligation,
			exportName,
			...(proposal.note ? { note: proposal.note } : {}),
			...(proposal.placeholder ? { placeholder: true } : {}),
		});
	}
	const importLine = base ? `import './${base}.js';\n\n` : '';
	return {
		...(schema ? { component: schema.tag } : {}),
		status: 'unverified',
		file,
		source: `// Proposed by specimen-suggest. Unverified: run it, and correct what it assumes.\n${importLine}${blocks.join('\n\n')}\n`,
		entries,
		suggestions,
		skipped,
	};
}
