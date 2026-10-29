#!/usr/bin/env node
/** Guard the npm intent alias; publication/versioning use their selected-unit controllers. */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverDistributions, loadInventory, parseFragments, safePath } from './control.mjs';

const require = createRequire(import.meta.url);
const reject = (message) => {
	throw new Error(message);
};

function validateArguments(args) {
	const command = args[0] && !args[0].startsWith('-') ? args[0] : 'add';
	if (!['add', 'status'].includes(command))
		reject(
			'Use pnpm version-packages or pnpm publish:npm for selected release operations; this alias supports add/status only'
		);
	const values = command === 'add' ? ['--since', '--message', '-m'] : ['--since', '--output', '-o'];
	const booleans =
		command === 'add'
			? ['--empty', '--open', '--help', '-h']
			: ['--verbose', '-v', '--since-master', '--help', '-h'];
	let output;
	for (let index = args[0] === command ? 1 : 0; index < args.length; index++) {
		const [flag, ...inline] = args[index].split('=');
		if (booleans.includes(flag) && (!inline.length || ['true', 'false'].includes(inline.join('='))))
			continue;
		if (!values.includes(flag)) reject(`Unsupported ${command} argument: ${args[index]}`);
		const value = inline.length ? inline.join('=') : args[++index];
		if (!value || value.startsWith('-')) reject(`Missing value for ${flag}`);
		if (['--output', '-o'].includes(flag)) output = value;
	}
	return { command, output };
}

export function runChangeset({
	root = process.cwd(),
	args = [],
	execute = (args, root) =>
		execFileSync(process.execPath, [require.resolve('@changesets/cli'), ...args], {
			cwd: root,
			stdio: 'inherit',
		}),
} = {}) {
	const { command, output } = validateArguments(args);
	const inventory = loadInventory(root);
	const storages = inventory.storages ?? [{ path: '.changeset', protocol: 'npm-changesets' }];
	const npmStorage = storages.filter((storage) => storage.protocol === 'npm-changesets');
	if (
		npmStorage.length !== 1 ||
		npmStorage[0].path !== '.changeset' ||
		storages.some(
			(storage) => storage.path === '.changeset' && storage.protocol !== 'npm-changesets'
		)
	)
		reject('The installed npm CLI requires sole npm ownership of .changeset');
	const fragments = parseFragments(root, { ...inventory, storages: npmStorage });
	const distributions = discoverDistributions(root, inventory, { formats: ['npm'] });
	for (const distribution of distributions) {
		const owner = inventory.units.find((unit) => unit.id === distribution.unit);
		if (owner?.protocol !== 'npm-changesets')
			reject(
				`Declare npm protocol ownership and quarantine before using Changesets: ${distribution.name}`
			);
	}
	if (output) {
		const path = safePath(root, output);
		if (
			!output.endsWith('.json') ||
			existsSync(path) ||
			storages.some((storage) => output === storage.path || output.startsWith(`${storage.path}/`))
		)
			reject('Status output must be a new JSON report outside fragment storage');
	}
	execute(args, root);
	return {
		command,
		protocol: 'npm-changesets',
		fragments: fragments.map((fragment) => fragment.file),
	};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		runChangeset({ args: process.argv.slice(2) });
	} catch (error) {
		console.error(`Changeset command rejected: ${error.message}`);
		process.exitCode = error.status || 1;
	}
}
