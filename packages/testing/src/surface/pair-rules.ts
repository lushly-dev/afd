/**
 * @fileoverview Pairwise surface validation rules.
 *
 * These rules compare pairs of commands, so they are written to stay fast on
 * large surfaces: descriptions are tokenized once, and with a positive
 * threshold only pairs that share a term or field are compared at all.
 */

import { compareSchemas } from './schema-overlap.js';
import { forEachSharedTermPair } from './shared-terms.js';
import { buildSimilarityMatrix } from './similarity.js';
import type { SurfaceCommand, SurfaceFinding } from './types.js';

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
	const matrix = buildSimilarityMatrix(commands, { threshold });

	for (const pair of matrix.pairs) {
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
	const fieldSets = withSchema.map(
		(c) => new Map(Object.keys(c.jsonSchema?.properties ?? {}).map((field) => [field, 1]))
	);

	const report = (i: number, j: number) => {
		const cmdA = withSchema[i];
		const cmdB = withSchema[j];
		if (!cmdA?.jsonSchema || !cmdB?.jsonSchema) return;
		const result = compareSchemas(cmdA.jsonSchema, cmdB.jsonSchema);
		if (result.overlapRatio < threshold) return;
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
	};

	if (threshold > 0) {
		// Only pairs sharing a field can reach a positive threshold
		forEachSharedTermPair(fieldSets, (i, j, shared) => {
			const union = (fieldSets[i]?.size ?? 0) + (fieldSets[j]?.size ?? 0) - shared;
			if (shared / union >= threshold) report(i, j);
		});
	} else {
		for (let i = 0; i < withSchema.length; i++) {
			for (let j = i + 1; j < withSchema.length; j++) {
				report(i, j);
			}
		}
	}

	return findings;
}
