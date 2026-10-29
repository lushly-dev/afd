import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const json = (file, value) => writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
const hash = (value) => createHash('sha256').update(value).digest('hex');
export async function readGitState(root) {
	const run = async (...command) => (await execFile('git', ['-C', root, ...command])).stdout.trim();
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
