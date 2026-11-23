/**
 * What the packed-artifact consumers need from pnpm 12.
 *
 * Overrides: pnpm 11 and later read them only from `pnpm-workspace.yaml`, and ignore the `pnpm`
 * field of `package.json` with a warning, so a consumer that wrote that field resolved the published
 * packages instead of the packed ones and still installed. JSON is YAML, so the file is written as
 * JSON and needs no quoting rules.
 *
 * Version: a temporary consumer sits outside the repository, so whichever pnpm is on `PATH` would
 * install it: pnpm 12 in CI, possibly an older one locally, which words peer issues differently.
 * Each consumer therefore pins the repository's `packageManager`, and the pin is checked.
 *
 * Peer issues: pnpm 12 reports each one as a block, `✕ missing peer <name>` or
 * `✕ unmet peer <name>`, then `Installed: <specifier>` for an unmet one, then `Wanted:` with each
 * range and the packages that want it.
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnTool } from '../../scripts/release/exec-tool.mjs';

const { packageManager } = JSON.parse(
	readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
);

/**
 * Writes a consumer's `manifest`, pinned to the repository's pnpm, and its `overrides` (selector to
 * specifier) where pnpm reads them, then checks that the pinned pnpm is the one that will run.
 */
export async function writeConsumer(root, manifest, overrides = {}) {
	await writeFile(
		join(root, 'package.json'),
		`${JSON.stringify({ ...manifest, packageManager }, null, 2)}\n`
	);
	if (Object.keys(overrides).length > 0)
		await writeFile(
			join(root, 'pnpm-workspace.yaml'),
			`${JSON.stringify({ overrides }, null, 2)}\n`
		);
	const version = spawnTool('pnpm', ['--version'], { cwd: root, encoding: 'utf8' });
	assert.equal(
		`pnpm@${version.stdout.trim()}`,
		packageManager,
		`the consumer at ${root} runs pnpm ${version.stdout.trim()}, not the pinned ${packageManager}:\n${version.stderr}`
	);
}

/** The package a selector part names: `b@<range>` names `b`. */
const bareName = (part) => {
	const at = part.indexOf('@', 1);
	return at === -1 ? part : part.slice(0, at);
};
/** The same name as pnpm spells it in `node_modules/.pnpm`. */
const packageName = (part) => bareName(part).replace('/', '+');

/** The lockfile text outside its `overrides:` section, which names every overridden package. */
const resolvedText = (root) =>
	readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8').replace(
		/^overrides:\n(?:[ \t]+.*\n|\n)*/m,
		''
	);

/** Whether `text` names `name` whole, not as the start of a longer name. */
const mentions = (text, name) =>
	text
		.split(name)
		.slice(1)
		.some((after) => !/^[\w.-]/.test(after));

/**
 * Fails unless the install at `root` applied `overrides`. A package overridden with a `file:`
 * tarball has no copy from anywhere else; an `a>b` override reaches only the `b` that `a` requires,
 * so each installed `a` must link a packed `b`. A package removed with `-` is absent from the
 * lockfile. A consumer need not install every overridden package.
 */
export function assertOverridesApplied(root, overrides) {
	const store = join(root, 'node_modules/.pnpm');
	const installed = readdirSync(store);
	const copiesOf = (name) => installed.filter((entry) => entry.startsWith(`${name}@`));
	const fail = (selector, found) =>
		`${selector} should resolve to the packed tarball, but the install has ${found}: the override was not applied`;
	for (const [selector, specifier] of Object.entries(overrides)) {
		const parts = selector.split('>');
		const target = parts.at(-1);
		const name = packageName(target);
		if (specifier === '-') {
			assert.ok(
				!mentions(resolvedText(root), bareName(target)),
				`${selector} was removed by an override but is locked`
			);
			continue;
		}
		if (!specifier.startsWith('file:')) continue;
		if (parts.length === 1) {
			const copies = copiesOf(name);
			const stray = copies.filter((copy) => !copy.startsWith(`${name}@file+`));
			assert.deepEqual(stray, [], fail(selector, copies.join(', ')));
			continue;
		}
		const parent = packageName(parts.at(-2));
		const dependency = bareName(target);
		for (const copy of copiesOf(parent)) {
			const link = join(store, copy, 'node_modules', dependency);
			if (!existsSync(link)) continue;
			const resolved = realpathSync(link);
			assert.ok(resolved.includes(`${name}@file+`), fail(`${selector} (in ${copy})`, resolved));
		}
	}
}

/**
 * The peer issue that a failed strict install at `log` reports for `name`, as
 * `{ installed, wanted: { <range>: [<package@version>, ...] } }`, or null when it reports none.
 * `kind` is `missing` or `unmet`.
 */
export function peerIssue(log, kind, name) {
	const lines = log.split(/\r?\n/);
	const start = lines.findIndex((line) => line.trim() === `✕ ${kind} peer ${name}`);
	if (start === -1) return null;
	const issue = { installed: null, wanted: {} };
	let range = null;
	for (const line of lines.slice(start + 1)) {
		if (!/^\s/.test(line)) break;
		const text = line.trim();
		if (text.startsWith('Installed: ')) issue.installed = text.slice('Installed: '.length);
		else if (text === 'Wanted:') continue;
		else if (text.endsWith(':')) {
			range = text.slice(0, -1).replace(/^"(.*)"$/, '$1');
			issue.wanted[range] = [];
		} else if (range) issue.wanted[range].push(text);
	}
	return issue;
}
