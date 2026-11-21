/**
 * @fileoverview Scenario file discovery and the `scenario init` template.
 */

import { stat } from 'node:fs/promises';
import { dirname, relative } from 'node:path';
import { glob } from 'glob';

const GLOB_MAGIC = /[*?[\]{}]/;

async function statKind(path: string): Promise<'file' | 'dir' | undefined> {
	try {
		const info = await stat(path);
		if (info.isDirectory()) return 'dir';
		if (info.isFile()) return 'file';
		return undefined;
	} catch {
		return undefined;
	}
}

/**
 * Walk up from `pattern` to the deepest existing directory, so literal directory segments
 * containing glob metacharacters (such as `suite[1]`) or Windows separators stay in `cwd`
 * and only the trailing relative portion is parsed as a glob.
 */
async function splitExistingBase(
	pattern: string
): Promise<{ cwd: string; relativePattern: string } | undefined> {
	let dir = dirname(pattern);
	while (dir && dir !== pattern) {
		if ((await statKind(dir)) === 'dir') {
			const rel = relative(dir, pattern);
			if (rel && !rel.startsWith('..')) return { cwd: dir, relativePattern: rel };
			return undefined;
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return undefined;
}

/**
 * Scenario files for an absolute path: a glob pattern, a single `.yaml`/`.yml`
 * file, or a directory searched for `*.scenario.yaml` files. Sorted, so
 * scenarios run in the same order on every machine.
 */
export async function findScenarioFiles(pattern: string): Promise<string[]> {
	const kind = await statKind(pattern);
	if (kind === 'file') return [pattern];
	if (kind === 'dir') {
		return (await glob('**/*.scenario.yaml', { cwd: pattern, absolute: true })).sort();
	}
	const isGlob = GLOB_MAGIC.test(pattern);
	if (!isGlob && (pattern.endsWith('.yaml') || pattern.endsWith('.yml'))) return [pattern];
	const windows = process.platform === 'win32';
	const split = await splitExistingBase(pattern);
	if (split) {
		const rel = windows ? split.relativePattern.replace(/\\/g, '/') : split.relativePattern;
		return (
			await glob(rel, {
				cwd: split.cwd,
				absolute: true,
				...(windows ? { windowsPathsNoEscape: true } : {}),
			})
		).sort();
	}
	const search = windows ? pattern.replace(/\\/g, '/') : pattern;
	return (
		await glob(search, {
			absolute: true,
			...(windows ? { windowsPathsNoEscape: true } : {}),
		})
	).sort();
}

/** Sample scenario written by `afd scenario init`. */
export const SAMPLE_SCENARIO = `# JTBD Scenario: Example workflow
# This file defines a Jobs-to-Be-Done test scenario

name: Example Todo Workflow
description: As a user, I want to create and complete a todo item
job: create-and-complete-todo
tags: [smoke, example]

# Optional: Load fixture data before running
# fixture:
#   file: ./fixtures/empty-state.json

steps:
  - command: todo-create
    description: Create a new todo item
    input:
      title: Buy groceries
    expect:
      success: true
      data:
        title: Buy groceries
        completed: { equals: false }
        id: { exists: true }

  - command: todo-toggle
    description: Mark the todo as completed
    input:
      id: \${{ steps[0].data.id }}  # Reference previous step output
    expect:
      success: true
      data:
        completed: true

  - command: todo-list
    description: Verify the todo appears in the list
    expect:
      success: true
      data:
        total: { gte: 1 }
`;
