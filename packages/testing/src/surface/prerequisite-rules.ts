/**
 * @fileoverview Surface validation rules for the `requires` prerequisite graph.
 */

import type { SurfaceCommand, SurfaceFinding } from './types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// RULE 10: UNRESOLVED PREREQUISITES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Flag `requires` entries that reference commands not in the surface.
 */
export function checkUnresolvedPrerequisites(commands: SurfaceCommand[]): SurfaceFinding[] {
	const findings: SurfaceFinding[] = [];
	const known = new Set(commands.map((c) => c.name));

	for (const cmd of commands) {
		if (!cmd.requires) continue;
		for (const req of cmd.requires) {
			if (!known.has(req)) {
				findings.push({
					rule: 'unresolved-prerequisite',
					severity: 'error',
					message: `Command "${cmd.name}" requires "${req}" which is not registered`,
					commands: [cmd.name],
					suggestion: `Register "${req}" or remove it from the requires list.`,
					evidence: { missingCommand: req },
				});
			}
		}
	}

	return findings;
}

// ═══════════════════════════════════════════════════════════════════════════════
// RULE 11: CIRCULAR PREREQUISITES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Detect cycles in the `requires` dependency graph using DFS.
 */
export function checkCircularPrerequisites(commands: SurfaceCommand[]): SurfaceFinding[] {
	const findings: SurfaceFinding[] = [];

	// Build adjacency list
	const graph = new Map<string, string[]>();
	for (const cmd of commands) {
		if (cmd.requires && cmd.requires.length > 0) {
			graph.set(cmd.name, cmd.requires);
		}
	}

	const visited = new Set<string>();
	const inStack = new Set<string>();
	const reportedCycles = new Set<string>();

	function dfs(node: string, path: string[]): void {
		if (inStack.has(node)) {
			// Found a cycle — extract the cycle portion of the path
			const cycleStart = path.indexOf(node);
			const cycle = path.slice(cycleStart);
			cycle.push(node); // close the loop

			// Deduplicate: normalize by sorting the cycle members
			const key = [...cycle].slice(0, -1).sort().join(',');
			if (!reportedCycles.has(key)) {
				reportedCycles.add(key);
				findings.push({
					rule: 'circular-prerequisite',
					severity: 'error',
					message: `Circular prerequisite chain: ${cycle.join(' → ')}`,
					commands: cycle.slice(0, -1),
					suggestion: 'Break the cycle by removing one of the requires entries.',
					evidence: { cycle },
				});
			}
			return;
		}

		if (visited.has(node)) return;

		visited.add(node);
		inStack.add(node);

		const neighbors = graph.get(node) ?? [];
		for (const neighbor of neighbors) {
			dfs(neighbor, [...path, node]);
		}

		inStack.delete(node);
	}

	// Run DFS from every node that has requires
	for (const cmd of commands) {
		if (!visited.has(cmd.name)) {
			dfs(cmd.name, []);
		}
	}

	return findings;
}
