import type { ComponentSchema, PropertySchema, SchemaValue } from './plugin.js';
import type { SuggestRun } from './types.js';

/**
 * Proposed specimens for a component's gaps: a starting point an agent runs and corrects. Nothing
 * here is evidence. What a generator can derive from the schema it writes as an expectation that
 * holds or fails on its merits. What only a person knows, such as what a command changes, it
 * writes as an expectation that fails until someone replaces it, so that it can never pass unread.
 */

/** In an expectation only a person can complete: it fails until replaced. */
export const REPLACE_ME = 'REPLACE_WITH_WHAT_THIS_SHOULD_BE';

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
	schema: ComponentSchema,
	gaps: readonly string[]
): Omit<SuggestRun, 'elapsedMs'> {
	const file = (schema.module ?? `${schema.tag}.ts`).replace(/\.[cm]?[jt]s$/, '.specimens.ts');
	const base = (schema.module ?? '')
		.split('/')
		.at(-1)
		?.replace(/\.[cm]?[jt]s$/, '');
	const suggestions: SuggestRun['suggestions'] = [];
	const skipped: SuggestRun['skipped'] = [];
	const blocks: string[] = [];
	const used = new Set<string>();
	for (const obligation of gaps) {
		const proposal = proposalFor(schema, obligation);
		if (typeof proposal === 'string') {
			skipped.push({ obligation, reason: proposal });
			continue;
		}
		let exportName = exportNameOf(obligation) || 'Case';
		for (let index = 2; used.has(exportName); index++)
			exportName = `${exportNameOf(obligation)}${index}`;
		used.add(exportName);
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
		suggestions.push({
			obligation,
			exportName,
			...(proposal.note ? { note: proposal.note } : {}),
			...(proposal.placeholder ? { placeholder: true } : {}),
		});
	}
	const importLine = base ? `import './${base}.js';\n\n` : '';
	return {
		component: schema.tag,
		status: 'unverified',
		file,
		source: `// Proposed by specimen-suggest. Unverified: run it, and correct what it assumes.\n${importLine}${blocks.join('\n\n')}\n`,
		entries: suggestions.map(({ exportName }) => ({
			id: `${schema.tag}-${exportName.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}`,
			title: `${schema.tag}/${exportName}`,
			module: `./${file.split('/').at(-1)}`,
			exportName,
			component: schema.tag,
		})),
		suggestions,
		skipped,
	};
}
