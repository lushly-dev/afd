/** Admission checks shared by the manual recovery entry point and negative fixtures. */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { hash, repositoryEntry } from './shared.mjs';

const repository = 'lushly-dev/afd';
export function validateRecoveryApproval(approval, bytes, environment, intentDigest) {
	if (
		environment.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
		environment.GITHUB_REF !== 'refs/heads/main' ||
		environment.RECOVERY_APPROVAL !== hash(bytes) ||
		approval.schemaVersion !== 1 ||
		!/^\d+$/.test(approval.runId) ||
		!/^\d+$/.test(approval.attempt) ||
		!/^[a-f0-9]{40}$/.test(approval.sourceRevision) ||
		![approval.planBinding, approval.intentDigest].every((value) => /^[a-f0-9]{64}$/.test(value)) ||
		!Number.isSafeInteger(approval.failedStatusId) ||
		approval.failedStatusId < 1 ||
		intentDigest !== approval.intentDigest
	)
		throw new Error('Recovery requires the exact reviewed main-branch approval and intent');
}
export function validateOriginalAttempt(approval, original) {
	if (
		original.head_sha !== approval.sourceRevision ||
		original.event !== 'push' ||
		original.path !== '.github/workflows/release.yml' ||
		original.conclusion !== 'failure' ||
		original.status !== 'completed' ||
		String(original.run_attempt) !== approval.attempt ||
		String(original.id) !== approval.runId ||
		original.repository?.full_name !== repository
	)
		throw new Error('Original workflow attempt does not match recovery approval');
}
export function validateRecoveryEvidence(approval, plan, failed) {
	if (
		plan.binding !== approval.planBinding ||
		plan.sourceRevision !== approval.sourceRevision ||
		plan.intentDigest !== approval.intentDigest ||
		failed.statusId !== approval.failedStatusId ||
		failed.state !== 'failure' ||
		failed.targetUrl !==
			`https://github.com/${repository}/actions/runs/${approval.runId}/attempts/${approval.attempt}`
	)
		throw new Error('Retained release evidence differs from recovery approval');
}
export function restoreRecoveryArtifacts(plan, retained, temporary) {
	const copies = plan.artifacts.map((artifact, index) => {
		const relative = `npm-plan.json.artifacts/${index}/${artifact.filename}`;
		if (
			!/^[a-z0-9.-]+\.tgz$/.test(artifact.filename) ||
			artifact.file !== join(temporary, relative)
		)
			throw new Error('Sealed artifact path is outside the expected runner layout');
		const source = repositoryEntry(retained, relative, { allowRepositoryMirror: false });
		if (source.kind !== 'file' || hash(readFileSync(source.absolute)) !== artifact.artifactHash)
			throw new Error(`Retained artifact differs: ${artifact.name}`);
		repositoryEntry(temporary, relative, { allowRepositoryMirror: false });
		if (existsSync(artifact.file)) throw new Error('Sealed artifact destination already exists');
		return { source: source.absolute, destination: artifact.file };
	});
	for (const { source, destination } of copies) {
		mkdirSync(dirname(destination), { recursive: true });
		copyFileSync(source, destination);
	}
}
