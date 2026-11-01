#!/usr/bin/env node
/**
 * The theme's scripts, run after `tsc` (they import the built `dist/index.js`):
 *
 *   node scripts/theme.mjs build            write dist/loam-theme.css, dist/loam-theme.json and
 *                                           dist/contract.json (theme:build)
 *   node scripts/theme.mjs check [--write]  compare the committed contract, the kernel's
 *                                           LAYOUT_DEFAULTS_V0, violet-elements' component export
 *                                           and its literal fallbacks with the tree (theme:check);
 *                                           --write rewrites contract/tokens.json first
 *   node scripts/theme.mjs export-components [--fallbacks]
 *                                           write violet-elements' tokens/violet-theme.export.json
 *                                           (theme:export-components); --fallbacks also rewrites
 *                                           every fallback in its src/ that differs from light
 *
 * This is tooling, not the package's runtime: `@lushly-dev/loam-kernel` is a development
 * dependency, read here only for `LAYOUT_DEFAULTS_V0`.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import * as kernel from '@lushly-dev/loam-kernel';
import {
	buildOutputs,
	checkTheme,
	fixFallbacks,
	lightValuesByProperty,
	sourceFiles,
} from '../dist/index.js';

const packageRoot = new URL('../', import.meta.url);
const contractPath = new URL('contract/tokens.json', packageRoot);
const distDirectory = new URL('dist/', packageRoot);
const violetElements = new URL(
	'../../../../foundations/fast-af/packages/violet-elements/',
	packageRoot
);
const components = {
	exportPath: new URL('tokens/violet-theme.export.json', violetElements),
	sourceDirectory: new URL('src/', violetElements),
};

/** Prints the broken references and returns whether there were any. */
function reportBroken(outputs) {
	for (const broken of outputs.resolved.brokenReferences)
		console.error(`${broken.tokenId} in ${broken.nodeId}: ${broken.message}`);
	return outputs.resolved.brokenReferences.length > 0;
}

async function build() {
	const outputs = await buildOutputs();
	if (reportBroken(outputs)) return 1;
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
		components,
	});
	for (const note of notes) console.log(`note: ${note}`);
	for (const error of errors) console.error(`error: ${error}`);
	if (errors.length > 0) return 1;
	console.log(
		`theme:check passed: ${Object.keys(outputs.contract.tokens).length} contract ids match the tree`
	);
	return 0;
}

async function exportComponents(rewriteFallbacks) {
	const outputs = await buildOutputs();
	if (reportBroken(outputs)) return 1;
	await writeFile(components.exportPath, outputs.componentExportJson);
	console.log(
		`theme:export-components wrote violet-elements/tokens/violet-theme.export.json (${outputs.componentExport.presets.light.length} component ids, ${Object.keys(outputs.componentExport.presets).join(', ')})`
	);
	if (!rewriteFallbacks) return 0;
	const lightValues = lightValuesByProperty(outputs.componentExport, outputs.contract);
	const edited = [];
	for (const { path, text } of await sourceFiles(components.sourceDirectory)) {
		const fixed = fixFallbacks(text, lightValues);
		if (fixed === text) continue;
		await writeFile(new URL(path, components.sourceDirectory), fixed);
		edited.push(path);
	}
	for (const path of edited) console.log(`rewrote fallbacks in violet-elements/src/${path}`);
	console.log(
		`${edited.length} files edited; run \`pnpm -F @lushly-dev/violet-elements cem:analyze\`, then record each changed file in foundations/fast-af/provenance/adaptations.json`
	);
	return 0;
}

async function main([command, ...flags]) {
	if (command === 'build') return build();
	if (command === 'check') return check(flags.includes('--write'));
	if (command === 'export-components') return exportComponents(flags.includes('--fallbacks'));
	console.error(`Unknown command '${command ?? ''}'; use 'build', 'check' or 'export-components'`);
	return 2;
}

process.exitCode = await main(process.argv.slice(2));
