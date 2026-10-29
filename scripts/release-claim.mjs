#!/usr/bin/env node
/** Durable fail-closed npm claims on the earliest occurrence of the exact intent bytes. */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadInventory } from './release/control.mjs';
import { validatePlan } from './release-operations/publish.mjs';
import { reconcilePublication } from './release-operations/recovery.mjs';
import { hash, json, run } from './release-operations/shared.mjs';

const intentPath = '.release/npm-intent.json';
const repository = 'lushly-dev/afd';
const held = (message) =>
	new Error(`Publication held: ${message}; explicit operator reconciliation required`);
export function githubApi({ root, endpoint, body }) {
	return JSON.parse(
		execFileSync(
			'gh',
			[
				'api',
				'--hostname',
				'github.com',
				'--method',
				body ? 'POST' : 'GET',
				endpoint,
				...(body ? ['--input', '-'] : []),
			],
			{
				cwd: root,
				encoding: 'utf8',
				input: body ? JSON.stringify(body) : undefined,
				stdio: ['pipe', 'pipe', 'pipe'],
			}
		)
	);
}
function identity({ root, environment, command }) {
	if (!existsSync(resolve(root, intentPath))) return null;
	const bytes = readFileSync(resolve(root, intentPath));
	const record = JSON.parse(bytes.toString('utf8'));
	const inventory = loadInventory(root);
	if (
		record.schemaVersion !== 1 ||
		!Array.isArray(record.selectedUnits) ||
		!record.selectedUnits.length ||
		new Set(record.selectedUnits).size !== record.selectedUnits.length ||
		record.selectedUnits.some((id) => {
			const unit = inventory.units.find((entry) => entry.id === id);
			return unit?.protocol !== 'npm-changesets' || unit.authority !== `github: ${repository}`;
		})
	)
		throw held('intent publisher authority is unknown');
	if (environment.GH_REPO && environment.GH_REPO !== repository)
		throw held('GH_REPO differs from approved repository');
	for (const args of [
		['remote', 'get-url', 'origin'],
		['remote', 'get-url', '--push', 'origin'],
	]) {
		const origin = command('git', args, root).trim();
		if (
			![
				`https://github.com/${repository}`,
				`https://github.com/${repository}.git`,
				`git@github.com:${repository}`,
				`git@github.com:${repository}.git`,
			].includes(origin)
		)
			throw held('origin differs from approved repository');
	}
	if (command('git', ['rev-parse', '--is-shallow-repository'], root).trim() !== 'false')
		throw held('full git history is required');
	const intentDigest = hash(bytes);
	if (hash(command('git', ['show', `HEAD:${intentPath}`], root)) !== intentDigest)
		throw held('current intent is not committed');
	const history = command(
		'git',
		['log', '--reverse', '--full-history', '--format=%H', '--', intentPath],
		root
	)
		.trim()
		.split('\n');
	let commit;
	for (const candidate of history) {
		if (!/^[a-f0-9]{40}$/.test(candidate)) throw held('intent history is unknown');
		let content;
		try {
			content = command('git', ['show', `${candidate}:${intentPath}`], root);
		} catch (error) {
			if (
				/fatal: path '\.release\/npm-intent\.json' (?:does not exist in|exists on disk, but not in)/.test(
					error.stderr?.toString() ?? ''
				)
			)
				continue;
			throw error;
		}
		if (hash(content) === intentDigest) {
			commit = candidate;
			break;
		}
	}
	if (!commit) throw held('current intent has no committed origin');
	return { repository, commit, context: `release/npm/${intentDigest}`, intentDigest };
}
function statuses(options, key) {
	const matching = [];
	const seen = new Set();
	for (let page = 1; page <= 100; page++) {
		const result = options.api({
			root: options.root,
			endpoint: `repos/${repository}/commits/${key.commit}/statuses?per_page=100&page=${page}`,
		});
		if (!Array.isArray(result) || result.length > 100) throw held('unknown GitHub status response');
		for (const entry of result) {
			if (
				!entry ||
				!Number.isSafeInteger(entry.id) ||
				entry.id <= 0 ||
				typeof entry.context !== 'string' ||
				seen.has(entry.id)
			)
				throw held('malformed or repeated GitHub status');
			seen.add(entry.id);
			if (entry.context === key.context) {
				if (
					!['pending', 'success', 'failure', 'error'].includes(entry.state) ||
					typeof entry.target_url !== 'string'
				)
					throw held('unknown release claim outcome');
				matching.push(entry);
			}
		}
		if (result.length < 100) return matching.sort((a, b) => b.id - a.id);
	}
	throw held('GitHub status pagination exceeded safety bound');
}
function owner(environment) {
	if (
		environment.GITHUB_SERVER_URL !== 'https://github.com' ||
		environment.GITHUB_REPOSITORY !== repository ||
		!/^\d+$/.test(environment.GITHUB_RUN_ID ?? '') ||
		!/^\d+$/.test(environment.GITHUB_RUN_ATTEMPT ?? '')
	)
		throw held('claim writes require a known GitHub Actions run and attempt');
	return `https://github.com/${repository}/actions/runs/${environment.GITHUB_RUN_ID}/attempts/${environment.GITHUB_RUN_ATTEMPT}`;
}
function verifyOwn(key, current, claim, targetUrl) {
	if (
		claim?.state !== 'pending' ||
		!current ||
		current.state !== 'pending' ||
		claim.statusId !== current.id ||
		claim.targetUrl !== targetUrl ||
		current.target_url !== targetUrl ||
		Object.entries(key).some(([name, value]) => claim[name] !== value)
	)
		throw held('pending claim is not owned by this run attempt');
}
function post(options, key, state, targetUrl, recoveryStatusId) {
	const result = options.api({
		root: options.root,
		endpoint: `repos/${repository}/statuses/${key.commit}`,
		body: {
			state,
			context: key.context,
			target_url: targetUrl,
			description: recoveryStatusId
				? `Explicit recovery of held status ${recoveryStatusId}; verification pending`
				: state === 'success'
					? 'npm upload and finalization verified'
					: 'npm publication requires reconciliation until complete',
		},
	});
	if (
		!result ||
		!Number.isSafeInteger(result.id) ||
		result.id <= 0 ||
		result.state !== state ||
		result.context !== key.context ||
		result.target_url !== targetUrl
	)
		throw held('GitHub did not confirm durable claim write');
	const current = statuses(options, key)[0];
	if (current?.id !== result.id || current.state !== state || current.target_url !== targetUrl)
		throw held('durable claim readback differs');
	return {
		...key,
		state: state === 'success' ? 'succeeded' : state,
		statusId: result.id,
		targetUrl,
	};
}
/** Injected transports are used by tests; the CLI always uses GitHub's authenticated API. */
export function releaseClaim({
	action,
	root,
	claim,
	plan,
	receipt,
	environment = process.env,
	command = run,
	api = githubApi,
	validate = validatePlan,
	reconcile = reconcilePublication,
}) {
	if (!['inspect', 'acquire', 'complete', 'fail', 'reconcile'].includes(action))
		throw new Error('Unknown claim action');
	const options = { root, environment, command, api };
	const key = identity(options);
	if (!key) {
		if (action !== 'inspect') throw held('release intent is missing');
		return { state: 'missing' };
	}
	const current = statuses(options, key)[0];
	if (action === 'inspect') {
		if (current && current.state !== 'success')
			throw held(`durable release claim is ${current.state}`);
		return {
			...key,
			state: current ? 'succeeded' : 'unclaimed',
			...(current ? { statusId: current.id } : {}),
		};
	}
	const targetUrl = owner(environment);
	if (action === 'reconcile') {
		if (
			current?.state !== 'failure' ||
			claim?.state !== 'failure' ||
			claim.statusId !== current.id ||
			claim.targetUrl !== current.target_url ||
			claim.targetUrl === targetUrl ||
			Object.entries(key).some(([name, value]) => claim[name] !== value) ||
			plan?.sourceRevision !== key.commit ||
			plan.intentDigest !== key.intentDigest
		)
			throw held('recovery does not match the exact failed claim');
		const reconciliation = reconcile({ root, plan, receipt });
		if (statuses(options, key)[0]?.id !== current.id)
			throw held('failed claim changed during reconciliation');
		return {
			...post(options, key, 'pending', targetUrl, current.id),
			recoveredFrom: { statusId: current.id, targetUrl: current.target_url },
			reconciliation,
		};
	}
	if (action === 'acquire') {
		if (current) throw held(`existing release claim is ${current.state}`);
		return post(options, key, 'pending', targetUrl);
	}
	verifyOwn(key, current, claim, targetUrl);
	if (action === 'complete') {
		if (
			!plan ||
			plan.intentDigest !== key.intentDigest ||
			!receipt ||
			receipt.binding !== plan.binding ||
			receipt.state !== 'complete' ||
			receipt.finalization?.state !== 'complete' ||
			!Array.isArray(plan.artifacts) ||
			!plan.artifacts.length ||
			!Array.isArray(receipt.publishedPackages) ||
			receipt.publishedPackages.length !== plan.artifacts.length ||
			new Set(receipt.publishedPackages.map((entry) => entry.name)).size !==
				plan.artifacts.length ||
			!Array.isArray(receipt.finalization.tags) ||
			receipt.finalization.tags.length !== plan.artifacts.length ||
			plan.artifacts.some(
				(artifact) =>
					!receipt.publishedPackages.some(
						(entry) =>
							entry.name === artifact.name &&
							entry.version === artifact.version &&
							entry.tag === `${artifact.name}@${artifact.version}`
					) || !receipt.finalization.tags.includes(`${artifact.name}@${artifact.version}`)
			) ||
			receipt.finalization.head !== command('git', ['rev-parse', 'HEAD'], root).trim()
		)
			throw held('publication, finalization, or current intent binding is incomplete');
		validate(root, plan, plan.core.registryEvidence);
	}
	return post(options, key, action === 'complete' ? 'success' : 'failure', targetUrl);
}
export function main(args = process.argv.slice(2)) {
	const action = args.shift();
	const options = {};
	while (args.length) {
		const option = args.shift();
		if (
			!['--output', '--claim', '--plan', '--receipt'].includes(option) ||
			!args[0] ||
			options[option]
		)
			throw new Error(
				'Usage: release-claim.mjs inspect|acquire|complete|fail|reconcile --output <json> [--claim <json> --plan <json> --receipt <json>]'
			);
		options[option] = args.shift();
	}
	if (!options['--output']) throw new Error('Claim output path is required');
	const result = releaseClaim({
		action,
		root: process.cwd(),
		claim: options['--claim'] ? json(resolve(options['--claim'])) : undefined,
		plan: options['--plan'] ? json(resolve(options['--plan'])) : undefined,
		receipt: options['--receipt'] ? json(resolve(options['--receipt'])) : undefined,
	});
	writeFileSync(resolve(options['--output']), `${JSON.stringify(result, null, '\t')}\n`);
	process.stdout.write(`${JSON.stringify(result)}\n`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		main();
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
