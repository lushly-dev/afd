/** Non-publishing handoff rehearsal. This module never changes actual authority. */
const reject = (message) => {
	throw new Error(message);
};
export function simulateHandoff(record, event) {
	const next = structuredClone(record);
	if (
		!record.unit ||
		!record.registryIdentity ||
		!record.oldAuthority ||
		!record.newAuthority ||
		!record.oldRoute ||
		!record.newRoute ||
		!record.frozenRevision ||
		!record.artifactHashes?.length ||
		!record.restorationSteps?.length ||
		!record.verificationEvidence?.length
	)
		reject('Incomplete handoff contract');
	if (record.oldEnabled && record.newEnabled) reject('Dual publisher authority is forbidden');
	if (
		!Array.isArray(record.queued) ||
		!Array.isArray(record.inFlight) ||
		!['none', 'published', 'unknown'].includes(record.registryOutcome)
	)
		reject('Release outcomes and work queues must be explicit');
	if (event === 'freeze') next.frozen = true;
	else if (event === 'disable-old') {
		if (
			!record.frozen ||
			record.queued.length ||
			record.inFlight.length ||
			record.registryOutcome === 'unknown'
		)
			reject('Freeze, drain and reconcile before disabling authority');
		next.oldEnabled = false;
	} else if (event === 'enable-new') {
		if (
			!record.frozen ||
			record.oldEnabled ||
			record.queued.length ||
			record.inFlight.length ||
			record.registryOutcome !== 'none' ||
			!record.approved
		)
			reject('New authority requires sole route and approved reconciled release');
		next.newEnabled = true;
		next.authority = record.newAuthority;
		next.state = 'admitted';
	} else if (event === 'failure') {
		next.state = 'held';
		next.frozen = true;
		next.newEnabled = false;
	} else if (event === 'restore-old') {
		if (
			record.state !== 'held' ||
			!record.frozen ||
			record.newEnabled ||
			record.queued.length ||
			record.inFlight.length ||
			record.registryOutcome !== 'none' ||
			!record.oldContractVerified
		)
			reject('Unsafe restoration: candidate work or published outcome is not reconciled');
		next.oldEnabled = true;
		next.authority = record.oldAuthority;
		next.state = 'quarantined';
	} else reject(`Unknown handoff event: ${event}`);
	return next;
}
