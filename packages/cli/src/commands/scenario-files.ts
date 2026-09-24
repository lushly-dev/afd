/**
 * @fileoverview Scenario file discovery and the `scenario init` template.
 */

import { glob } from 'glob';

/**
 * Scenario files for an absolute path: a glob pattern, a single `.yaml`/`.yml`
 * file, or a directory searched for `*.scenario.yaml` files. Sorted, so
 * scenarios run in the same order on every machine.
 */
export async function findScenarioFiles(pattern: string): Promise<string[]> {
	const isGlob = pattern.includes('*');
	if (!isGlob && (pattern.endsWith('.yaml') || pattern.endsWith('.yml'))) return [pattern];
	const search = isGlob ? pattern : `${pattern}/**/*.scenario.yaml`;
	return (await glob(search, { absolute: true })).sort();
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
