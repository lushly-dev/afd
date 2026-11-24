#!/usr/bin/env node
/**
 * Guards `spec/vectors/` against unflagged regeneration drift (#1734).
 *
 * Enforces three invariants:
 * 1. Every `spec/vectors/*.json` file and every `spec/vectors/generate-*.mjs` script is classified
 *    in VECTOR_MANIFEST as specification-authored, format-generated, or legacy reference-generated.
 * 2. Whenever the TypeScript build outputs (`packages/core/dist` and `packages/server/dist`) are
 *    present — or when `--require-generators` is passed — every mechanically generated vector file
 *    must equal its generator's fresh output (deep JSON equality, ignoring formatting).
 * 3. Whenever a mechanically generated vector file differs from the base ref (AFD_BASE or
 *    origin/main), the branch must include an added or modified `.changeset/*.md` fragment whose
 *    body carries an explicit `Behaviour change:` (or `Behavior change:`) declaration.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Authoritative provenance of every file in `spec/vectors/`.
 *
 * - `authored`: written directly from `spec/*.md`. All new vector files MUST be authored.
 * - `format-generated`: computed from documented cryptographic or byte-padding formulas.
 * - `reference-generated`: legacy files produced from the TypeScript build (frozen set).
 */
export const VECTOR_MANIFEST = Object.freeze({
	'app-calls.json': { kind: 'authored' },
	'approval-tokens.json': {
		kind: 'format-generated',
		generator: 'generate-approval-tokens.mjs',
		needs: [
			'packages/core/dist/index.js',
			'packages/core/dist/canonical-json.js',
			'packages/server/dist/approval-crypto.js',
		],
	},
	'approver-client.json': {
		kind: 'format-generated',
		generator: 'generate-approver-client.mjs',
		needs: ['packages/core/dist/index.js', 'packages/core/dist/canonical-json.js'],
	},
	'batch-controls.json': {
		kind: 'reference-generated',
		generator: 'generate-batch-controls.mjs',
		needs: ['packages/core/dist/index.js'],
	},
	'dispatch.json': { kind: 'authored' },
	'error-codes.json': { kind: 'authored' },
	'execution-controls.json': { kind: 'authored' },
	'journal-context-cap.json': {
		kind: 'format-generated',
		generator: 'generate-journal-context-cap.mjs',
		needs: [
			'packages/core/dist/index.js',
			'packages/core/dist/canonical-json.js',
			'packages/server/dist/journal.js',
		],
	},
	'mcp-resources.json': { kind: 'authored' },
	'output-budgets.json': { kind: 'authored' },
	'output-schema.json': {
		kind: 'reference-generated',
		generator: 'generate-output-schema.mjs',
		needs: ['packages/core/dist/index.js'],
	},
	'pipeline-variables.json': {
		kind: 'reference-generated',
		generator: 'generate-pipeline-variables.mjs',
		needs: ['packages/core/dist/pipeline-variables.js'],
	},
	'recovery.json': { kind: 'authored' },
	'tool-strategies.json': { kind: 'authored' },
	'validation.json': {
		kind: 'reference-generated',
		generator: 'generate-validation.mjs',
		needs: ['packages/core/dist/index.js', 'packages/server/dist/index.js'],
	},
});

const BEHAVIOUR_CHANGE_PATTERN = /^\s*behaviou?r[- ]change\s*:/im;

/** Strip leading YAML frontmatter (`--- ... ---`) and return the fragment body. */
export function changesetBody(text) {
	const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/.exec(text);
	return match ? match[1] : text;
}

/** Check whether every `spec/vectors/*.json` and `generate-*.mjs` matches VECTOR_MANIFEST. */
export function checkVectorManifest(root = REPO_ROOT, manifest = VECTOR_MANIFEST) {
	const dir = join(root, 'spec', 'vectors');
	const entries = readdirSync(dir);
	const problems = [];

	const jsonFiles = entries.filter((name) => name.endsWith('.json')).sort();
	const generatorFiles = entries
		.filter((name) => name.startsWith('generate-') && name.endsWith('.mjs'))
		.sort();

	for (const file of jsonFiles) {
		if (!Object.hasOwn(manifest, file)) {
			problems.push(
				`spec/vectors/${file} is not classified in scripts/check-vector-drift.mjs (new vectors must be specification-authored and listed in VECTOR_MANIFEST)`
			);
		}
	}

	const claimedGenerators = new Set();
	for (const [file, info] of Object.entries(manifest)) {
		if (!existsSync(join(dir, file))) {
			problems.push(`VECTOR_MANIFEST lists spec/vectors/${file}, which does not exist`);
		}
		if (info.generator) {
			claimedGenerators.add(info.generator);
			if (!existsSync(join(dir, info.generator))) {
				problems.push(
					`VECTOR_MANIFEST lists generator spec/vectors/${info.generator} for ${file}, which does not exist`
				);
			}
		} else if (info.kind !== 'authored') {
			problems.push(
				`VECTOR_MANIFEST entry ${file} has kind '${info.kind}' without a generator script`
			);
		}
	}

	for (const generator of generatorFiles) {
		if (!claimedGenerators.has(generator)) {
			problems.push(`spec/vectors/${generator} is not claimed by any VECTOR_MANIFEST entry`);
		}
	}

	return problems;
}

/** True when at least one added/modified `.changeset/*.md` fragment flags a behaviour change. */
export function hasBehaviourChangeFragment(root, changedFiles) {
	const fragments = changedFiles.filter(
		(file) =>
			file.startsWith('.changeset/') &&
			file.endsWith('.md') &&
			file !== '.changeset/README.md' &&
			existsSync(join(root, file))
	);
	for (const file of fragments) {
		const content = readFileSync(join(root, file), 'utf8');
		if (BEHAVIOUR_CHANGE_PATTERN.test(changesetBody(content))) return true;
	}
	return false;
}

/**
 * Require a behaviour-change changeset fragment whenever any generated vector file changed
 * relative to the base ref.
 */
export function checkChangedVectors({
	root = REPO_ROOT,
	changedFiles = [],
	manifest = VECTOR_MANIFEST,
} = {}) {
	const changedGenerated = [];
	for (const file of changedFiles) {
		if (!file.startsWith('spec/vectors/') || !file.endsWith('.json')) continue;
		const name = file.slice('spec/vectors/'.length);
		const info = manifest[name];
		if (info && info.kind !== 'authored') {
			changedGenerated.push(file);
		}
	}
	if (changedGenerated.length === 0) return [];
	if (hasBehaviourChangeFragment(root, changedFiles)) return [];
	return [
		`Generated vector file(s) changed without a behaviour-change changeset fragment: ${changedGenerated.join(', ')}. Add a .changeset/*.md fragment whose body includes a "Behaviour change: ..." (or "Behavior change: ...") line describing the cross-language impact.`,
	];
}

/** Strip non-normative top-level generator metadata (`generatedWith`) before drift comparison. */
function withoutGeneratorMetadata(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
	const { generatedWith: _ignored, ...rest } = value;
	return rest;
}

/** Compare committed generated vector files against fresh generator output via `--stdout`. */
export function checkGeneratorDrift({
	root = REPO_ROOT,
	manifest = VECTOR_MANIFEST,
	requireGenerators = false,
	execNode = (scriptPath) =>
		execFileSync(process.execPath, [scriptPath, '--stdout'], {
			cwd: root,
			encoding: 'utf8',
			maxBuffer: 32 * 1024 * 1024,
		}),
} = {}) {
	const problems = [];
	const checked = [];
	const skipped = [];

	for (const [file, info] of Object.entries(manifest)) {
		if (!info.generator) continue;
		const missingDeps = (info.needs ?? []).filter((rel) => !existsSync(join(root, rel)));
		if (missingDeps.length > 0) {
			if (requireGenerators) {
				problems.push(
					`Cannot run spec/vectors/${info.generator} for ${file}: missing built output ${missingDeps.join(', ')}`
				);
			} else {
				skipped.push(file);
			}
			continue;
		}
		const committedPath = join(root, 'spec', 'vectors', file);
		const generatorPath = join(root, 'spec', 'vectors', info.generator);
		let generated;
		try {
			generated = JSON.parse(execNode(generatorPath));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			problems.push(`spec/vectors/${info.generator} failed: ${message}`);
			continue;
		}
		const committed = JSON.parse(readFileSync(committedPath, 'utf8'));
		if (
			!isDeepStrictEqual(withoutGeneratorMetadata(generated), withoutGeneratorMetadata(committed))
		) {
			problems.push(
				`spec/vectors/${file} differs from spec/vectors/${info.generator} output. Either fix the unintended regression, or intentionally regenerate the vector file and include a .changeset/*.md fragment with a "Behaviour change:" declaration.`
			);
		} else {
			checked.push(file);
		}
	}

	return { problems, checked, skipped };
}

/** Resolve changed files relative to AFD_BASE / origin/main plus uncommitted changes. */
export function resolveChangedFiles(root = REPO_ROOT, baseOverride = process.env.AFD_BASE) {
	const git = (args) =>
		execFileSync('git', args, {
			cwd: root,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		})
			.trim()
			.split('\n')
			.filter(Boolean);

	const candidates = baseOverride ? [baseOverride] : ['origin/main', 'main'];
	let baseRef;
	for (const candidate of candidates) {
		try {
			git(['rev-parse', '--verify', candidate]);
			baseRef = candidate;
			break;
		} catch {
			// Try next candidate.
		}
	}

	const changed = new Set();
	if (baseRef) {
		try {
			const mergeBase = git(['merge-base', baseRef, 'HEAD'])[0];
			if (mergeBase) {
				for (const file of git(['diff', '--name-only', `${mergeBase}..HEAD`])) changed.add(file);
			}
		} catch {
			// Fall back to direct diff.
			for (const file of git(['diff', '--name-only', baseRef, 'HEAD'])) changed.add(file);
		}
	}
	for (const file of git(['diff', '--name-only'])) changed.add(file);
	for (const file of git(['diff', '--cached', '--name-only'])) changed.add(file);
	for (const file of git(['ls-files', '--others', '--exclude-standard'])) changed.add(file);
	return [...changed].sort();
}

export function runVectorDriftCheck({
	root = REPO_ROOT,
	requireGenerators = false,
	changedFiles,
} = {}) {
	const files = changedFiles ?? resolveChangedFiles(root);
	const manifestProblems = checkVectorManifest(root);
	const changeProblems = checkChangedVectors({ root, changedFiles: files });
	const generatorResult = checkGeneratorDrift({ root, requireGenerators });
	return {
		problems: [...manifestProblems, ...changeProblems, ...generatorResult.problems],
		checked: generatorResult.checked,
		skipped: generatorResult.skipped,
	};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const requireGenerators = process.argv.includes('--require-generators');
	const result = runVectorDriftCheck({ requireGenerators });
	if (result.problems.length > 0) {
		for (const problem of result.problems) console.error(`ERROR: ${problem}`);
		process.exit(1);
	}
	const summary =
		result.checked.length > 0
			? `checked ${result.checked.length} generated vector(s)`
			: `manifest ok (${result.skipped.length} generator(s) skipped: dist not built)`;
	console.log(`check-vector-drift: ok (${summary})`);
}
