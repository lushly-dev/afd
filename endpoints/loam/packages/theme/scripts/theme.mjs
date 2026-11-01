#!/usr/bin/env node
/**
 * The theme's scripts, run after `tsc` (they import the built `dist/index.js`):
 *
 *   node scripts/theme.mjs build            write dist/loam-theme.css, dist/loam-theme.json and
 *                                           dist/contract.json (theme:build)
 *   node scripts/theme.mjs check [--write]  compare the committed contract and the kernel's
 *                                           LAYOUT_DEFAULTS_V0 with the tree (theme:check);
 *                                           --write rewrites contract/tokens.json first
 *
 * This is tooling, not the package's runtime: `@lushly-dev/loam-kernel` is a development
 * dependency, read here only for `LAYOUT_DEFAULTS_V0`.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import * as kernel from '@lushly-dev/loam-kernel';
import { buildOutputs, checkTheme } from '../dist/index.js';

const packageRoot = new URL('../', import.meta.url);
const contractPath = new URL('contract/tokens.json', packageRoot);
const distDirectory = new URL('dist/', packageRoot);

async function build() {
	const outputs = await buildOutputs();
	if (outputs.resolved.brokenReferences.length > 0) {
		for (const broken of outputs.resolved.brokenReferences)
			console.error(`${broken.tokenId} in ${broken.nodeId}: ${broken.message}`);
		return 1;
	}
	await mkdir(distDirectory, { recursive: true });
	for (const [name, content] of Object.entries(outputs.files))
		await writeFile(new URL(name, distDirectory), content);
	console.log(
		`theme:build wrote ${Object.keys(outputs.files).join(', ')} (${Object.keys(outputs.contract.tokens).length} tokens)`
	);
	return 0;
}

async function check(write) {
	const outputs = await buildOutputs();
	if (write) await writeFile(contractPath, outputs.files['contract.json']);
	const { errors, notes } = await checkTheme(contractPath, {
		outputs,
		layoutDefaults: kernel.LAYOUT_DEFAULTS_V0,
	});
	for (const note of notes) console.log(`note: ${note}`);
	for (const error of errors) console.error(`error: ${error}`);
	if (errors.length > 0) return 1;
	console.log(
		`theme:check passed: ${Object.keys(outputs.contract.tokens).length} contract ids match the tree`
	);
	return 0;
}

async function main([command, ...flags]) {
	if (command === 'build') return build();
	if (command === 'check') return check(flags.includes('--write'));
	console.error(`Unknown command '${command ?? ''}'; use 'build' or 'check'`);
	return 2;
}

process.exitCode = await main(process.argv.slice(2));
