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
import semver from 'semver';
import { assertChannelVersions, planRelease, releaseChannel } from '../release/control.mjs';
import { json, repositoryEntry, run, safePath, sourceDigest, tree } from './shared.mjs';

/** Preserve Changesets' git-backed changelog behavior, restricting only its workspace inputs. */
export function inWorktree(root, callback) {
	const files = run('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], root)
		.split('\0')
		.filter(Boolean);
	// Validate every source path before allocating or registering the disposable worktree.
	const inputs = files.map((file) => ({ file, ...repositoryEntry(root, file) }));
	const directory = mkdtempSync(join(tmpdir(), 'afd-release-'));
	const candidate = join(directory, 'candidate');
	run('git', ['worktree', 'add', '--detach', candidate, 'HEAD'], root);
	try {
		for (const input of inputs) {
			const target = repositoryEntry(candidate, input.file);
			if (target.kind === 'symlink') rmSync(target.absolute, { force: true });
			if (input.kind === 'symlink') {
				if (target.kind !== 'missing' && target.kind !== 'symlink')
					rmSync(target.absolute, { force: true });
				mkdirSync(dirname(target.absolute), { recursive: true });
				symlinkSync(input.target, target.absolute, 'dir');
			} else if (input.kind !== 'missing') {
				mkdirSync(dirname(target.absolute), { recursive: true });
				cpSync(input.absolute, target.absolute);
			} else rmSync(target.absolute, { force: true });
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
		const baseline = new Map(tree(candidate, '', { allowRepositoryMirror: true }));
		const channel = releaseChannel(inventory, plan.selectedUnits);
		const preState = join(candidate, '.changeset/pre.json');
		const preApplied = join(candidate, '.changeset/pre');
		// Changesets' prerelease mode, entered for this run only: each version's own prerelease
		// number is the state, so the next preview counts on from the published one.
		if (channel.route === 'npm-prerelease')
			writeFileSync(preState, `${JSON.stringify({ mode: 'pre', tag: channel.distTag })}\n`);
		const manifests = new Map(
			plan.distributions.map(({ manifest }) => [
				manifest,
				JSON.parse(readFileSync(join(candidate, manifest), 'utf8')),
			])
		);
		invoke(candidate);
		if (channel.route === 'npm-prerelease') {
			rmSync(preState);
			// Prerelease mode keeps the fragments it applied, moved to .changeset/pre; this release
			// has consumed them, and only them.
			const selected = new Set([...fragments].map((file) => file.replace(/^\.changeset\//, '')));
			for (const [file] of existsSync(preApplied) ? tree(candidate, '.changeset/pre') : []) {
				if (!selected.has(file.replace(/^\.changeset\/pre\//, '')))
					throw new Error(`Changesets applied an unselected fragment: ${file}`);
			}
			rmSync(preApplied, { recursive: true, force: true });
			for (const file of fragments) rmSync(join(candidate, file), { force: true });
		}
		const after = new Map(tree(candidate, '', { allowRepositoryMirror: true }));
		const changed = [...new Set([...baseline.keys(), ...after.keys()])].filter(
			(file) => baseline.get(file) !== after.get(file)
		);
		for (const file of changed) {
			if (!allowed.has(file) && !(fragments.has(file) && !after.has(file)))
				throw new Error(`Changesets wrote outside selected release: ${file}`);
		}
		// A dependent that a release leaves outside its peer range is bumped by patch and its range
		// narrowed (Changesets 3; Changesets 2 made it major). Narrowing a peer range breaks the
		// dependent's consumers, so it ships only with a major of the dependent. A `workspace:^` peer is
		// unchanged here and packs as the version it was built against: a preview line raises its floor
		// that way without a major (#1066). So does a major of that peer: the dependent is patched and
		// packs the new major as its floor, so add a major fragment for it by hand.
		for (const [manifest, before] of manifests) {
			const now = JSON.parse(readFileSync(join(candidate, manifest), 'utf8'));
			const peers = Object.keys(before.peerDependencies ?? {}).filter(
				(name) => now.peerDependencies?.[name] !== before.peerDependencies[name]
			);
			if (peers.length && semver.major(now.version) <= semver.major(before.version))
				throw new Error(
					`${now.name} ${before.version} -> ${now.version} changes its peer range on ${peers.join(', ')} without a major bump; add a major fragment for ${now.name} or widen its peer range`
				);
		}
		const versioned = planRelease({
			root: candidate,
			inventory,
			selectedUnits: plan.selectedUnits,
			registryEvidence: plan.registryEvidence,
		});
		assertChannelVersions(versioned.distributions, channel);
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
