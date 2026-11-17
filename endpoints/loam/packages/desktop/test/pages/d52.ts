/**
 * D52's measurement (phase 6 specification, 10.5), run in the desktop's webview on the A4 reference workspace:
 * 2,000 documents and 20,000 links in IndexedDB, then S1, listing every document record of one project, 200
 * times, and S2, 1,000 sequential record writes.
 */
import { createReferenceWorkspace, LINK_TABLE } from '@lushly-dev/loam-kernel/testing';
import { IndexedDbAdapter } from '@lushly-dev/local-db/indexeddb';

const percentile = (values: number[], p: number) => {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
};

async function measure() {
	const workspace = createReferenceWorkspace({
		seed: 'phase-2',
		size: 1,
		documents: 2_000,
		documentType: { type: 'notes', instance: 'notes' },
		links: 20_000,
	});
	const store = new IndexedDbAdapter({ name: `loam-d52-${Date.now()}` });
	await store.batch([
		...workspace.documents.map((record) => ({
			method: 'PUT' as const,
			path: `/document/${record.id}`,
			body: record,
		})),
		...workspace.links.map((link) => ({
			method: 'PUT' as const,
			path: `/${LINK_TABLE}/${link.id}`,
			body: link,
		})),
	]);
	const project = workspace.documents.find(
		(record) => record.scope.project !== undefined
	)?.scopeKey;
	if (!project) throw new Error('The reference workspace has no project');
	const expected = workspace.documents.filter((record) => record.scopeKey === project).length;

	const s1: number[] = [];
	let listed = 0;
	for (let run = 0; run < 200; run++) {
		const began = performance.now();
		const { data } = await store.list('document', { scopeKey: project, limit: 10_000 });
		s1.push(performance.now() - began);
		listed = data.length;
	}

	const template = workspace.documents[0] as unknown as Record<string, unknown>;
	const began = performance.now();
	for (let write = 0; write < 1_000; write++) {
		await store.create('document', { ...template, id: `doc_d52${write}`, title: `D52 ${write}` });
	}
	const s2Ms = performance.now() - began;

	return {
		documents: workspace.documents.length,
		links: workspace.links.length,
		s1: { runs: s1.length, listed, expected, p95Ms: percentile(s1, 95) },
		s2: { writes: 1_000, totalMs: s2Ms },
		userAgent: navigator.userAgent,
	};
}

(window as unknown as { loamD52: typeof measure }).loamD52 = measure;
