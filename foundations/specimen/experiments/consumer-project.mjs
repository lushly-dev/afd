import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { delimiter, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { contentDigest } from './inputs/freeze.mjs';

const execFile = promisify(execFileCallback);
const json = (file, value) => writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
const hash = (value) => createHash('sha256').update(value).digest('hex');
/**
 * A frozen T01 snapshot (inputs/freeze.mjs) has no `.git`; its manifest stands in for Git
 * state. SPECIMEN_FROZEN_MANIFESTS lists manifest files separated by the path delimiter. A
 * listed manifest naming this root takes precedence, even inside another work tree. It must
 * record no missing or modified tracked files, and the snapshot is re-hashed on every read so
 * edits after freezing, including edits during a job, show up as a non-empty status.
 */
async function readFrozenState(root) {
	const real = await realpath(root);
	for (const file of (process.env.SPECIMEN_FROZEN_MANIFESTS ?? '')
		.split(delimiter)
		.filter(Boolean)) {
		let text;
		let manifest;
		try {
			text = await readFile(file);
			manifest = JSON.parse(text.toString('utf8'));
		} catch (error) {
			throw new Error(`Cannot read frozen manifest ${file}: ${error.message}`);
		}
		if ((await realpath(manifest.snapshot).catch(() => manifest.snapshot)) !== real) continue;
		const { revision, tree, missing, modified, snapshotDigest } = manifest.source ?? {};
		if (!revision || !Array.isArray(missing) || !Array.isArray(modified) || !snapshotDigest?.sha256)
			throw new Error(
				`Frozen manifest ${file} lacks source binding fields; re-run inputs/freeze.mjs`
			);
		if (missing.length || modified.length)
			throw new Error(`Frozen snapshot does not match its revision: ${root}`);
		const observed = await contentDigest(root);
		return {
			root,
			revision,
			status: observed.sha256 === snapshotDigest.sha256 ? '' : 'snapshot changed since freeze',
			frozen: { tree, manifestSha256: hash(text), snapshotSha256: observed.sha256 },
		};
	}
	return undefined;
}

export async function readGitState(root) {
	const frozen = await readFrozenState(root);
	if (frozen) return frozen;
	const run = async (...command) => (await execFile('git', ['-C', root, ...command])).stdout.trim();
	const inside = await run('rev-parse', '--is-inside-work-tree').catch((error) => {
		throw new Error(
			`Consumer is neither a listed frozen snapshot nor a readable Git checkout: ${root} (${error.message.split('\n')[0]})`
		);
	});
	if (inside !== 'true')
		throw new Error(`Consumer is neither a listed frozen snapshot nor a Git checkout: ${root}`);
	return {
		root,
		revision: await run('rev-parse', 'HEAD'),
		status: await run('status', '--porcelain'),
	};
}
export async function prepareConsumerProject(descriptor, source, destination) {
	const before = await readGitState(source);
	if (before.status) throw new Error(`Consumer checkout must be clean: ${source}`);
	await mkdir(destination, { recursive: true });
	for (const path of descriptor.paths) {
		await mkdir(dirname(join(destination, path)), { recursive: true });
		await cp(join(source, path), join(destination, path), { recursive: true });
	}
	const dependencies = [];
	for (const link of descriptor.dependencyLinks) {
		const target = await realpath(join(source, link.from));
		await mkdir(dirname(join(destination, link.to)), { recursive: true });
		await symlink(target, join(destination, link.to), 'dir');
		dependencies.push({ ...link, target });
	}
	await writeFile(join(destination, 'probe.ts'), descriptor.source);
	await json(join(destination, 'specimen.config.json'), { specimens: descriptor.specimens });
	if (descriptor.tsconfig) await json(join(destination, 'tsconfig.json'), descriptor.tsconfig);
	for (const [file, content] of Object.entries(descriptor.generatedFiles ?? {})) {
		await mkdir(dirname(join(destination, file)), { recursive: true });
		await writeFile(join(destination, file), content);
	}
	const installed = [];
	for (const base of [
		'node_modules',
		'apps/web/node_modules',
		'packages/violet-elements/node_modules',
	]) {
		for (const name of [
			'vite',
			'vitest',
			'playwright',
			'storybook',
			'@lushly-dev/fast-element',
			'@microsoft/fast-element',
			'@lushly-dev/violet-elements',
		]) {
			try {
				const file = join(source, base, name, 'package.json');
				const pkg = JSON.parse(await readFile(file, 'utf8'));
				installed.push({ name, version: pkg.version, path: await realpath(file) });
			} catch {
				/* Absent packages are not part of this link's installed graph. */
			}
		}
	}
	const declaredInputs = [];
	for (const file of ['pnpm-lock.yaml', 'package.json', 'apps/web/package.json']) {
		try {
			declaredInputs.push({ file, sha256: hash(await readFile(join(source, file))) });
		} catch {
			/* This consumer may not have a web workspace or pnpm lockfile. */
		}
	}
	return {
		before,
		dependencies,
		installed,
		declaredInputs,
		wrapperSha256: hash(descriptor.source),
	};
}
