#!/usr/bin/env node
/**
 * The version step and the check for the tracks Changesets versions and something else publishes:
 * Python (`python-v*` to PyPI), Botcore (`botcore-v*` to PyPI), the Rust crate (`rust-v*` to
 * crates.io) and the contract changelog.
 *
 *   node scripts/release-track.mjs version <python|botcore|rust|spec> [--date YYYY-MM-DD] [--skip-tools]
 *   node scripts/release-track.mjs check
 *
 * `version` consumes the track's fragments in `.changeset/`: Changesets bumps the private stub in
 * a disposable worktree that holds nothing else, and this script copies the version to the
 * project's own files (for Rust, `Cargo.toml` and every `Cargo.lock` that builds the crate from
 * its path), writes the dated changelog section, locks the uv projects that depend on it and
 * records the rewritten imported files. It never tags or publishes; that is the
 * maintainer's, on the merged release commit (the cut-release skill).
 *
 * `check` fails on a hand edit where a fragment belongs, and on a stub that could publish or that
 * disagrees with the project it versions. A hand edit includes a hand-written `Unreleased` section
 * in the changelog Changesets writes for a published npm package: the change is recorded twice,
 * and every pull request inserts at the section's one line (#2666).
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import semver from 'semver';
import { readWorkspace } from './affected/workspace.mjs';
import { loadInventory, parseFragments, safePath } from './release/control.mjs';
import {
	assertTrackEntry,
	changelogFile,
	fences,
	foldContractChangelog,
	fragmentBody,
	ignores,
	plainPattern,
	readVersion,
	releaseChangelog,
	releaseHeadings,
	renderSection,
	setVersion,
	stubFile,
	TRACKS,
	unreleasedBody,
} from './release/tracks.mjs';
import { json, run, sourceDigest, tree } from './release-operations/shared.mjs';
import { inWorktree, runChangesetVersion } from './release-operations/version.mjs';

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const read = (root, file) => readFileSync(safePath(root, file), 'utf8');
const lf = (text) => text.replace(/\r\n/g, '\n');
/** The digest the contract stub pins: of the changelog as git stores it. */
export const changelogDigest = (text) => sha256(lf(text));
/** The workspace's packages with their directories and manifests. */
const workspacePackages = (root) =>
	readWorkspace(root).map(({ name, dir }) => ({
		name,
		dir: dir.split('\\').join('/'),
		manifest: json(join(root, dir, 'package.json')),
	}));

/**
 * Published packages' changelogs that still hold a hand-written `Unreleased` section, each with the
 * issue that removes it. An entry fails once its section is gone, so the list only shrinks.
 */
export const PENDING_UNRELEASED = {
	'foundations/fast-af/packages/violet-elements/CHANGELOG.md': '#2876',
};
/** The line of a heading that opens with Unreleased (`## [Unreleased]`, `# Unreleased changes`), or 0. */
export function unreleasedLine(changelog) {
	const inFence = fences();
	const index = lf(changelog)
		.split('\n')
		.findIndex((line) => !inFence(line) && /^#{1,6}[ \t]*\[?unreleased\b/i.test(line));
	return index + 1;
}

// ─── Check ───────────────────────────────────────────────────────────────────

/** Every way the tracks can be wrong, as `{ message, suggestion }`. */
export function checkTracks({ root, tracks = TRACKS, pendingUnreleased = PENDING_UNRELEASED }) {
	const problems = [];
	const problem = (message, suggestion) => problems.push({ message, suggestion });
	let inventory;
	try {
		inventory = loadInventory(root);
		// Without this storage no fragment is read, and every rule below would pass unseen.
		const storages = inventory.storages ?? [{ path: '.changeset', protocol: 'npm-changesets' }];
		if (
			!storages.some((entry) => entry.path === '.changeset' && entry.protocol === 'npm-changesets')
		)
			throw new Error(
				'scripts/release/inventory.json does not read .changeset as npm-changesets storage'
			);
		const stubVersion = (stub) =>
			existsSync(join(root, stub)) ? JSON.parse(read(root, stub)).version : null;
		for (const fragment of parseFragments(root, inventory)) {
			try {
				assertTrackEntry(fragment.file, fragment.packages, read(root, fragment.file), {
					tracks,
					stubVersion,
				});
			} catch (error) {
				problem(error.message, 'Fix the fragment (prepare-pr step 3 has the format)');
			}
		}
	} catch (error) {
		problem(error.message, 'Fix the fragment or the release inventory');
	}
	const config = json(join(root, '.changeset/config.json'));
	if (config.privatePackages?.version !== true)
		problem(
			'.changeset/config.json does not version private packages',
			'Set privatePackages.version to true: the tracks are private stubs'
		);
	if (config.privatePackages?.tag)
		problem('.changeset/config.json tags private packages', 'Set privatePackages.tag to false');
	const stubs = new Set(Object.values(tracks).map((track) => track.package));
	// With private packages versioned, any other private package would be bumped as a dependent.
	const workspace = workspacePackages(root);
	for (const { name, manifest } of workspace) {
		if (!manifest.private || stubs.has(name)) continue;
		if (!(config.ignore ?? []).some((pattern) => ignores(pattern, name)))
			problem(
				`The private package ${name} is not in the ignore list of .changeset/config.json`,
				'Add it: only the track stubs are versioned among private packages'
			);
	}
	for (const { name, dir, manifest } of workspace) {
		// A track keeps Keep a Changelog with an empty Unreleased, checked below.
		if (manifest.private || stubs.has(name)) continue;
		const changelogPath = posix.join(dir, 'CHANGELOG.md');
		if (!existsSync(join(root, changelogPath))) continue;
		const line = unreleasedLine(read(root, changelogPath));
		const issue = pendingUnreleased[changelogPath];
		if (line && !issue)
			problem(
				`${changelogPath}:${line} has a hand-written "Unreleased" section`,
				`Changesets writes ${name}'s changelog from its fragments: delete the section and record the change only as a file in .changeset/ (prepare-pr step 3)`
			);
		else if (!line && issue)
			problem(
				`${changelogPath} has no "Unreleased" section, but PENDING_UNRELEASED still lists it (${issue})`,
				'Remove its entry from PENDING_UNRELEASED in scripts/release-track.mjs'
			);
	}
	for (const [file, issue] of Object.entries(pendingUnreleased))
		if (
			!workspace.some(
				({ name, dir, manifest }) =>
					!manifest.private && !stubs.has(name) && posix.join(dir, 'CHANGELOG.md') === file
			)
		)
			problem(
				`PENDING_UNRELEASED lists ${file} (${issue}), which is not a published package's changelog`,
				'Remove the entry'
			);
		else if (!existsSync(join(root, file)))
			problem(
				`PENDING_UNRELEASED lists ${file} (${issue}), which does not exist`,
				'Remove the entry: there is no section left to remove'
			);
	for (const pattern of config.ignore ?? []) {
		// Changesets reads these as globs; this check reads names and `*`, so nothing else may hide
		// an exception to the list (a `!` pattern would take a package back out of it).
		if (!plainPattern(pattern))
			problem(
				`.changeset/config.json has the ignore pattern "${pattern}"`,
				'Use package names, with * for part of one, and nothing else'
			);
		if (Object.values(tracks).some((track) => ignores(pattern, track.package)))
			problem(`.changeset/config.json ignores a track stub with "${pattern}"`, 'Remove it');
		for (const { name, manifest } of workspace)
			if (!manifest.private && ignores(pattern, name))
				problem(
					`.changeset/config.json ignores the published package ${name} with "${pattern}"`,
					'The ignore list is for private packages only'
				);
	}

	for (const [name, track] of Object.entries(tracks)) {
		const stubPath = stubFile(track);
		if (!existsSync(join(root, stubPath))) {
			problem(`${stubPath} is missing`, `Restore the ${name} track's stub`);
			continue;
		}
		const stub = JSON.parse(read(root, stubPath));
		if (stub.name !== track.package || stub.private !== true || !semver.valid(stub.version))
			problem(
				`${stubPath} must be the private package ${track.package} with a semver version`,
				'The stub is never published; it only holds the version'
			);
		for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies', 'scripts'])
			if (stub[field])
				problem(`${stubPath} declares ${field}`, 'A stub holds a name and a version only');
		if (!workspace.some((entry) => entry.name === track.package))
			problem(`${track.directory} is not in pnpm-workspace.yaml`, 'Changesets reads the workspace');
		// The npm release selects admitted units with a route; a stub's unit has none.
		const unit = inventory?.units.find((entry) => entry.id === track.unit);
		const owned = unit?.distributions.length === 1 && unit.distributions[0].manifest === stubPath;
		if (
			!owned ||
			unit.protocol !== 'npm-changesets' ||
			unit.routes.length ||
			unit.state === 'admitted' ||
			unit.distributions[0].private !== true ||
			unit.distributions[0].name !== track.package
		)
			problem(
				`scripts/release/inventory.json must own ${stubPath} as the private unit ${track.unit}, not admitted and with no route`,
				'The npm release must never select a track stub'
			);

		for (const { file, kind, crate } of versionFilesOf(root, track)) {
			const stated = existsSync(join(root, file))
				? readVersion(read(root, file), kind, crate)
				: null;
			if (stated !== stub.version)
				problem(
					`${file} has version ${stated}, but ${stubPath} has ${stub.version}`,
					`pnpm version-track ${name} sets both; never set one by hand`
				);
		}

		const changelogPath = changelogFile(track);
		const changelog = read(root, changelogPath);
		if (track.format === 'keep-a-changelog') {
			const unreleased = unreleasedBody(changelog);
			if (!unreleased)
				problem(`${changelogPath} has no "## [Unreleased]" heading`, 'Restore it, empty');
			else if (unreleased.body)
				problem(
					`${changelogPath}:${unreleased.line} has an entry under "## [Unreleased]"`,
					`Move it to a fragment: a file in .changeset/ that opens with ---, "${track.package}": patch|minor, --- and holds the entry under "### Added", "### Changed" or "### Fixed" (prepare-pr step 3)`
				);
			// An entry under a `## ` heading of its own, or a whole section written by hand, would
			// otherwise sit below an empty Unreleased: every section is a release, the newest the stub's.
			const headings = releaseHeadings(changelog);
			for (const heading of headings.filter((entry) => !entry.version))
				problem(
					`${changelogPath}:${heading.line} has the heading "${heading.text}" below "## [Unreleased]"`,
					'Every section there is a release, "## [X.Y.Z] - YYYY-MM-DD"; an entry goes in a fragment'
				);
			const newest = headings.find((entry) => entry.version);
			if (unreleased && newest?.version !== stub.version)
				problem(
					`${changelogPath}:${newest?.line ?? 1} has ${newest?.version ?? 'no release'} as its newest section, but ${stubPath} has ${stub.version}`,
					`pnpm version-track ${name} writes the section and the version together; never write either by hand`
				);
		} else if (stub.afd?.changelogSha256 !== changelogDigest(changelog)) {
			problem(
				`${changelogPath} differs from the digest ${stubPath} pins`,
				`Write the entry as a fragment: a file in .changeset/ that opens with ---, "${track.package}": patch, --- and holds the paragraph. To correct an entry already folded, edit it and run node scripts/release-track.mjs pin ${name}`
			);
		}
	}
	return problems;
}

// ─── Version ─────────────────────────────────────────────────────────────────

/** Changesets' own bump of the stub, in a worktree whose workspace is that one package. */
function bumpStub({ root, track, fragments, invoke }) {
	const stubPath = stubFile(track);
	const selected = new Set(fragments.map((fragment) => fragment.file));
	const beforeDigest = sourceDigest(root);
	return inWorktree(root, (candidate) => {
		const configPath = join(candidate, '.changeset/config.json');
		writeFileSync(
			configPath,
			`${JSON.stringify(
				{
					...json(configPath),
					// This script writes the changelog: Changesets' sections are not Keep a Changelog's.
					changelog: false,
					fixed: [],
					linked: [],
					ignore: [],
					privatePackages: { version: true, tag: false },
				},
				null,
				'\t'
			)}\n`
		);
		writeFileSync(
			join(candidate, 'pnpm-workspace.yaml'),
			`${JSON.stringify({ packages: [track.directory], verifyDepsBeforeRun: false })}\n`
		);
		for (const [file] of tree(candidate, '.changeset'))
			if (file.endsWith('.md') && !file.endsWith('/README.md') && !selected.has(file))
				rmSync(join(candidate, file));
		const baseline = new Map(tree(candidate, '', { allowRepositoryMirror: true }));
		invoke(candidate);
		const after = new Map(tree(candidate, '', { allowRepositoryMirror: true }));
		for (const file of new Set([...baseline.keys(), ...after.keys()])) {
			if (baseline.get(file) === after.get(file)) continue;
			if (file !== stubPath && !(selected.has(file) && !after.has(file)))
				throw new Error(`Changesets wrote outside the ${track.package} track: ${file}`);
		}
		for (const file of selected)
			if (after.has(file)) throw new Error(`Changesets did not consume ${file}`);
		if (sourceDigest(root) !== beforeDigest)
			throw new Error('The checkout changed while versioning');
		return readFileSync(join(candidate, stubPath), 'utf8');
	});
}

/** A step as a line to paste into any shell at the repository root; every step runs from there. */
const commandLine = (step) =>
	`${step.command === process.execPath ? 'node' : step.command} ${step.args
		.map((argument) => (/^[\w./:=@-]+$/.test(argument) ? argument : JSON.stringify(argument)))
		.join(' ')}`;

/**
 * The files that state `track`'s version: its own, and for a Rust crate each tracked `Cargo.lock`
 * that builds the crate from its path, whichever project it belongs to.
 */
export function versionFilesOf(root, track) {
	if (!track.cargoCrate) return track.versionFiles;
	const locks = run('git', ['ls-files', '-z', '--', 'Cargo.lock', '*/Cargo.lock'], root)
		.split('\0')
		.filter(Boolean)
		// A lockfile deleted from the checkout but not yet from git states nothing.
		.filter((file) => existsSync(join(root, file)))
		.filter((file) => readVersion(read(root, file), 'cargo-lock', track.cargoCrate) !== null)
		.sort()
		.map((file) => ({ file, kind: 'cargo-lock', crate: track.cargoCrate }));
	return [...track.versionFiles, ...locks];
}

/** The uv projects that lock `directory` as an editable source, itself included. */
export function lockDirectories(root, directory) {
	return run('git', ['ls-files', '-z', '--', 'uv.lock', '*/uv.lock'], root)
		.split('\0')
		.filter(Boolean)
		.filter((file) => {
			const home = posix.dirname(file);
			return [...read(root, file).matchAll(/editable = "([^"]+)"/g)].some(
				([, target]) => posix.normalize(posix.join(home, target)).replace(/\/$/, '') === directory
			);
		})
		.map((file) => posix.dirname(file))
		.sort();
}

export function versionTrack({
	root,
	name,
	tracks = TRACKS,
	pendingUnreleased = PENDING_UNRELEASED,
	date = new Date().toISOString().slice(0, 10),
	tools = true,
	invoke = runChangesetVersion,
	execute = (command, args, cwd) => run(command, args, cwd),
}) {
	const track = tracks[name];
	if (!track) throw new Error(`Unknown track ${name}; expected ${Object.keys(tracks).join(', ')}`);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`--date takes YYYY-MM-DD: ${date}`);
	const problems = checkTracks({ root, tracks, pendingUnreleased });
	if (problems.length)
		throw new Error(`Fix the tracks first: ${problems.map((entry) => entry.message).join('; ')}`);
	const fragments = parseFragments(root, loadInventory(root)).filter((fragment) =>
		fragment.units.includes(track.unit)
	);
	if (!fragments.length)
		throw new Error(`No fragment in .changeset/ names ${track.package}; nothing to version`);
	const bodies = fragments.map((fragment) => fragmentBody(read(root, fragment.file)));
	const stubPath = stubFile(track);
	const previous = JSON.parse(read(root, stubPath)).version;
	const steps = [];
	if (track.versionFiles.length) {
		for (const directory of lockDirectories(root, track.directory))
			steps.push({
				command: 'uv',
				args: ['lock', '--directory', directory],
				lock: `${directory}/uv.lock`,
			});
		steps.push({
			command: process.execPath,
			args: ['scripts/check-versions.mjs', '--write'],
		});
	}
	const digest = (file) =>
		existsSync(join(root, file)) ? sha256(readFileSync(join(root, file))) : null;
	// The lockfiles this step has rewritten when it ends, as they are before it starts.
	const locks = new Map(
		steps.filter((step) => step.lock).map((step) => [step.lock, digest(step.lock)])
	);

	const stubText = bumpStub({ root, track, fragments, invoke });
	const stub = JSON.parse(stubText);
	const version = stub.version;
	if (!semver.valid(version) || !semver.gt(version, previous))
		throw new Error(`Changesets left ${track.package} at ${version}, from ${previous}`);

	const writes = new Map();
	for (const { file, kind, crate } of versionFilesOf(root, track))
		writes.set(file, setVersion(read(root, file), kind, version, file, crate));
	const changelogPath = changelogFile(track);
	const contract =
		track.contractLine || track.contractVersionFile ? read(root, 'spec/VERSION').trim() : null;
	const changelog =
		track.format === 'keep-a-changelog'
			? releaseChangelog(read(root, changelogPath), {
					section: renderSection({
						version,
						date,
						bodies,
						contract: track.contractLine ? contract : null,
					}),
					version,
					tagPrefix: track.tagPrefix,
				})
			: foldContractChangelog(read(root, changelogPath), { contract, bodies });
	writes.set(changelogPath, changelog);
	if (track.format === 'contract-prose') {
		stub.afd = { ...stub.afd, changelogSha256: changelogDigest(changelog) };
		writes.set(stubPath, `${JSON.stringify(stub, null, '\t')}\n`);
	} else writes.set(stubPath, stubText);
	// Nothing is written until every text is computed, so a refusal leaves the checkout as it was.
	for (const [file, text] of writes) writeFileSync(safePath(root, file), text);
	for (const fragment of fragments) rmSync(safePath(root, fragment.file));

	/**
	 * The record of each imported unit's files this step rewrote: the ones it wrote and the
	 * lockfiles it relocked, and of those only files the unit already records. A first record would
	 * enrol a file, and every later change to it, a routine relock included, would then fail the
	 * unit's provenance test. `relocked` leaves out a lockfile the lock left as it was.
	 */
	const provenanceSteps = (relocked) =>
		Object.values(tracks)
			.filter((entry) => entry.provenance)
			.flatMap((entry) => {
				const rows = new Set(
					json(join(root, entry.directory, entry.provenanceRecords)).files.map((row) => row.path)
				);
				const files = [
					...writes.keys(),
					...[...locks]
						.filter(([file, was]) => !relocked || digest(file) !== was)
						.map(([file]) => file),
				]
					.filter((file) => file.startsWith(`${entry.directory}/`))
					.map((file) => file.slice(entry.directory.length + 1))
					.filter((file) => rows.has(file))
					.sort();
				if (!files.length) return [];
				return [
					{
						command: 'uv',
						args: [
							'run',
							'--directory',
							entry.directory,
							'--no-project',
							'python',
							entry.provenance,
							'--refresh',
							'--reason',
							`Versioned by pnpm version-track ${name} (${track.package} ${version})`,
							...files,
						],
					},
				];
			});
	const ran = [];
	let owed = [];
	if (!tools) owed = [...steps, ...provenanceSteps(false)];
	else {
		const perform = (step, rest) => {
			try {
				execute(step.command, step.args, root);
			} catch (error) {
				// The version is written and its fragments are consumed, so a second run would find
				// nothing to version: name every command still to run instead.
				throw new Error(
					`${track.package} ${version} is written, but "${commandLine(step)}" failed: ${error.message}\nFix the cause, then run what is left by hand from the repository root, in order:\n${[step, ...rest()].map((entry) => `  ${commandLine(entry)}`).join('\n')}`
				);
			}
			ran.push(step);
		};
		for (const [index, step] of steps.entries())
			perform(step, () => [...steps.slice(index + 1), ...provenanceSteps(false)]);
		// After the locks: a Python release also rewrites the lockfile Botcore records.
		const records = provenanceSteps(true);
		for (const [index, step] of records.entries()) perform(step, () => records.slice(index + 1));
	}
	return {
		track: name,
		package: track.package,
		previous,
		version,
		tag: track.tagPrefix ? `${track.tagPrefix}${version}` : null,
		changed: [...writes.keys()].sort(),
		consumed: fragments.map((fragment) => fragment.file),
		ran: ran.map(commandLine),
		owed: owed.map(commandLine),
	};
}

/** Pin the contract changelog after a reviewed correction to an entry already folded. */
export function pinTrack({ root, name, tracks = TRACKS }) {
	const track = tracks[name];
	if (track?.format !== 'contract-prose') throw new Error('Only the spec track pins its changelog');
	const stubPath = stubFile(track);
	const stub = JSON.parse(read(root, stubPath));
	stub.afd = { ...stub.afd, changelogSha256: changelogDigest(read(root, changelogFile(track))) };
	writeFileSync(safePath(root, stubPath), `${JSON.stringify(stub, null, '\t')}\n`);
	return { track: name, pinned: stub.afd.changelogSha256 };
}

export function main(args = process.argv.slice(2), root = process.cwd()) {
	const [command, ...rest] = args;
	if (command === 'check') {
		if (rest.length) throw new Error('check takes no arguments');
		const problems = checkTracks({ root });
		for (const { message, suggestion } of problems) {
			console.error(`  ✘ ${message}`);
			console.error(`    💡 ${suggestion}\n`);
		}
		if (problems.length) {
			console.error(`  ✘ ${problems.length} release track problem(s)`);
			process.exitCode = 1;
		} else console.log(`  ✓ Release tracks agree: ${Object.keys(TRACKS).join(', ')}`);
		return problems;
	}
	if (command === 'pin') {
		if (rest.length !== 1) throw new Error('pin takes one track');
		const result = pinTrack({ root, name: rest[0] });
		console.log(JSON.stringify(result, null, '\t'));
		return result;
	}
	if (command !== 'version') throw new Error('Expected version <track>, check, or pin <track>');
	const [name, ...flags] = rest;
	const options = { root, name };
	for (let index = 0; index < flags.length; index++) {
		if (flags[index] === '--skip-tools') options.tools = false;
		else if (flags[index] === '--date' && flags[index + 1]) options.date = flags[++index];
		else throw new Error(`Unknown or incomplete argument: ${flags[index]}`);
	}
	const result = versionTrack(options);
	console.log(JSON.stringify(result, null, '\t'));
	return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		main(process.argv.slice(2), resolve(dirname(fileURLToPath(import.meta.url)), '..'));
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
