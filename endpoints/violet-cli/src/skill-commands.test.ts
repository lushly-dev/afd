/**
 * @fileoverview Keeps the violet-usage skill's command list in step with the registry
 *
 * `.claude/skills/violet-usage/references/workflows.md` ("Current command groups") is what agents
 * read for command discovery. Each entry is `- \`name\`: \`violet …\``, under a heading that names
 * the registry category in backticks. This test fails when a command is missing, listed under the
 * wrong category, or given a CLI form that commander doesn't have.
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registry } from '@lushly-dev/violet-afd';
import type { Command } from 'commander';
import { beforeAll, describe, expect, it } from 'vitest';
import { createCLI } from './cli.js';

const workflowsPath = fileURLToPath(
	// Frozen copy of Violet's .claude/skills/violet-usage/references/workflows.md
	new URL('../test-fixtures/violet-usage-workflows.md.txt', import.meta.url),
);

interface Entry {
	name: string;
	category: string;
	cli: string;
}

function readEntries(): Entry[] {
	const markdown = fs.readFileSync(workflowsPath, 'utf8');
	const start = markdown.indexOf('## Current command groups');
	const end = markdown.indexOf('\n## ', start + 1);
	expect(start, 'workflows.md has a "Current command groups" section').toBeGreaterThanOrEqual(0);

	const entries: Entry[] = [];
	let category = '';
	for (const line of markdown.slice(start, end).split('\n')) {
		const heading = line.match(/^### .*\(`([a-z]+)`\)$/);
		if (heading) {
			category = heading[1];
			continue;
		}
		const item = line.match(/^- `([a-zA-Z.]+)`: `(violet [^`]+)`/);
		if (item) entries.push({ name: item[1], category, cli: item[2] });
	}
	return entries;
}

/** The command names in a CLI form, up to the first argument or option (`a|b` is either). */
function commandPath(cli: string): string[][] {
	const path: string[][] = [];
	for (const word of cli.split(/\s+/).slice(1)) {
		if (/^[<[-]/.test(word)) break;
		path.push(word.split('|'));
	}
	return path;
}

/** Why `cli` isn't a command or option commander has, or undefined when it is. */
function missingCliForm(program: Command, name: string, cli: string): string | undefined {
	const path = commandPath(cli);
	if (path[0]?.[0] === 'call') {
		return path[1]?.[0] === name ? undefined : `\`${cli}\` doesn't call ${name}`;
	}
	if (path.length === 0) {
		const option = cli.split(/\s+/)[1];
		return program.options.some((candidate) => candidate.long === option)
			? undefined
			: `\`${cli}\` has no global option ${option}`;
	}

	let level: Command[] = [program];
	for (const alternatives of path) {
		const children = level.flatMap((parent) => parent.commands);
		const next = alternatives.map((word) =>
			children.find((command) => command.name() === word || command.aliases().includes(word)),
		);
		const missing = alternatives.find((_, index) => !next[index]);
		if (missing) return `\`${cli}\` has no \`${missing}\` command`;
		level = next as Command[];
	}
	return undefined;
}

describe('violet-usage skill command list', () => {
	let program: Command;
	let entries: Entry[];

	beforeAll(() => {
		program = createCLI();
		entries = readEntries();
	});

	it('lists every registered command once, under its registry category', () => {
		const documented = entries.map(({ name, category }) => `${category} ${name}`).sort();
		const registered = registry
			.list()
			.map(({ name, category }) => `${category} ${name}`)
			.sort();
		expect(documented).toEqual(registered);
	});

	it('gives each command a CLI form that exists', () => {
		const problems = entries
			.map(({ name, cli }) => missingCliForm(program, name, cli))
			.filter((problem) => problem !== undefined);
		expect(problems).toEqual([]);
	});
});
