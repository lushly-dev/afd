/**
 * @fileoverview Surface validation rules.
 *
 * Eight rule functions, each returning `SurfaceFinding[]`.
 */

import { checkInjection } from './injection.js';
import { compareSchemas } from './schema-overlap.js';
import { buildSimilarityMatrix } from './similarity.js';
import type { InjectionPattern, SurfaceCommand, SurfaceFinding } from './types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// DESCRIPTION VERBS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Common action verbs expected in command descriptions.
 * Keyword matching (not POS tagging) to remain dependency-free.
 */
export const DESCRIPTION_VERBS = new Set([
	'get',
	'gets',
	'fetch',
	'fetches',
	'retrieve',
	'retrieves',
	'create',
	'creates',
	'add',
	'adds',
	'insert',
	'inserts',
	'update',
	'updates',
	'modify',
	'modifies',
	'patch',
	'patches',
	'delete',
	'deletes',
	'remove',
	'removes',
	'destroy',
	'destroys',
	'list',
	'lists',
	'search',
	'searches',
	'find',
	'finds',
	'query',
	'queries',
	'send',
	'sends',
	'submit',
	'submits',
	'publish',
	'publishes',
	'validate',
	'validates',
	'check',
	'checks',
	'verify',
	'verifies',
	'connect',
	'connects',
	'disconnect',
	'disconnects',
	'start',
	'starts',
	'stop',
	'stops',
	'restart',
	'restarts',
	'enable',
	'enables',
	'disable',
	'disables',
	'export',
	'exports',
	'import',
	'imports',
	'compute',
	'computes',
	'calculate',
	'calculates',
	'return',
	'returns',
	'set',
	'sets',
	'reset',
	'resets',
	'run',
	'runs',
	'execute',
	'executes',
	'invoke',
	'invokes',
	'subscribe',
	'subscribes',
	'unsubscribe',
	'unsubscribes',
]);

/** Default naming pattern: kebab-case with domain-action separation */
const DEFAULT_NAMING_PATTERN = /^[a-z][a-z0-9]*-[a-z][a-z0-9-]*$/;

// ═══════════════════════════════════════════════════════════════════════════════
// RULE 1: SIMILAR DESCRIPTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Detect command pairs with highly similar descriptions.
 */
export function checkSimilarDescriptions(
	commands: SurfaceCommand[],
	threshold: number
): SurfaceFinding[] {
	const findings: SurfaceFinding[] = [];
	const matrix = buildSimilarityMatrix(commands);

	for (const pair of matrix.pairs) {
		if (pair.score < threshold) break; // sorted descending, done
		const pct = Math.round(pair.score * 100);
		findings.push({
			rule: 'similar-descriptions',
			severity: 'warning',
			message: `Commands "${pair.commandA}" and "${pair.commandB}" have ${pct}% description similarity`,
			commands: [pair.commandA, pair.commandB],
			suggestion: 'Merge into a single command or make descriptions more distinct.',
			evidence: { similarity: pair.score },
		});
	}

	return findings;
}

// ═══════════════════════════════════════════════════════════════════════════════
// RULE 2: SCHEMA OVERLAP
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Detect command pairs with highly overlapping input schemas.
 */
export function checkSchemaOverlap(
	commands: SurfaceCommand[],
	threshold: number
): SurfaceFinding[] {
	const findings: SurfaceFinding[] = [];
	const withSchema = commands.filter((c) => c.jsonSchema?.properties);

	for (let i = 0; i < withSchema.length; i++) {
		for (let j = i + 1; j < withSchema.length; j++) {
			const cmdA = withSchema[i];
			const cmdB = withSchema[j];
			if (!cmdA?.jsonSchema || !cmdB?.jsonSchema) continue;
			const result = compareSchemas(cmdA.jsonSchema, cmdB.jsonSchema);

			if (result.overlapRatio >= threshold) {
				const pct = Math.round(result.overlapRatio * 100);
				findings.push({
					rule: 'schema-overlap',
					severity: 'warning',
					message: `Commands "${cmdA.name}" and "${cmdB.name}" share ${pct}% input fields (${result.sharedFields.join(', ')})`,
					commands: [cmdA.name, cmdB.name],
					suggestion:
						'Consider merging these commands or ensure descriptions clearly differentiate when to use each.',
					evidence: {
						sharedFields: result.sharedFields,
						uniqueToA: result.uniqueToA,
						uniqueToB: result.uniqueToB,
						overlapRatio: result.overlapRatio,
						typesCompatible: result.typesCompatible,
					},
				});
			}
		}
	}

	return findings;
}

// ═══════════════════════════════════════════════════════════════════════════════
// RULE 3: NAMING CONVENTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Validate that all command names match the naming pattern.
 */
export function checkNamingConvention(
	commands: SurfaceCommand[],
	pattern?: RegExp
): SurfaceFinding[] {
	const regex = pattern ?? DEFAULT_NAMING_PATTERN;
	const findings: SurfaceFinding[] = [];

	for (const cmd of commands) {
		if (!regex.test(cmd.name)) {
			findings.push({
				rule: 'naming-convention',
				severity: 'error',
				message: `Command "${cmd.name}" does not match the naming convention`,
				commands: [cmd.name],
				suggestion: `Rename to kebab-case domain-action format (e.g., "${suggestKebabName(cmd.name)}").`,
				evidence: { pattern: regex.source },
			});
		}
	}

	return findings;
}

/**
 * Suggest a kebab-case name from a given name.
 */
function suggestKebabName(name: string): string {
	return name
		.replace(/([a-z])([A-Z])/g, '$1-$2')
		.replace(/[_.\s]+/g, '-')
		.toLowerCase();
}

// ═══════════════════════════════════════════════════════════════════════════════
// RULE 4: NAMING COLLISION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Detect command pairs whose names differ only by separator style.
 */
export function checkNamingCollision(commands: SurfaceCommand[]): SurfaceFinding[] {
	const findings: SurfaceFinding[] = [];
	const normalized = new Map<string, string[]>();

	for (const cmd of commands) {
		const key = cmd.name.replace(/[-_.]/g, '').toLowerCase();
		const existing = normalized.get(key);
		if (existing) {
			existing.push(cmd.name);
		} else {
			normalized.set(key, [cmd.name]);
		}
	}

	for (const [, names] of normalized) {
		if (names.length > 1) {
			findings.push({
				rule: 'naming-collision',
				severity: 'error',
				message: `Commands ${names.map((n) => `"${n}"`).join(' and ')} collide when separators are normalized`,
				commands: names,
				suggestion:
					'Use a single consistent naming style. Prefer kebab-case (e.g., "user-create").',
				evidence: { normalizedNames: names },
			});
		}
	}

	return findings;
}

// ═══════════════════════════════════════════════════════════════════════════════
// RULE 5: MISSING CATEGORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Flag commands without a category field.
 */
export function checkMissingCategory(commands: SurfaceCommand[]): SurfaceFinding[] {
	const findings: SurfaceFinding[] = [];

	for (const cmd of commands) {
		if (!cmd.category) {
			findings.push({
				rule: 'missing-category',
				severity: 'info',
				message: `Command "${cmd.name}" has no category`,
				commands: [cmd.name],
				suggestion: 'Add a category to help agents organize and filter commands.',
			});
		}
	}

	return findings;
}

// ═══════════════════════════════════════════════════════════════════════════════
// RULE 6: DESCRIPTION INJECTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Scan descriptions for prompt injection patterns.
 */
export function checkDescriptionInjection(
	commands: SurfaceCommand[],
	additionalPatterns?: InjectionPattern[]
): SurfaceFinding[] {
	const findings: SurfaceFinding[] = [];
	const patterns = additionalPatterns ? [...additionalPatterns] : undefined;

	for (const cmd of commands) {
		const matches = checkInjection(cmd.description, patterns);
		for (const match of matches) {
			findings.push({
				rule: 'description-injection',
				severity: 'error',
				message: `Command "${cmd.name}" description contains ${match.description.toLowerCase()}`,
				commands: [cmd.name],
				suggestion:
					'Remove instruction-like language from the description. Descriptions should explain what the command does, not instruct the agent how to behave.',
				evidence: {
					patternId: match.patternId,
					matchedText: match.matchedText,
				},
			});
		}
	}

	return findings;
}

// ═══════════════════════════════════════════════════════════════════════════════
// RULE 7: DESCRIPTION QUALITY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Check description length and verb presence.
 */
export function checkDescriptionQuality(
	commands: SurfaceCommand[],
	options?: { minLength?: number; additionalVerbs?: string[] }
): SurfaceFinding[] {
	const findings: SurfaceFinding[] = [];
	const minLength = options?.minLength ?? 20;

	const verbs = new Set(DESCRIPTION_VERBS);
	if (options?.additionalVerbs) {
		for (const v of options.additionalVerbs) {
			verbs.add(v.toLowerCase());
		}
	}

	for (const cmd of commands) {
		if (cmd.description.length < minLength) {
			findings.push({
				rule: 'description-quality',
				severity: 'warning',
				message: `Command "${cmd.name}" description is too short (${cmd.description.length} chars, minimum ${minLength})`,
				commands: [cmd.name],
				suggestion:
					'Write a description of at least 20 characters explaining what the command does and when to use it.',
				evidence: {
					length: cmd.description.length,
					minLength,
				},
			});
		}

		const tokens = cmd.description.toLowerCase().split(/\s+/);
		const hasVerb = tokens.some((t) => verbs.has(t));
		if (!hasVerb) {
			findings.push({
				rule: 'description-quality',
				severity: 'warning',
				message: `Command "${cmd.name}" description is missing an action verb`,
				commands: [cmd.name],
				suggestion:
					'Start the description with an action verb (e.g., "Creates...", "Retrieves...", "Deletes...").',
				evidence: { missingVerb: true },
			});
		}
	}

	return findings;
}

// ═══════════════════════════════════════════════════════════════════════════════
// RULE 8: ORPHANED CATEGORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Flag categories with only one command (may indicate misclassification).
 */
export function checkOrphanedCategory(commands: SurfaceCommand[]): SurfaceFinding[] {
	const findings: SurfaceFinding[] = [];
	const categories = new Map<string, string[]>();

	for (const cmd of commands) {
		if (cmd.category) {
			const existing = categories.get(cmd.category);
			if (existing) {
				existing.push(cmd.name);
			} else {
				categories.set(cmd.category, [cmd.name]);
			}
		}
	}

	for (const [category, names] of categories) {
		if (names.length === 1) {
			findings.push({
				rule: 'orphaned-category',
				severity: 'info',
				message: `Category "${category}" contains only one command ("${names[0]}")`,
				commands: names,
				suggestion:
					'Consider moving this command to a broader category, or suppress this finding if the singleton category is intentional.',
				evidence: { category },
			});
		}
	}

	return findings;
}
