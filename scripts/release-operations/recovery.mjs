/** Reconcile a known accepted upload before an explicit held-claim transition. */
import semver from 'semver';
import { readPublished, registryNames, verifyPublished } from './prerequisites.mjs';
import { validatePlan } from './publish.mjs';
import { readRegistry } from './shared.mjs';

export function reconcilePublication({
	root,
	plan,
	receipt,
	registry = readRegistry,
	readback = readPublished,
}) {
	if (
		receipt?.state !== 'held' ||
		receipt.binding !== plan?.binding ||
		receipt.intentDigest !== plan.intentDigest ||
		receipt.sourceRevision !== plan.sourceRevision ||
		!plan.artifacts.some((a) => a.name === receipt.current)
	)
		throw new Error('Recovery requires the exact held publication receipt');
	validatePlan(root, plan, plan.core.registryEvidence);
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
	if (!verified.some((a) => a.name === receipt.current))
		throw new Error(
			'Uncertain upload is absent; recovery requires further operator reconciliation'
		);
	return {
		verified,
		missing: plan.artifacts
			.filter((a) => !verified.some((v) => v.name === a.name))
			.map((a) => a.name),
	};
}
