/** Reconcile a known accepted upload before an explicit held-claim transition. */
import semver from 'semver';
import { readPublished, registryNames, verifyPublished } from './prerequisites.mjs';
import { notes, validatePlan } from './publish.mjs';
import { readRegistry } from './shared.mjs';

export function reconcilePublication({
	root,
	plan,
	receipt,
	registry = readRegistry,
	readback = readPublished,
}) {
	const finalizationOnly = receipt?.state === 'complete' && receipt.finalization?.state === 'held';
	if (
		(!finalizationOnly && receipt?.state !== 'held') ||
		receipt.binding !== plan?.binding ||
		receipt.intentDigest !== plan.intentDigest ||
		receipt.sourceRevision !== plan.sourceRevision ||
		(!finalizationOnly && !plan.artifacts.some((a) => a.name === receipt.current))
	)
		throw new Error('Recovery requires the exact held publication receipt');
	validatePlan(root, plan, plan.core.registryEvidence);
	if (
		finalizationOnly &&
		(receipt.finalization.head !== plan.sourceRevision ||
			!Array.isArray(receipt.publishedPackages) ||
			receipt.publishedPackages.length !== plan.artifacts.length ||
			new Set(receipt.publishedPackages.map((entry) => entry.name)).size !==
				plan.artifacts.length ||
			plan.artifacts.some(
				(artifact) =>
					!receipt.publishedPackages.some(
						(entry) =>
							entry.name === artifact.name &&
							entry.version === artifact.version &&
							entry.tag === `${artifact.name}@${artifact.version}` &&
							entry.notes === notes(root, artifact)
					)
			))
	)
		throw new Error('Finalization recovery requires the complete original package and tag set');

	const evidence = registryNames(root, plan.core.selectedUnits).map((name) => {
		const result = registry(name);
		if (
			result?.registry !== 'npm' ||
			result.name !== name ||
			!Array.isArray(result.versions) ||
			result.versions.some((version) => !semver.valid(version))
		)
			throw new Error(`Unknown recovery registry outcome: ${name}`);
		return result;
	});
	validatePlan(root, plan, evidence);
	const known = new Set([receipt.current]);
	for (const entry of [
		...(receipt.verifiedArtifacts ?? []),
		...(receipt.publishedPackages ?? []),
	]) {
		if (!plan.artifacts.some((a) => a.name === entry.name && a.version === entry.version))
			throw new Error('Held receipt contains a foreign artifact');
		known.add(entry.name);
	}
	const verified = [];
	for (const artifact of plan.artifacts) {
		if (
			known.has(artifact.name) ||
			evidence.find((e) => e.name === artifact.name)?.versions.includes(artifact.version)
		) {
			verified.push(verifyPublished(artifact, readback));
		}
	}
	if (!finalizationOnly && !verified.some((a) => a.name === receipt.current))
		throw new Error(
			'Uncertain upload is absent; recovery requires further operator reconciliation'
		);
	if (
		finalizationOnly &&
		(verified.length !== plan.artifacts.length ||
			verified.some((entry) => entry.method !== 'registry-tarball'))
	)
		throw new Error('Finalization recovery requires every artifact proof');
	return {
		...(finalizationOnly ? { finalizationOnly: true } : {}),
		verified,
		missing: plan.artifacts
			.filter((a) => !verified.some((v) => v.name === a.name))
			.map((a) => a.name),
	};
}
