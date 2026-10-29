import assert from 'node:assert/strict';
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
	restoreRecoveryArtifacts,
	validateOriginalAttempt,
	validateRecoveryApproval,
	validateRecoveryEvidence,
} from './release-operations/recovery-approval.mjs';
import { hash } from './release-operations/shared.mjs';

const approval = {
	schemaVersion: 1,
	runId: '123',
	attempt: '1',
	sourceRevision: 'a'.repeat(40),
	planBinding: 'b'.repeat(64),
	intentDigest: 'c'.repeat(64),
	failedStatusId: 12345,
};
const bytes = JSON.stringify(approval);
const environment = {
	GITHUB_EVENT_NAME: 'workflow_dispatch',
	GITHUB_REF: 'refs/heads/main',
	RECOVERY_APPROVAL: hash(bytes),
};
const original = {
	id: 123,
	head_sha: approval.sourceRevision,
	event: 'push',
	path: '.github/workflows/release.yml',
	conclusion: 'failure',
	status: 'completed',
	run_attempt: 1,
	repository: { full_name: 'lushly-dev/afd' },
};
const plan = {
	binding: approval.planBinding,
	sourceRevision: approval.sourceRevision,
	intentDigest: approval.intentDigest,
};
const failed = {
	statusId: approval.failedStatusId,
	state: 'failure',
	targetUrl: 'https://github.com/lushly-dev/afd/actions/runs/123/attempts/1',
};
test('only the exact main manual approval and failed original attempt authorize restoration', () => {
	validateRecoveryApproval(approval, bytes, environment, approval.intentDigest);
	validateOriginalAttempt(approval, original);
	validateRecoveryEvidence(approval, plan, failed);
	for (const delta of [
		{ GITHUB_EVENT_NAME: 'push' },
		{ GITHUB_REF: 'refs/heads/other' },
		{ RECOVERY_APPROVAL: 'wrong' },
	])
		assert.throws(
			() =>
				validateRecoveryApproval(
					approval,
					bytes,
					{ ...environment, ...delta },
					approval.intentDigest
				),
			/reviewed main/
		);
	assert.throws(
		() => validateRecoveryApproval(approval, bytes, environment, 'wrong'),
		/reviewed main/
	);
	for (const delta of [
		{ id: 124 },
		{ head_sha: 'wrong' },
		{ event: 'pull_request' },
		{ path: 'another.yml' },
		{ conclusion: 'success' },
		{ status: 'in_progress' },
		{ run_attempt: 2 },
		{ repository: { full_name: 'foreign/repo' } },
	])
		assert.throws(
			() => validateOriginalAttempt(approval, { ...original, ...delta }),
			/Original workflow/
		);
	for (const delta of [
		{ binding: 'wrong' },
		{ sourceRevision: 'wrong' },
		{ intentDigest: 'wrong' },
	])
		assert.throws(
			() => validateRecoveryEvidence(approval, { ...plan, ...delta }, failed),
			/Retained release/
		);
	for (const delta of [{ statusId: 12346 }, { state: 'pending' }, { targetUrl: 'foreign' }])
		assert.throws(
			() => validateRecoveryEvidence(approval, plan, { ...failed, ...delta }),
			/Retained release/
		);
});
function fixture(t) {
	const base = realpathSync(mkdtempSync(join(tmpdir(), 'afd-recovery-restore-')));
	t.after(() => rmSync(base, { recursive: true, force: true }));
	const retained = join(base, 'retained'),
		temporary = join(base, 'runner');
	mkdirSync(retained);
	mkdirSync(temporary);
	const relative = 'npm-plan.json.artifacts/0/package-1.0.0.tgz';
	const source = join(retained, relative);
	mkdirSync(join(retained, 'npm-plan.json.artifacts', '0'), { recursive: true });
	writeFileSync(source, 'exact original artifact');
	const artifact = {
		name: '@fixture/package',
		filename: 'package-1.0.0.tgz',
		file: join(temporary, relative),
		artifactHash: hash(readFileSync(source)),
	};
	return { retained, temporary, artifact, source };
}
test('restoration preserves sealed paths and bytes without modifying the plan', (t) => {
	const f = fixture(t);
	const plan = { artifacts: [f.artifact] },
		before = JSON.stringify(plan);
	restoreRecoveryArtifacts(plan, f.retained, f.temporary);
	assert.equal(readFileSync(f.artifact.file, 'utf8'), 'exact original artifact');
	assert.equal(JSON.stringify(plan), before);
	assert.throws(
		() => restoreRecoveryArtifacts(plan, f.retained, f.temporary),
		/destination already exists/
	);
});
test('escaping paths, mismatched bytes, source symlinks and destination symlinks reject before copies', (t) => {
	const f = fixture(t);
	const run = (artifact) =>
		restoreRecoveryArtifacts({ artifacts: [artifact] }, f.retained, f.temporary);
	assert.throws(() => run({ ...f.artifact, file: join(f.temporary, 'escape.tgz') }), /outside/);
	assert.throws(() => run({ ...f.artifact, filename: '../escape.tgz' }), /outside/);
	assert.throws(() => run({ ...f.artifact, artifactHash: 'wrong' }), /differs/);
	const bytes = readFileSync(f.source);
	rmSync(f.source);
	symlinkSync(join(f.temporary, 'target'), f.source);
	assert.throws(() => run(f.artifact), /Symlink/);
	rmSync(f.source);
	writeFileSync(f.source, bytes);
	const other = join(f.temporary, 'other');
	mkdirSync(other);
	symlinkSync(other, join(f.temporary, 'npm-plan.json.artifacts'));
	assert.throws(() => run(f.artifact), /Symlink/);
});

test('a failed recovery is pinned separately from original artifact authority', async () => {
	const { validateFailureAttempt } = await import('./release-operations/recovery-approval.mjs');
	const next = {
		...approval,
		failedStatusId: 98765,
		failure: { runId: '456', attempt: '2', sourceRevision: 'd'.repeat(40) },
	};
	const nextBytes = JSON.stringify(next);
	validateRecoveryApproval(
		next,
		nextBytes,
		{ ...environment, RECOVERY_APPROVAL: hash(nextBytes) },
		next.intentDigest
	);
	const run = {
		...original,
		id: 456,
		run_attempt: 2,
		head_sha: next.failure.sourceRevision,
		event: 'workflow_dispatch',
	};
	validateFailureAttempt(next, run);
	const claim = {
		...failed,
		statusId: 98765,
		targetUrl: 'https://github.com/lushly-dev/afd/actions/runs/456/attempts/2',
	};
	validateRecoveryEvidence(next, plan, claim);
	for (const delta of [
		{ head_sha: approval.sourceRevision },
		{ event: 'push' },
		{ id: 123 },
		{ run_attempt: 1 },
		{ conclusion: 'success' },
	])
		assert.throws(() => validateFailureAttempt(next, { ...run, ...delta }), /Failed recovery/);
	assert.throws(() => validateRecoveryEvidence(next, plan, failed), /Retained release/);
	assert.equal(next.sourceRevision, approval.sourceRevision);
	assert.equal(next.planBinding, approval.planBinding);
});
