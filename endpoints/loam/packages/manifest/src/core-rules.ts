/**
 * @fileoverview The rules beyond the schema of spec/plugin-manifest.md, by their names there, but
 * for `path-inside-root` and `files`, which need a file system and belong to `app check`. Each case
 * in that page's `rules` section runs through this code.
 */

import { z } from 'zod';
import { AFD_CONTRACT } from './_generated/facts.js';
import type { ManifestRefusalCode } from './types.js';
import { validateSchemaShape } from './validate-shape.generated.js';
import type { GeneratedValidator } from './validator-errors.js';

/** One finding of a rule: the pointer it names. */
export interface Finding {
	code: ManifestRefusalCode;
	pointer: string;
	message: string;
	suggestion: string;
}

/** The core's definitions of what the rules read, with everything else left unknown. */
export type Json = Record<string, unknown>;

interface CoreView {
	afd_contract?: string;
	plugin: { id: string; kind: string; domains?: string[] } & Json;
	mount?: { prefix: string; tools?: ({ tool: string; name?: string } & Json)[] } & Json;
	grants?: ({ name: string; reason: string } & Json)[];
	commands?: CommandView[];
	contexts?: ({ name: string; description: string } & Json)[];
	pipelines?: PipelineView[];
	skills?: { name: string; path: string }[];
	config?: { schema: unknown };
}

interface CommandView extends Json {
	name: string;
	input_schema: unknown;
	returns?: unknown;
	output_budget?: { default_bytes: number; max_bytes: number };
	tool_meta?: Json;
	contexts?: string[];
	requires?: string[];
	examples?: { title: string }[];
}

interface PipelineView extends Json {
	name: string;
	input_schema: unknown;
	steps: { as?: string }[];
}

const VALUE_LIMIT = 2 ** 53 - 1;
const CONTROL = /\p{Cc}/u;
const LABEL = /^[A-Za-z](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
const NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

const escapeKey = (key: string): string => key.replaceAll('~', '~0').replaceAll('/', '~1');
const shapeValidator = validateSchemaShape as GeneratedValidator;

/** A schema nested deeply enough to exhaust the stack is refused like any other bad schema. */
function validSchema(schema: unknown): boolean {
	try {
		return shapeValidator(schema);
	} catch {
		return false;
	}
}

/** The key rule (spec/mcp-resources.md, T2). */
export function toolMetaAllowed(key: string, value: unknown): boolean {
	if (key === 'ui') {
		if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
		const { resourceUri } = value as { resourceUri?: unknown };
		return (
			resourceUri === undefined ||
			(typeof resourceUri === 'string' && resourceUri.startsWith('ui://'))
		);
	}
	const [prefix = '', name, ...rest] = key.split('/');
	const labels = prefix.split('.');
	if (name === undefined || rest.length > 0 || labels.length < 2) return false;
	if (!labels.every((label) => LABEL.test(label)) || !NAME.test(name)) return false;
	const second = (labels[1] as string).toLowerCase();
	return (
		!key.toLowerCase().startsWith('dev.afd/') &&
		second !== 'modelcontextprotocol' &&
		second !== 'mcp'
	);
}

/** Loam's AFD checker: `z.fromJSONSchema` refuses keywords JSON Schema allows. */
function zodAccepts(schema: object): boolean {
	try {
		z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0]);
		return true;
	} catch {
		return false;
	}
}

const isObject = (value: unknown): value is Json =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

function inputSchemaProblem(schema: unknown): string | undefined {
	// A path is read once the file system is at hand, by `app check`.
	if (typeof schema === 'string') return undefined;
	if (!isObject(schema) || schema.type !== 'object') return 'it must be a `type: object` schema';
	if (!validSchema(schema)) return 'it is not a valid JSON Schema';
	if (!zodAccepts(schema)) return "it uses a keyword Loam's AFD checker refuses";
	return undefined;
}

function configSchemaProblem(schema: unknown): string | undefined {
	if (typeof schema === 'string') return undefined;
	if (!isObject(schema) || schema.type !== 'object') return 'it must be a `type: object` schema';
	if (schema.additionalProperties !== false)
		return 'it must be closed at its root, with `additionalProperties: false`';
	if (!validSchema(schema)) return 'it is not a valid JSON Schema';
	if (!zodAccepts(schema)) return "it uses a keyword Loam's AFD checker refuses";
	return undefined;
}

function textFindings(manifest: CoreView, found: Finding[]): void {
	const add = (pointer: string, value: unknown): void => {
		if (typeof value === 'string' && CONTROL.test(value)) {
			found.push({
				code: 'MANIFEST_TEXT_INVALID',
				pointer,
				message: "It holds a control character, and it reaches a person's screen.",
				suggestion: 'Remove the control character.',
			});
		}
	};
	for (const key of ['title', 'description', 'homepage', 'license'])
		add(`/plugin/${key}`, manifest.plugin[key]);
	(manifest.grants ?? []).forEach((grant, index) => {
		add(`/grants/${index}/reason`, grant.reason);
	});
	(manifest.commands ?? []).forEach((command, index) => {
		for (const key of ['title', 'description', 'category', 'confirm_prompt'])
			add(`/commands/${index}/${key}`, command[key]);
		(command.examples ?? []).forEach((example, at) => {
			add(`/commands/${index}/examples/${at}/title`, example.title);
		});
	});
	(manifest.contexts ?? []).forEach((context, index) => {
		add(`/contexts/${index}/description`, context.description);
	});
	(manifest.pipelines ?? []).forEach((pipeline, index) => {
		add(`/pipelines/${index}/description`, pipeline.description);
	});
	(manifest.mount?.tools ?? []).forEach((tool, index) => {
		add(`/mount/tools/${index}/confirm_prompt`, tool.confirm_prompt);
	});
}

const major = (version: string): string => version.split('.')[0] as string;

/** The refusals and warnings of the rules, in the order the page lists them. */
export function coreRules(manifest: CoreView): { refusals: Finding[]; warnings: Finding[] } {
	const refusals: Finding[] = [];
	const warnings: Finding[] = [];
	const push = (
		code: ManifestRefusalCode,
		pointer: string,
		message: string,
		suggestion: string
	): void => {
		refusals.push({ code, pointer, message, suggestion });
	};
	const once = (seen: Set<unknown>, value: unknown, pointer: string, what: string): void => {
		if (value !== undefined && seen.has(value)) {
			push(
				'MANIFEST_DUPLICATE',
				pointer,
				`${what} \`${String(value)}\` is repeated.`,
				'Give each its own name.'
			);
		}
		seen.add(value);
	};
	const { plugin } = manifest;
	const domains = plugin.domains ?? [];
	const first = (name: string): string => name.split('-')[0] as string;
	const commands = manifest.commands ?? [];
	const pipelines = manifest.pipelines ?? [];
	const contexts = manifest.contexts ?? [];
	const skills = manifest.skills ?? [];
	const mounted = plugin.kind === 'mounted';
	const outOfDomain = (pointer: string, name: string): void => {
		push(
			'MANIFEST_NAME_DOMAIN',
			pointer,
			`\`${name}\` does not start with one of \`plugin.domains\`.`,
			`Start the name with one of: ${domains.join(', ') || 'declare `plugin.domains`'}.`
		);
	};

	if (mounted && !manifest.mount) {
		push('MANIFEST_SECTION_KIND', '/mount', '`kind = "mounted"` needs `mount`.', 'Add `[mount]`.');
	}
	if (!mounted && manifest.mount) {
		push(
			'MANIFEST_SECTION_KIND',
			'/mount',
			'Only `kind = "mounted"` has `mount`.',
			'Remove `[mount]`, or change `plugin.kind`.'
		);
	}
	if (mounted && commands.length > 0) {
		push(
			'MANIFEST_SECTION_KIND',
			'/commands',
			'A mounted manifest declares no commands: they come from the server.',
			'Remove `commands`.'
		);
	}
	if (manifest.mount && !domains.includes(manifest.mount.prefix)) {
		push(
			'MANIFEST_MOUNT_PREFIX',
			'/mount/prefix',
			'`mount.prefix` is not one of `plugin.domains`.',
			'Set `mount.prefix` to one of `plugin.domains`.'
		);
	}
	if (manifest.afd_contract && major(manifest.afd_contract) !== major(AFD_CONTRACT)) {
		push(
			'MANIFEST_AFD_CONTRACT',
			'/afd_contract',
			`\`afd_contract\` ${manifest.afd_contract} is not this shell's major version, ${AFD_CONTRACT}.`,
			`Follow AFD contract ${major(AFD_CONTRACT)}.x.`
		);
	}

	const callable = new Set<string>();
	const grantNames = new Set<string>();
	(manifest.grants ?? []).forEach((grant, index) => {
		once(grantNames, grant.name, `/grants/${index}/name`, 'The grant');
	});
	const named = (name: string, pointer: string): void => {
		if (!domains.includes(first(name))) outOfDomain(pointer, name);
		once(callable, name, pointer, 'The command');
	};
	if (!mounted) {
		commands.forEach((command, index) => {
			named(command.name, `/commands/${index}/name`);
		});
	}
	commands.forEach((command, index) => {
		const problem = inputSchemaProblem(command.input_schema);
		if (problem) {
			push(
				'MANIFEST_INPUT_SCHEMA_INVALID',
				`/commands/${index}/input_schema`,
				`This \`input_schema\` is refused: ${problem}.`,
				'Declare a `type: object` schema with properties an AFD form and Zod can read.'
			);
		}
		const budget = command.output_budget;
		if (budget && budget.default_bytes > budget.max_bytes) {
			push(
				'MANIFEST_BUDGET_INVALID',
				`/commands/${index}/output_budget/default_bytes`,
				'`default_bytes` is above `max_bytes`.',
				'Lower `default_bytes` to at most `max_bytes`.'
			);
		}
		if (budget && budget.max_bytes > VALUE_LIMIT) {
			push(
				'MANIFEST_BUDGET_INVALID',
				`/commands/${index}/output_budget/max_bytes`,
				'`max_bytes` is above 2^53 - 1.',
				'Lower `max_bytes`.'
			);
		}
		for (const [key, value] of Object.entries(command.tool_meta ?? {})) {
			if (!toolMetaAllowed(key, value)) {
				push(
					'MANIFEST_TOOL_META_INVALID',
					`/commands/${index}/tool_meta/${escapeKey(key)}`,
					`\`tool_meta\` key \`${key}\` breaks AFD's key rule.`,
					'Use a reverse-DNS prefix of your own, or `ui` with a `ui://` `resourceUri`.'
				);
			}
		}
		(command.contexts ?? []).forEach((name, at) => {
			if (!contexts.some((context) => context.name === name)) {
				push(
					'MANIFEST_CONTEXT_UNDECLARED',
					`/commands/${index}/contexts/${at}`,
					`The context \`${name}\` is not declared.`,
					'Declare it in `contexts`, or remove it from the command.'
				);
			}
		});
	});
	pipelines.forEach((pipeline, index) => {
		named(pipeline.name, `/pipelines/${index}/name`);
		const problem = inputSchemaProblem(pipeline.input_schema);
		if (problem) {
			push(
				'MANIFEST_INPUT_SCHEMA_INVALID',
				`/pipelines/${index}/input_schema`,
				`This \`input_schema\` is refused: ${problem}.`,
				'Declare a `type: object` schema.'
			);
		}
		const aliases = new Set<unknown>();
		pipeline.steps.forEach((step, at) => {
			once(aliases, step.as, `/pipelines/${index}/steps/${at}/as`, 'The step alias');
		});
	});
	const contextNames = new Set<string>();
	contexts.forEach((context, index) => {
		const pointer = `/contexts/${index}/name`;
		if (!domains.includes(first(context.name))) outOfDomain(pointer, context.name);
		once(contextNames, context.name, pointer, 'The context');
	});
	const skillNames = new Set<string>();
	skills.forEach((skill, index) => {
		const pointer = `/skills/${index}/name`;
		if (skill.name !== plugin.id && !skill.name.startsWith(`${plugin.id}-`)) {
			push(
				'MANIFEST_SKILL_NAME',
				pointer,
				`The skill \`${skill.name}\` does not carry the plugin id.`,
				`Name it \`${plugin.id}\` or \`${plugin.id}-<name>\`.`
			);
		}
		once(skillNames, skill.name, pointer, 'The skill');
		if (skill.path.replace(/\/+$/, '').split('/').at(-1) !== skill.name) {
			push(
				'MANIFEST_SKILL_NAME',
				`/skills/${index}/path`,
				`The last segment of \`${skill.path}\` is not the skill's name.`,
				`End the path in \`${skill.name}\`.`
			);
		}
	});
	const tools = new Set<unknown>();
	const toolNames = new Set<unknown>();
	(manifest.mount?.tools ?? []).forEach((tool, index) => {
		once(tools, tool.tool, `/mount/tools/${index}/tool`, 'The tool');
		once(toolNames, tool.name, `/mount/tools/${index}/name`, 'The tool name');
	});
	const configProblem = manifest.config && configSchemaProblem(manifest.config.schema);
	if (configProblem) {
		push(
			'MANIFEST_CONFIG_SCHEMA_INVALID',
			'/config/schema',
			`This \`config.schema\` is refused: ${configProblem}.`,
			'Declare a `type: object` schema with `additionalProperties: false`.'
		);
	}
	textFindings(manifest, refusals);
	commands.forEach((command, index) => {
		(command.requires ?? []).forEach((name, at) => {
			if (!callable.has(name)) {
				warnings.push({
					code: 'MANIFEST_REQUIRES_UNKNOWN',
					pointer: `/commands/${index}/requires/${at}`,
					message: `\`requires\` names \`${name}\`, which the manifest does not declare.`,
					suggestion: 'Correct the name, or remove it: `requires` is metadata only.',
				});
			}
		});
	});
	return { refusals, warnings };
}
