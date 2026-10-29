#!/usr/bin/env node
/** Explicit operator recovery of a reviewed, artifact-bound npm publication. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { releaseClaim } from './release-claim.mjs';
import { finalizeRelease } from './release-finalize.mjs';
import { readIntent } from './release-operations/intent.mjs';
import { publishPlan, validatePlan } from './release-operations/publish.mjs';
import {
	restoreRecoveryArtifacts,
	validateFailureAttempt,
	validateOriginalAttempt,
	validateRecoveryApproval,
	validateRecoveryEvidence,
} from './release-operations/recovery-approval.mjs';
import { hash, json, run } from './release-operations/shared.mjs';

const repository = 'lushly-dev/afd';
const root = process.cwd();
const approvalPath = '.release/npm-recovery.json';
const approvalBytes = readFileSync(resolve(root, approvalPath), 'utf8');
if (run('git', ['show', `HEAD:${approvalPath}`], root) !== approvalBytes)
	throw new Error('Recovery approval must be committed');
const approval = JSON.parse(approvalBytes);
validateRecoveryApproval(approval, approvalBytes, process.env, readIntent(root).intentDigest);
const api = (endpoint) => JSON.parse(run('gh', ['api', `repos/${repository}/${endpoint}`], root));
const original = api(`actions/runs/${approval.runId}/attempts/${approval.attempt}`);
validateOriginalAttempt(approval, original);
const temporary = process.env.RUNNER_TEMP;
if (
	!temporary ||
	!isAbsolute(temporary) ||
	process.env.RUNNER_ENVIRONMENT !== 'github-hosted' ||
	process.env.RUNNER_OS !== 'Linux'
)
	throw new Error('Recovery requires a GitHub hosted runner temporary directory');
const retained = join(temporary, 'npm-recovery-original');
const output = join(temporary, 'npm-recovery');
if (existsSync(retained) || existsSync(output)) throw new Error('Recovery output already exists');
mkdirSync(retained);
mkdirSync(output);
run(
	'gh',
	[
		'run',
		'download',
		approval.runId,
		'--repo',
		repository,
		'--name',
		`npm-publication-${approval.runId}-${approval.attempt}`,
		'--dir',
		retained,
	],
	root
);
const plan = json(join(retained, 'npm-plan.json'));
let priorRoot = retained;
if (approval.failure) {
	const failure = approval.failure;
	validateFailureAttempt(
		approval,
		api(`actions/runs/${failure.runId}/attempts/${failure.attempt}`)
	);
	const failedBundle = join(temporary, 'npm-recovery-failed');
	if (existsSync(failedBundle))
		throw new Error('Failed recovery evidence directory already exists');
	mkdirSync(failedBundle);
	run(
		'gh',
		[
			'run',
			'download',
			failure.runId,
			'--repo',
			repository,
			'--name',
			`npm-recovery-${failure.runId}-${failure.attempt}`,
			'--dir',
			failedBundle,
		],
		root
	);
	priorRoot = join(failedBundle, 'npm-recovery');
	if (json(join(priorRoot, 'npm-plan.json')).binding !== plan.binding)
		throw new Error('Failed recovery used a different artifact plan');
}
const prior = json(join(priorRoot, 'npm-publication.json'));
const failed = json(join(priorRoot, 'npm-claim-result.json'));
validateRecoveryEvidence(approval, plan, failed);
restoreRecoveryArtifacts(plan, retained, temporary);
const frozen = join(temporary, 'npm-recovery-source');
run('git', ['worktree', 'add', '--detach', frozen, approval.sourceRevision], root);
validatePlan(frozen, plan, plan.core.registryEvidence);
const save = (name, value) =>
	writeFileSync(join(output, name), `${JSON.stringify(value, null, '\t')}\n`);
save('npm-plan.json', plan);
save('recovery-approval.json', approval);
save('original-failure.json', json(join(retained, 'npm-claim-result.json')));
save('prior-failure.json', failed);
const claim = releaseClaim({
	action: 'reconcile',
	root: frozen,
	claim: failed,
	plan,
	receipt: prior,
});
save('npm-claim.json', claim);
const receiptFile = join(output, 'npm-publication.json');
try {
	const receipt = publishPlan({
		root: frozen,
		plan,
		receiptFile,
		previouslyPublished: claim.reconciliation.verified,
	});
	receipt.recovery = {
		originalRunId: approval.runId,
		originalAttempt: approval.attempt,
		failedStatusId: approval.failedStatusId,
		originalReceiptHash: hash(readFileSync(join(retained, 'npm-publication.json'))),
		priorReceiptHash: hash(readFileSync(join(priorRoot, 'npm-publication.json'))),
		priorFailure: approval.failure ?? { runId: approval.runId, attempt: approval.attempt },
	};
	save('npm-publication.json', receipt);
	finalizeRelease({ root: frozen, plan, receipt, receiptFile });
	const result = releaseClaim({ action: 'complete', root: frozen, claim, plan, receipt });
	save('npm-claim-result.json', result);
	console.log(
		`Recovered ${plan.artifacts.length} verified packages from ${approval.sourceRevision}`
	);
} catch (error) {
	save('npm-claim-result.json', releaseClaim({ action: 'fail', root: frozen, claim }));
	throw error;
}
