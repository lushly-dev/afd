import { cpSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import semver from 'semver';
import {
	assertAdmission,
	discoverDistributions,
	loadInventory,
	planRelease,
} from '../release/control.mjs';
import { intentFile, readIntent } from './intent.mjs';
import { dependencyOrder, readPublished, verifyPublished } from './prerequisites.mjs';
import {
	hash,
	json,
	readRegistry,
	registryNames,
	registryUrl,
	run,
	sourceDigest,
	tree,
} from './shared.mjs';
import { inWorktree } from './version.mjs';

const fields = ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies'];
const seal = (record) => ({ ...record, binding: hash(JSON.stringify(record)) });
function verifySeal(plan) {
	const { binding, ...record } = plan;
	if (hash(JSON.stringify(record)) !== binding) throw new Error('Release plan binding changed');
}
export function packedManifest(file) {
	const listing = run('tar', ['-tzf', file], process.cwd()).trim().split('\n');
	if (listing.filter((entry) => entry === 'package/package.json').length !== 1)
		throw new Error('Archive must contain exactly one package manifest');
	return JSON.parse(run('tar', ['-xOzf', file, 'package/package.json'], process.cwd()));
}
function converted(range, name, all) {
	if (!range.startsWith('workspace:')) return range;
	const alias = range.match(/^workspace:((?:@[^/\s]+\/)?[^@\s]+)@(.+)$/);
	if (alias) return `npm:${alias[1]}@${converted(`workspace:${alias[2]}`, alias[1], all)}`;
	const dependency = all.find((entry) => entry.name === name && entry.registry === 'npm');
	if (!dependency) throw new Error(`Unknown workspace dependency: ${name}`);
	const suffix = range.slice(10);
	if (suffix === '*') return dependency.version;
	if (suffix === '^' || suffix === '~') return `${suffix}${dependency.version}`;
	if (semver.validRange(suffix)) return suffix;
	throw new Error(`Unsupported workspace dependency: ${name}@${range}`);
}
export function validatePacked({
	root,
	distribution,
	metadata,
	all = discoverDistributions(root),
}) {
	const manifest = json(join(root, distribution.manifest));
	if (
		metadata.name !== distribution.name ||
		metadata.version !== distribution.version ||
		metadata.private === true
	)
		throw new Error(`Packed identity changed: ${distribution.name}`);
	if (
		metadata.publishConfig?.registry &&
		metadata.publishConfig.registry.replace(/\/$/, '') !== registryUrl
	)
		throw new Error(`Unapproved packed registry: ${distribution.name}`);
	for (const field of fields) {
		const expected = Object.fromEntries(
			Object.entries(manifest[field] ?? {}).map(([name, range]) => [
				name,
				converted(range, name, all),
			])
		);
		const actual = metadata[field] ?? {};
		if (
			JSON.stringify(Object.entries(expected).sort()) !==
			JSON.stringify(Object.entries(actual).sort())
		)
			throw new Error(`Packed ${field} changed: ${distribution.name}`);
		for (const range of Object.values(actual))
			if (/^(workspace:|file:|link:)/.test(range))
				throw new Error(`Nonportable packed dependency: ${range}`);
	}
	return hash(JSON.stringify(fields.map((field) => [field, metadata[field] ?? {}])));
}
export function packSelected({
	root,
	plan,
	outputDirectory,
	pack = (directory, destination) =>
		run('pnpm', ['pack', '--pack-destination', destination], directory),
}) {
	mkdirSync(outputDirectory, { recursive: true });
	const all = discoverDistributions(root);
	return inWorktree(root, (candidate) =>
		plan.distributions.map((distribution, index) => {
			const source = join(root, dirname(distribution.manifest));
			const directory = join(candidate, dirname(distribution.manifest));
			tree(source); // Reject symlinked artifact inputs before copying ignored build output.
			// Built output is commonly ignored by git; retain it in the disposable pack candidate.
			cpSync(source, directory, {
				recursive: true,
				filter: (file) => !file.split('/').includes('node_modules'),
			});
			// pnpm resolves workspace: metadata through installed links when packing.
			for (const dependency of all.filter((entry) => entry.registry === 'npm')) {
				const link = join(directory, 'node_modules', dependency.name);
				mkdirSync(dirname(link), { recursive: true });
				if (!existsSync(link))
					symlinkSync(join(candidate, dirname(dependency.manifest)), link, 'dir');
			}
			const sourceManifest = json(join(root, distribution.manifest));
			for (const field of fields)
				for (const [key, range] of Object.entries(sourceManifest[field] ?? {})) {
					const alias = range.match(/^workspace:((?:@[^/\s]+\/)?[^@\s]+)@(.+)$/);
					const dependency = alias && all.find((entry) => entry.name === alias[1]);
					if (dependency) {
						const link = join(directory, 'node_modules', key);
						mkdirSync(dirname(link), { recursive: true });
						if (!existsSync(link))
							symlinkSync(join(candidate, dirname(dependency.manifest)), link, 'dir');
					}
				}
			const destination = join(outputDirectory, String(index));
			mkdirSync(destination, { recursive: true });
			pack(directory, destination);
			const tarballs = run(
				'find',
				[destination, '-maxdepth', '1', '-name', '*.tgz', '-type', 'f'],
				root
			)
				.trim()
				.split('\n')
				.filter(Boolean);
			if (tarballs.length !== 1)
				throw new Error(`Expected one packed artifact: ${distribution.name}`);
			const file = resolve(tarballs[0]);
			const metadata = packedManifest(file);
			return {
				...distribution,
				file,
				filename: basename(file),
				artifactHash: hash(readFileSync(file)),
				dependencyHash: validatePacked({ root, distribution, metadata, all }),
				metadataHash: hash(JSON.stringify(metadata)),
			};
		})
	);
}
export function createPublishPlan({
	root,
	selectedUnits,
	registryEvidence,
	route = 'npm-main',
	distTag = 'latest',
	artifactsDirectory,
	exclude = [],
	pack,
}) {
	const intent = readIntent(root);
	const sourceRevision = run('git', ['rev-parse', 'HEAD'], root).trim();
	selectedUnits ??= intent.selectedUnits;
	if (
		JSON.stringify([...selectedUnits].sort()) !== JSON.stringify([...intent.selectedUnits].sort())
	)
		throw new Error('Selected units differ from reviewed release intent');
	if (!['npm-main', 'npm-prerelease', 'npm-manual'].includes(route))
		throw new Error(`Unknown npm route: ${route}`);
	if (!/^[a-zA-Z][a-zA-Z0-9._-]*$/.test(distTag) || semver.validRange(distTag))
		throw new Error('Invalid npm distribution tag');
	if (route === 'npm-prerelease' && distTag === 'latest')
		throw new Error('Prerelease requires an explicit non-latest npm tag');
	const inventory = loadInventory(root);
	for (const unit of selectedUnits) assertAdmission({ root, inventory, unit, route });
	registryNames(root, selectedUnits); // Reject unsupported evidence routes before packing.
	const core = planRelease({
		root,
		inventory,
		selectedUnits,
		registryEvidence: structuredClone(registryEvidence),
	});
	if (core.distributions.some((distribution) => distribution.registry !== 'npm'))
		throw new Error('npm plan contains a non-npm distribution');
	if (
		route === 'npm-main' &&
		core.distributions.some((distribution) => semver.prerelease(distribution.version))
	)
		throw new Error('Prerelease requires an admitted prerelease route');
	const source = sourceDigest(root, exclude);
	const artifacts = packSelected({ root, plan: core, outputDirectory: artifactsDirectory, pack });
	if (run('git', ['rev-parse', 'HEAD'], root).trim() !== sourceRevision)
		throw new Error('Release source revision changed while packing');
	if (sourceDigest(root, exclude) !== source)
		throw new Error('Release source changed while packing');
	return seal({
		schemaVersion: 1,
		route,
		distTag,
		sourceRevision,
		intentPath: intentFile,
		intentDigest: intent.intentDigest,
		core,
		sourceDigest: source,
		exclude,
		artifacts,
	});
}
export function validatePlan(root, plan, evidence) {
	verifySeal(plan);
	if (run('git', ['rev-parse', 'HEAD'], root).trim() !== plan.sourceRevision)
		throw new Error('Stale release candidate revision');
	const intent = readIntent(root);
	if (
		plan.intentPath !== intentFile ||
		plan.intentDigest !== intent.intentDigest ||
		JSON.stringify([...plan.core.selectedUnits].sort()) !==
			JSON.stringify([...intent.selectedUnits].sort())
	)
		throw new Error('Release plan differs from reviewed intent');
	const inventory = loadInventory(root);
	if (sourceDigest(root, plan.exclude) !== plan.sourceDigest)
		throw new Error('Stale release source plan');
	const current = planRelease({
		root,
		inventory,
		selectedUnits: plan.core.selectedUnits,
		registryEvidence: evidence,
	});
	if (current.candidateDigest !== plan.core.candidateDigest)
		throw new Error('Stale release candidate plan');
	const all = discoverDistributions(root, inventory);
	if (plan.artifacts.length !== current.distributions.length)
		throw new Error('Incomplete release artifacts');
	for (const distribution of current.distributions) {
		assertAdmission({ root, inventory, unit: distribution.unit, route: plan.route });
		const artifact = plan.artifacts.find(
			(entry) => entry.name === distribution.name && entry.manifest === distribution.manifest
		);
		if (
			!artifact ||
			artifact.version !== distribution.version ||
			artifact.registry !== 'npm' ||
			artifact.unit !== distribution.unit ||
			artifact.manifestHash !== distribution.manifestHash ||
			artifact.filename !== basename(artifact.file)
		)
			throw new Error('Artifact is outside selected release');
		if (hash(readFileSync(artifact.file)) !== artifact.artifactHash)
			throw new Error(`Artifact changed: ${artifact.name}`);
		const metadata = packedManifest(artifact.file);
		if (
			hash(JSON.stringify(metadata)) !== artifact.metadataHash ||
			validatePacked({ root, distribution, metadata, all }) !== artifact.dependencyHash
		)
			throw new Error(`Artifact metadata changed: ${artifact.name}`);
	}
	return current;
}
export function notes(root, artifact) {
	const file = join(root, dirname(artifact.manifest), 'CHANGELOG.md');
	if (!existsSync(file)) return `${artifact.name} ${artifact.version}`;
	const body = readFileSync(file, 'utf8');
	return (
		body
			.split(/^## /m)
			.find(
				(section) =>
					section.startsWith(`${artifact.version}\n`) || section.startsWith(`[${artifact.version}]`)
			)
			?.trim() ?? `${artifact.name} ${artifact.version}`
	);
}
export function publishPlan({
	root,
	plan,
	receiptFile,
	registry = readRegistry,
	readback = readPublished,
	publisher = (artifact) =>
		run(
			'npm',
			[
				'publish',
				artifact.file,
				...(artifact.name.startsWith('@')
					? [`--${artifact.name.split('/')[0]}:registry=${registryUrl}`]
					: []),
				'--registry',
				registryUrl,
				'--access',
				'public',
				'--tag',
				plan.distTag,
				'--ignore-scripts',
			],
			root
		),
	tagger = (tag) => run('git', ['tag', '-a', tag, '-m', tag], root),
	previouslyPublished = [],
}) {
	if (!receiptFile) throw new Error('Publication requires a durable receipt path');
	if (existsSync(receiptFile))
		throw new Error('Existing publication receipt requires explicit reconciliation');
	validatePlan(root, plan, plan.core.registryEvidence);
	const knownPublished = new Set();
	for (const entry of previouslyPublished) {
		const artifact = plan.artifacts.find(
			(a) => a.name === entry.name && a.version === entry.version
		);
		if (!artifact || knownPublished.has(entry.name))
			throw new Error('Invalid previously verified publication set');
		verifyPublished(artifact, () => ({
			name: entry.name,
			version: entry.version,
			dist: { integrity: entry.integrity },
		}));
		knownPublished.add(entry.name);
	}
	const readEvidence = () =>
		registryNames(root, plan.core.selectedUnits).map((name) => {
			const result = registry(name);
			if (
				result?.registry !== 'npm' ||
				result.name !== name ||
				!Array.isArray(result.versions) ||
				result.versions.some((version) => !semver.valid(version))
			)
				throw new Error(`Unknown registry outcome: ${name}`);
			return result;
		});
	let evidence = readEvidence();
	validatePlan(root, plan, evidence);
	const ordered = dependencyOrder(root, plan.artifacts, packedManifest);
	for (const artifact of ordered) {
		if (
			knownPublished.has(artifact.name) ||
			evidence.find((entry) => entry.name === artifact.name)?.versions.includes(artifact.version)
		)
			continue;
		const tag = `${artifact.name}@${artifact.version}`;
		try {
			run('git', ['rev-parse', '--verify', `refs/tags/${tag}`], root);
			throw new Error(`Release tag already exists: ${tag}`);
		} catch (error) {
			if (error.message.startsWith('Release tag already exists')) throw error;
		}
	}
	const receipt = {
		binding: plan.binding,
		intentDigest: plan.intentDigest,
		sourceRevision: plan.sourceRevision,
		state: 'ready',
		publishedPackages: [],
	};
	const save = () => writeFileSync(receiptFile, `${JSON.stringify(receipt, null, '\t')}\n`);
	for (const artifact of ordered) {
		const tag = `${artifact.name}@${artifact.version}`;
		try {
			evidence = readEvidence();
			validatePlan(root, plan, evidence);
			if (
				knownPublished.has(artifact.name) ||
				evidence.find((entry) => entry.name === artifact.name)?.versions.includes(artifact.version)
			) {
				receipt.state = 'checking';
				receipt.current = artifact.name;
				save();
				const observed = verifyPublished(artifact, readback);
				receipt.verifiedArtifacts ??= [];
				receipt.verifiedArtifacts.push(observed);
				receipt.publishedPackages.push({
					name: artifact.name,
					version: artifact.version,
					tag,
					publication: 'previously-published',
					notes: notes(root, artifact),
				});
				let target;
				try {
					target = run('git', ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`], root).trim();
				} catch {
					tagger(tag);
				}
				if (target && target !== plan.sourceRevision)
					throw new Error(`Existing release tag differs: ${tag}`);
				save();
				continue;
			}
			receipt.state = 'publishing';
			receipt.current = artifact.name;
			save();
			publisher(artifact);
			const observed = verifyPublished(artifact, readback);
			receipt.verifiedArtifacts ??= [];
			receipt.verifiedArtifacts.push(observed);
			receipt.publishedPackages.push({
				name: artifact.name,
				version: artifact.version,
				tag: `${artifact.name}@${artifact.version}`,
				notes: notes(root, artifact),
			});
			receipt.state = 'published';
			save();
			tagger(`${artifact.name}@${artifact.version}`);
		} catch (error) {
			if (!existsSync(receiptFile)) throw error;
			receipt.state = 'held';
			receipt.reason = error.message;
			save();
			throw new Error(`Publication held; reconcile receipt ${receiptFile}: ${error.message}`);
		}
	}
	receipt.state = 'complete';
	delete receipt.current;
	save();
	return receipt;
}
