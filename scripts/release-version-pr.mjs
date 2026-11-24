#!/usr/bin/env node
/**
 * Creates or refreshes a route-specific npm version pull request (`changeset-release/npm-main`
 * or `changeset-release/npm-prerelease`) without touching the caller's checkout (#2406).
 *
 * `changesets/action` v2 hardcodes its head branch to `changeset-release/<base>`, which forces
 * stable (`npm-main`) and preview (`npm-prerelease`) releases onto one branch. Running each
 * automatic route in its own disposable git worktree lets both version PRs coexist cleanly
 * against `main` while preserving single-author commits (`release-pr-author.mjs`) and the
 * guarded versioning pipeline (`release-control.mjs version --route <route>`).
 *
 *   node scripts/release-version-pr.mjs --route npm-main
 *   node scripts/release-version-pr.mjs --route npm-prerelease
 */
import {
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AUTOMATIC_ROUTES, loadInventory, releaseChannel } from './release/control.mjs';
import { readIntent } from './release-operations/intent.mjs';
import { run } from './release-operations/shared.mjs';
import { openVersionPr, releaseBranch, resolveAuthor, verifyAuthor } from './release-pr-author.mjs';

export const ROUTE_PR_CONFIG = Object.freeze({
	'npm-main': Object.freeze({
		branch: releaseBranch('main', 'npm-main'),
		title: 'chore: release packages',
		commitMessage: 'chore: release packages',
	}),
	'npm-prerelease': Object.freeze({
		branch: releaseBranch('main', 'npm-prerelease'),
		title: 'chore: release prerelease packages',
		commitMessage: 'chore: release prerelease packages',
	}),
});

export function routeConfig(route) {
	const config = ROUTE_PR_CONFIG[route];
	if (!config || !AUTOMATIC_ROUTES.includes(route)) {
		throw new Error(
			`Unsupported release PR route: ${route || '(none)'}; expected one of ${AUTOMATIC_ROUTES.join(', ')}`
		);
	}
	return config;
}

/** Git extraheader overrides so `git push` authenticates with `token` instead of checkout's default. */
export function pushCredentials(token, { mask = false, log = console.log } = {}) {
	if (!token) return {};
	const credential = Buffer.from(`x-access-token:${token}`).toString('base64');
	if (mask) log(`::add-mask::${credential}`);
	return {
		GIT_CONFIG_COUNT: '2',
		GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
		GIT_CONFIG_VALUE_0: '',
		GIT_CONFIG_KEY_1: 'http.https://github.com/.extraheader',
		GIT_CONFIG_VALUE_1: `AUTHORIZATION: basic ${credential}`,
	};
}

/**
 * Populates a real ignored `node_modules/` directory inside `candidate` with links to each
 * top-level entry of `root/node_modules`. A top-level `node_modules` symlink is NOT ignored by
 * `.gitignore`'s directory-only `node_modules/` rule, so Git lists it and `sourceDigest` rejects
 * it as an untracked symlink.
 */
function linkNodeModules(root, candidate) {
	const source = join(root, 'node_modules');
	if (!existsSync(source)) return [];
	const target = join(candidate, 'node_modules');
	mkdirSync(target, { recursive: true });
	const dirLinkType = process.platform === 'win32' ? 'junction' : 'dir';
	const entries = [];
	for (const entry of readdirSync(source, { withFileTypes: true })) {
		const from = join(source, entry.name);
		const to = join(target, entry.name);
		const stat = lstatSync(from);
		if (stat.isDirectory() || stat.isSymbolicLink()) {
			symlinkSync(from, to, dirLinkType);
			entries.push({ path: to, kind: 'link' });
		} else if (stat.isFile()) {
			copyFileSync(from, to);
			entries.push({ path: to, kind: 'file' });
		}
	}
	return entries;
}

/** Removes the temporary `node_modules/` entries without traversing into linked targets. */
function unlinkNodeModules(candidate, entries) {
	for (const entry of entries) {
		if (existsSync(entry.path) || lstatSync(entry.path, { throwIfNoEntry: false })) {
			unlinkSync(entry.path);
		}
	}
	const target = join(candidate, 'node_modules');
	if (existsSync(target)) rmSync(target, { recursive: true, force: true });
}

function githubApi(baseUrl = process.env.GITHUB_API_URL || 'https://api.github.com') {
	async function request(method, path, token, body) {
		const response = await fetch(`${baseUrl}${path}`, {
			method,
			headers: {
				authorization: `Bearer ${token}`,
				accept: 'application/vnd.github+json',
				'x-github-api-version': '2022-11-28',
				...(body ? { 'content-type': 'application/json' } : {}),
			},
			...(body ? { body: JSON.stringify(body) } : {}),
		});
		if (!response.ok) {
			const detail = await response.text().catch(() => '');
			throw new Error(
				`${method} ${path}: ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}`
			);
		}
		return response.json();
	}
	return {
		get: (path, token) => request('GET', path, token),
		post: (path, token, body) => request('POST', path, token, body),
		patch: (path, token, body) => request('PATCH', path, token, body),
	};
}

export function buildPrBody({ route, distTag, selectedUnits, distributions, candidate }) {
	const lines = [
		`Automated npm version PR for the \`${route}\` route (dist-tag \`${distTag}\`).`,
		'',
		`**Selected units:** ${selectedUnits.map((unit) => `\`${unit}\``).join(', ')}`,
		'',
		'### Releases',
		'',
	];
	for (const distribution of distributions) {
		const manifest = JSON.parse(readFileSync(join(candidate, distribution.manifest), 'utf8'));
		lines.push(`- \`${manifest.name}@${manifest.version}\``);
	}
	lines.push(
		'',
		'Merging this pull request into `main` triggers `.github/workflows/release.yml` to verify and publish the reviewed `.release/npm-intent.json`.'
	);
	return `${lines.join('\n')}\n`;
}

/**
 * Versions pending changesets for `route` inside a disposable worktree off `HEAD`, commits as
 * the PR's author without mutating `root`'s git config, force-pushes `changeset-release/<route>`,
 * opens or updates the PR targeting `base`, and verifies the PR's commit authorship.
 */
export async function updateVersionPr({
	root,
	route,
	repository,
	base = 'main',
	readToken,
	pushToken = '',
	appSlug = '',
	registryEvidenceFile = '',
	versionCommand,
	api = githubApi(),
	log = console.log,
}) {
	const config = routeConfig(route);
	if (!repository || !readToken) {
		throw new Error('GH_TOKEN and GITHUB_REPOSITORY must be set');
	}

	const directory = mkdtempSync(join(tmpdir(), 'afd-version-pr-'));
	const candidate = join(directory, 'candidate');
	run('git', ['worktree', 'add', '--detach', candidate, 'HEAD'], root);
	let linkedEntries = [];
	try {
		linkedEntries = linkNodeModules(root, candidate);
		// `@changesets/changelog-github` reads `GITHUB_TOKEN`, while Actions steps pass `GH_TOKEN`.
		const versionEnv = {
			...process.env,
			LEFTHOOK: '0',
			GH_TOKEN: readToken,
			GITHUB_TOKEN: readToken,
		};
		if (versionCommand) {
			versionCommand(candidate, versionEnv);
		} else {
			const args = [join(candidate, 'scripts/release-control.mjs'), 'version', '--route', route];
			if (registryEvidenceFile) args.push('--registry-evidence', resolve(registryEvidenceFile));
			run(process.execPath, args, candidate, { env: versionEnv });
		}
		unlinkNodeModules(candidate, linkedEntries);
		linkedEntries = [];

		const status = run('git', ['status', '--porcelain'], candidate).trim();
		if (!status) {
			log(`release-version-pr: versioning ${route} produced no changes; skipping`);
			return { route, branch: config.branch, status: 'skipped' };
		}

		const chosen = await resolveAuthor(
			{ repository, base, branch: config.branch, token: readToken, appSlug },
			api.get
		);
		if (chosen.warning) log(`::warning::${chosen.warning}`);
		log(`release-version-pr (${route}): ${chosen.name} <${chosen.email}> (${chosen.reason})`);

		const gitEnv = { ...process.env, LEFTHOOK: '0' };
		run('git', ['add', '-A'], candidate, { env: gitEnv });
		run(
			'git',
			[
				'-c',
				`user.name=${chosen.name}`,
				'-c',
				`user.email=${chosen.email}`,
				'commit',
				'-m',
				config.commitMessage,
			],
			candidate,
			{ env: gitEnv }
		);

		const intent = readIntent(candidate);
		const inventory = loadInventory(candidate);
		const channel = releaseChannel(inventory, intent.selectedUnits);
		const body = buildPrBody({
			route,
			distTag: channel.distTag,
			selectedUnits: intent.selectedUnits,
			distributions: intent.distributions,
			candidate,
		});

		const effectiveToken = pushToken || readToken;
		const pushEnv = {
			...gitEnv,
			...pushCredentials(pushToken, { mask: Boolean(process.env.GITHUB_ACTIONS), log }),
		};
		run('git', ['push', '--force', 'origin', `HEAD:refs/heads/${config.branch}`], candidate, {
			env: pushEnv,
		});

		const openPr = await openVersionPr(
			{ repository, base, branch: config.branch, token: readToken },
			api.get
		);
		let prNumber;
		if (openPr) {
			const updated = await api.patch(
				`/repos/${repository}/pulls/${openPr.number}`,
				effectiveToken,
				{ title: config.title, body }
			);
			prNumber = updated.number ?? openPr.number;
			log(`release-version-pr (${route}): updated PR #${prNumber} on ${config.branch}`);
		} else {
			const created = await api.post(`/repos/${repository}/pulls`, effectiveToken, {
				title: config.title,
				head: config.branch,
				base,
				body,
			});
			prNumber = created.number;
			log(`release-version-pr (${route}): created PR #${prNumber} on ${config.branch}`);
		}

		const problems = await verifyAuthor(
			{
				GH_TOKEN: readToken,
				GITHUB_REPOSITORY: repository,
				GITHUB_REF_NAME: base,
				RELEASE_PR_BRANCH: config.branch,
			},
			{ get: api.get, log }
		);
		if (problems.length > 0) {
			for (const problem of problems) log(`::error::${problem}`);
			throw new Error(`release-version-pr (${route}) author check failed:\n${problems.join('\n')}`);
		}

		return {
			route,
			branch: config.branch,
			status: openPr ? 'updated' : 'created',
			prNumber,
		};
	} finally {
		if (linkedEntries.length) unlinkNodeModules(candidate, linkedEntries);
		run('git', ['worktree', 'remove', '--force', candidate], root);
		rmSync(directory, { recursive: true, force: true });
	}
}

function parseArgs(args) {
	const result = {};
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if ((arg === '--route' || arg === '--registry-evidence') && args[index + 1]) {
			result[arg.slice(2)] = args[++index];
		} else {
			throw new Error(`Unknown or incomplete argument: ${arg}`);
		}
	}
	if (!result.route) throw new Error('Expected --route <npm-main|npm-prerelease>');
	return result;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	try {
		const opts = parseArgs(process.argv.slice(2));
		const result = await updateVersionPr({
			root: resolve(process.cwd()),
			route: opts.route,
			repository: process.env.GITHUB_REPOSITORY,
			base: process.env.GITHUB_REF_NAME || 'main',
			readToken: process.env.GH_TOKEN,
			pushToken: process.env.PR_TOKEN || '',
			appSlug: process.env.APP_SLUG || '',
			registryEvidenceFile: opts['registry-evidence'] || '',
		});
		process.stdout.write(`${JSON.stringify(result, null, '\t')}\n`);
	} catch (error) {
		console.error(`release-version-pr: ${error.message}`);
		process.exitCode = 1;
	}
}
