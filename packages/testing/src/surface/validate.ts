/**
 * @fileoverview Main entry point for surface validation.
 *
 * Orchestrates all rules and produces a `SurfaceValidationResult`.
 */

import type { CommandDefinition } from '@lushly-dev/afd-core';
import {
	checkDescriptionInjection,
	checkDescriptionQuality,
	checkMissingCategory,
	checkNamingCollision,
	checkNamingConvention,
	checkOrphanedCategory,
	checkSchemaComplexity,
	checkSchemaOverlap,
	checkSimilarDescriptions,
} from './rules.js';
import { commandParametersToJsonSchema } from './schema-overlap.js';
import type {
	SurfaceCommand,
	SurfaceFinding,
	SurfaceRule,
	SurfaceValidationOptions,
	SurfaceValidationResult,
} from './types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// INPUT NORMALIZATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Detect whether the input looks like a `ZodCommandDefinition` by duck-typing.
 */
function isZodCommand(cmd: unknown): boolean {
	return (
		typeof cmd === 'object' &&
		cmd !== null &&
		'jsonSchema' in cmd &&
		'name' in cmd &&
		'description' in cmd
	);
}

/**
 * Detect whether the input looks like a core `CommandDefinition` (has `parameters` array).
 */
function isCoreCommand(cmd: unknown): cmd is CommandDefinition {
	return (
		typeof cmd === 'object' &&
		cmd !== null &&
		'parameters' in cmd &&
		Array.isArray((cmd as CommandDefinition).parameters) &&
		'name' in cmd &&
		'description' in cmd
	);
}

/**
 * Normalize heterogeneous input to `SurfaceCommand[]`.
 */
function normalizeCommands(commands: unknown[]): SurfaceCommand[] {
	return commands.map((cmd) => {
		if (isZodCommand(cmd)) {
			const zod = cmd as {
				name: string;
				description: string;
				category?: string;
				jsonSchema?: Record<string, unknown>;
			};
			return {
				name: zod.name,
				description: zod.description,
				category: zod.category,
				jsonSchema: zod.jsonSchema as SurfaceCommand['jsonSchema'],
			};
		}

		if (isCoreCommand(cmd)) {
			return {
				name: cmd.name,
				description: cmd.description,
				category: cmd.category,
				jsonSchema: commandParametersToJsonSchema(cmd.parameters),
			};
		}

		// Fallback: use name + description if available
		const generic = cmd as Record<string, unknown>;
		return {
			name: String(generic.name ?? ''),
			description: String(generic.description ?? ''),
			category: generic.category as string | undefined,
		};
	});
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUPPRESSION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Check if a finding should be suppressed.
 *
 * Suppression format:
 * - `"rule"` — suppresses all findings of that rule
 * - `"rule:command"` — suppresses findings for a single command
 * - `"rule:cmdA:cmdB"` — suppresses only that pair (order-independent)
 */
function isSuppressed(finding: SurfaceFinding, suppressions: string[]): boolean {
	for (const sup of suppressions) {
		const parts = sup.split(':');
		const rule = parts[0];

		if (rule !== finding.rule) continue;

		// Rule-level suppression (no command specified)
		if (parts.length === 1) return true;

		// Single-command suppression
		if (parts.length === 2) {
			if (finding.commands.length === 1 && finding.commands[0] === parts[1]) {
				return true;
			}
		}

		// Pair-level suppression
		if (parts.length === 3) {
			const supCmds = [parts[1], parts[2]].sort();
			const findCmds = [...finding.commands].sort();
			if (supCmds[0] === findCmds[0] && supCmds[1] === findCmds[1]) {
				return true;
			}
		}
	}

	return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN VALIDATOR
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Validate the command surface for semantic quality issues.
 *
 * Performs cross-command analysis on a registered command set, detecting:
 * - Similar descriptions (cosine similarity)
 * - Schema overlap (shared input fields)
 * - Naming convention violations
 * - Naming collisions (separator-normalized)
 * - Missing categories
 * - Prompt injection in descriptions
 * - Description quality (length, verb presence)
 * - Orphaned categories (single-command)
 *
 * @param commands - Array of `ZodCommandDefinition` or `CommandDefinition`
 * @param options - Validation options and thresholds
 */
export function validateCommandSurface(
	commands: unknown[],
	options: SurfaceValidationOptions = {}
): SurfaceValidationResult {
	const start = performance.now();

	const {
		similarityThreshold = 0.7,
		schemaOverlapThreshold = 0.8,
		detectInjection = true,
		checkDescriptionQuality: checkQuality = true,
		minDescriptionLength = 20,
		enforceNaming = true,
		namingPattern,
		skipCategories = [],
		strict = false,
		suppressions = [],
		additionalInjectionPatterns,
		checkSchemaComplexity: checkComplexity = true,
		schemaComplexityThreshold = 13,
	} = options;

	// Normalize input
	let normalized = normalizeCommands(commands);

	// Filter out skipped categories
	if (skipCategories.length > 0) {
		const skip = new Set(skipCategories);
		normalized = normalized.filter((c) => !c.category || !skip.has(c.category));
	}

	// Run rules
	const allFindings: SurfaceFinding[] = [];
	const rulesEvaluated: SurfaceRule[] = [];

	// Always run: similar-descriptions
	rulesEvaluated.push('similar-descriptions');
	allFindings.push(...checkSimilarDescriptions(normalized, similarityThreshold));

	// Always run: schema-overlap
	rulesEvaluated.push('schema-overlap');
	allFindings.push(...checkSchemaOverlap(normalized, schemaOverlapThreshold));

	// Naming convention (configurable)
	if (enforceNaming) {
		rulesEvaluated.push('naming-convention');
		allFindings.push(...checkNamingConvention(normalized, namingPattern));
	}

	// Always run: naming-collision
	rulesEvaluated.push('naming-collision');
	allFindings.push(...checkNamingCollision(normalized));

	// Always run: missing-category
	rulesEvaluated.push('missing-category');
	allFindings.push(...checkMissingCategory(normalized));

	// Injection detection (configurable)
	if (detectInjection) {
		rulesEvaluated.push('description-injection');
		allFindings.push(...checkDescriptionInjection(normalized, additionalInjectionPatterns));
	}

	// Description quality (configurable)
	if (checkQuality) {
		rulesEvaluated.push('description-quality');
		allFindings.push(
			...checkDescriptionQuality(normalized, {
				minLength: minDescriptionLength,
			})
		);
	}

	// Always run: orphaned-category
	rulesEvaluated.push('orphaned-category');
	allFindings.push(...checkOrphanedCategory(normalized));

	// Schema complexity (configurable)
	if (checkComplexity) {
		rulesEvaluated.push('schema-complexity');
		allFindings.push(...checkSchemaComplexity(normalized, schemaComplexityThreshold));
	}

	// Apply suppressions
	let suppressedCount = 0;
	for (const finding of allFindings) {
		if (isSuppressed(finding, suppressions)) {
			finding.suppressed = true;
			suppressedCount++;
		}
	}

	// Count severities (excluding suppressed)
	let errorCount = 0;
	let warningCount = 0;
	let infoCount = 0;

	for (const f of allFindings) {
		if (f.suppressed) continue;
		switch (f.severity) {
			case 'error':
				errorCount++;
				break;
			case 'warning':
				warningCount++;
				break;
			case 'info':
				infoCount++;
				break;
		}
	}

	// Determine validity
	const valid = strict ? errorCount === 0 && warningCount === 0 : errorCount === 0;

	const durationMs = Math.round((performance.now() - start) * 100) / 100;

	return {
		valid,
		findings: allFindings,
		summary: {
			commandCount: normalized.length,
			errorCount,
			warningCount,
			infoCount,
			suppressedCount,
			rulesEvaluated,
			durationMs,
		},
	};
}
