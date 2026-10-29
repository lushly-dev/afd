#!/usr/bin/env node
/** Finalize verified npm uploads; never upload packages or overwrite GitHub state. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import semver from 'semver';
import { loadInventory } from './release/control.mjs';
import { readPublished, verifyPublished } from './release-operations/prerequisites.mjs';
import { notes, validatePlan } from './release-operations/publish.mjs';
import { json, run } from './release-operations/shared.mjs';

function verifyRepository(command, root, units) {
	const inventory = loadInventory(root);
	const authorities = units.map(
		(id) =>
			inventory.units
				.find((unit) => unit.id === id)
				?.authority.match(/^github:\s*([^/]+\/[^/]+)$/)?.[1]
	);
	for (const args of [
		['remote', 'get-url', 'origin'],
		['remote', 'get-url', '--push', 'origin'],
	]) {
		const remote = command('git', args, root).trim();
		const repository = remote.match(
			/^(?:https:\/\/github\.com\/|git@github\.com:)([^/]+\/[^/]+?)(?:\.git)?$/
		)?.[1];
		if (!repository || authorities.some((authority) => authority !== repository))
			throw new Error('GitHub repository does not match approved publisher authority');
	}
}
function remoteTarget(output, tag) {
	const lines = output
		.trim()
		.split('\n')
		.filter(Boolean)
		.map((line) => line.split(/\s+/));
	if (!lines.length) return null;
	const peeled = lines.find(([, ref]) => ref === `refs/tags/${tag}^{}`);
	const direct = lines.find(([, ref]) => ref === `refs/tags/${tag}`);
	if (
		!direct ||
		lines.some(([, ref]) => ![`refs/tags/${tag}`, `refs/tags/${tag}^{}`].includes(ref))
	)
		throw new Error(`Unexpected remote tag response: ${tag}`);
	return (peeled ?? direct)[0];
}
function releaseFor(command, root, tag) {
	try {
		return JSON.parse(
			command('gh', ['api', `repos/{owner}/{repo}/releases/tags/${encodeURIComponent(tag)}`], root)
		);
	} catch (error) {
		if (/HTTP 404/.test(error.stderr?.toString() ?? '')) return null;
		throw error;
	}
}
function verifyRelease(release, entry) {
	if (
		release &&
		(release.tag_name !== entry.tag ||
			release.body !== entry.notes ||
			release.draft ||
			release.prerelease !== Boolean(semver.prerelease(entry.version)))
	)
		throw new Error(`Existing GitHub release differs; reconcile ${entry.tag}`);
}
export function finalizeRelease({
	root,
	receipt,
	plan,
	receiptFile,
	command = run,
	readback = readPublished,
}) {
	if (!receiptFile) throw new Error('Finalization requires a durable receipt path');
	if (
		receipt.state !== 'complete' ||
		receipt.binding !== plan.binding ||
		receipt.sourceRevision !== plan.sourceRevision ||
		receipt.intentDigest !== plan.intentDigest ||
		!Array.isArray(receipt.publishedPackages) ||
		receipt.publishedPackages.length !== plan.artifacts.length ||
		receipt.finalization?.state === 'held' ||
		receipt.finalization?.state === 'running'
	)
		throw new Error('Invalid or unresolved publication receipt; reconcile before finalization');
	validatePlan(root, plan, plan.core.registryEvidence);
	verifyRepository(command, root, plan.core.selectedUnits);
	const head = command('git', ['rev-parse', 'HEAD'], root).trim();
	if (head !== plan.sourceRevision) throw new Error('Finalization candidate revision changed');
	const seen = new Set();
	const expected = receipt.publishedPackages.map((entry) => {
		const artifact = plan.artifacts.find(
			(artifact) => artifact.name === entry.name && artifact.version === entry.version
		);
		if (
			!artifact ||
			seen.has(entry.name) ||
			entry.tag !== `${entry.name}@${entry.version}` ||
			entry.notes !== notes(root, artifact)
		)
			throw new Error('Publication receipt is outside the approved plan');
		seen.add(entry.name);
		const target = command(
			'git',
			['rev-parse', '--verify', `refs/tags/${entry.tag}^{commit}`],
			root
		).trim();
		if (target !== head)
			throw new Error(`Local tag does not resolve to approved candidate: ${entry.tag}`);
		verifyPublished(artifact, readback);
		const remote = remoteTarget(
			command(
				'git',
				['ls-remote', '--tags', 'origin', `refs/tags/${entry.tag}`, `refs/tags/${entry.tag}^{}`],
				root
			),
			entry.tag
		);
		if (remote && remote !== head) throw new Error(`Remote tag differs; reconcile ${entry.tag}`);
		const release = releaseFor(command, root, entry.tag);
		verifyRelease(release, entry);
		if (release && !remote)
			throw new Error(`GitHub release has no verified remote tag: ${entry.tag}`);
		return { entry, remote, release };
	});
	const temporary = mkdtempSync(join(tmpdir(), 'afd-release-notes-'));
	const save = () => writeFileSync(receiptFile, `${JSON.stringify(receipt, null, '\t')}\n`);
	try {
		for (const [index, item] of expected.entries()) {
			if (item.remote && item.release) continue;
			receipt.finalization = { state: 'running', head, tag: item.entry.tag };
			save();
			if (!item.remote) {
				command(
					'git',
					['push', 'origin', `refs/tags/${item.entry.tag}:refs/tags/${item.entry.tag}`],
					root
				);
				const remote = remoteTarget(
					command(
						'git',
						[
							'ls-remote',
							'--tags',
							'origin',
							`refs/tags/${item.entry.tag}`,
							`refs/tags/${item.entry.tag}^{}`,
						],
						root
					),
					item.entry.tag
				);
				if (remote !== head) throw new Error(`Remote tag readback failed: ${item.entry.tag}`);
			}
			if (!item.release) {
				const noteFile = join(temporary, `${index}.md`);
				writeFileSync(noteFile, item.entry.notes);
				command(
					'gh',
					[
						'release',
						'create',
						item.entry.tag,
						'--verify-tag',
						...(semver.prerelease(item.entry.version) ? ['--prerelease'] : []),
						'--title',
						item.entry.tag,
						'--notes-file',
						noteFile,
					],
					root
				);
				const release = releaseFor(command, root, item.entry.tag);
				if (!release) throw new Error(`GitHub release readback missing: ${item.entry.tag}`);
				verifyRelease(release, item.entry);
			}
		}
		receipt.finalization = {
			state: 'complete',
			head,
			tags: expected.map(({ entry }) => entry.tag),
		};
		save();
		return receipt.finalization;
	} catch (error) {
		receipt.finalization = { state: 'held', head, reason: error.message };
		save();
		throw new Error(`Finalization held; reconcile ${receiptFile}: ${error.message}`);
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
}
export function main(args = process.argv.slice(2)) {
	if (args.length !== 2)
		throw new Error('Usage: release-finalize.mjs <publication-receipt.json> <bound-plan.json>');
	const receiptFile = resolve(args[0]);
	const result = finalizeRelease({
		root: process.cwd(),
		receipt: json(receiptFile),
		plan: json(resolve(args[1])),
		receiptFile,
	});
	process.stdout.write(`${JSON.stringify(result, null, '\t')}\n`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		main();
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
