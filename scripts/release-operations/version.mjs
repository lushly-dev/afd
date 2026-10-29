import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { planRelease } from '../release/control.mjs';
import { json, run, safePath, sourceDigest, tree } from './shared.mjs';

/** Preserve Changesets' git-backed changelog behavior, restricting only its workspace inputs. */
export function inWorktree(root, callback) {
	const directory = mkdtempSync(join(tmpdir(), 'afd-release-'));
	const candidate = join(directory, 'candidate');
	run('git', ['worktree', 'add', '--detach', candidate, 'HEAD'], root);
	try {
		const files = run('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], root)
			.split('\0')
			.filter(Boolean);
		for (const file of files) {
			const source = safePath(root, file);
			const target = safePath(candidate, file);
			if (existsSync(source)) {
				mkdirSync(dirname(target), { recursive: true });
				cpSync(source, target);
			} else rmSync(target, { force: true });
		}
		if (existsSync(join(root, 'node_modules')))
			symlinkSync(join(root, 'node_modules'), join(candidate, 'node_modules'), 'dir');
		return callback(candidate);
	} finally {
		run('git', ['worktree', 'remove', '--force', candidate], root);
		rmSync(directory, { recursive: true, force: true });
	}
}

export function versionSelected({
	root,
	plan,
	inventory,
	invoke = (cwd) => run('pnpm', ['exec', 'changeset', 'version'], cwd),
}) {
	const current = planRelease({
		root,
		inventory,
		selectedUnits: plan.selectedUnits,
		registryEvidence: plan.registryEvidence,
	});
	if (current.digest !== plan.digest) throw new Error('Stale version plan');
	plan = current;
	const beforeDigest = sourceDigest(root);
	const allowed = new Set(
		plan.distributions.flatMap((distribution) => [
			distribution.manifest,
			`${dirname(distribution.manifest)}/CHANGELOG.md`,
		])
	);
	const fragments = new Set(plan.fragments.map((fragment) => fragment.file));
	return inWorktree(root, (candidate) => {
		const configPath = join(candidate, '.changeset/config.json');
		const config = json(configPath);
		const names = new Set(plan.distributions.map((distribution) => distribution.name));
		config.fixed = plan.selectedUnits
			.filter((id) => inventory.units.find((unit) => unit.id === id).fixed)
			.map((id) =>
				inventory.units
					.find((unit) => unit.id === id)
					.distributions.filter((distribution) => distribution.registry === 'npm')
					.map((distribution) => distribution.name)
			);
		config.linked = (config.linked ?? [])
			.map((group) => group.filter((name) => names.has(name)))
			.filter((group) => group.length);
		config.ignore = [];
		writeFileSync(configPath, `${JSON.stringify(config, null, '\t')}\n`);
		writeFileSync(
			join(candidate, 'pnpm-workspace.yaml'),
			`${JSON.stringify({ packages: plan.distributions.map((distribution) => dirname(distribution.manifest)) })}\n`
		);
		for (const entry of tree(candidate, '.changeset')) {
			if (entry[0].endsWith('.md') && !entry[0].endsWith('/README.md') && !fragments.has(entry[0]))
				rmSync(join(candidate, entry[0]));
		}
		const baseline = new Map(tree(candidate));
		invoke(candidate);
		const after = new Map(tree(candidate));
		const changed = [...new Set([...baseline.keys(), ...after.keys()])].filter(
			(file) => baseline.get(file) !== after.get(file)
		);
		for (const file of changed) {
			if (!allowed.has(file) && !(fragments.has(file) && !after.has(file)))
				throw new Error(`Changesets wrote outside selected release: ${file}`);
		}
		planRelease({
			root: candidate,
			inventory,
			selectedUnits: plan.selectedUnits,
			registryEvidence: plan.registryEvidence,
		});
		if (sourceDigest(root) !== beforeDigest)
			throw new Error('Release candidate changed while versioning');
		const writes = changed.map((file) => [
			file,
			after.has(file) ? readFileSync(join(candidate, file)) : null,
		]);
		for (const [file, contents] of writes) {
			const destination = safePath(root, file);
			if (contents === null) rmSync(destination);
			else {
				mkdirSync(dirname(destination), { recursive: true });
				writeFileSync(destination, contents);
			}
		}
		return { selectedUnits: plan.selectedUnits, changed };
	});
}
