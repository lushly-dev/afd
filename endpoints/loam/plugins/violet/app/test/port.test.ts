/**
 * @fileoverview Port, handler, undo, cache-isolation, grant, and suggestion unit tests (spec §9.1).
 */
import { fileURLToPath } from 'node:url';
import { appCheck, readAppManifest } from '@lushly-dev/loam-cli';
import { type AppCallContextV1, documentContentKey } from '@lushly-dev/loam-sdk';
import { createAppTestKernel } from '@lushly-dev/loam-testing';
import { registry as violetRegistry } from '@lushly-dev/violet-afd/worker';
import { describe, expect, it } from 'vitest';
import { fetchChecksView, fetchNodeCompare } from '../src/elements/editor-loaders.js';
import {
	clearSelectionBus,
	getSelection,
	publishSelection,
	subscribeSelection,
} from '../src/elements/selection-bus.js';
import { createHandlers } from '../src/handlers.js';
import { parseStoredContent } from '../src/port/content.js';
import { createVioletPort, defaultPort } from '../src/port/engine.js';
import { rewriteVioletError } from '../src/port/suggestions.js';
import { PINNED_INTERFACE } from './helpers.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

async function bootKernel(options?: {
	grants?: readonly string[];
	config?: Record<string, unknown>;
}) {
	const manifest = await readAppManifest(ROOT);
	return createAppTestKernel({
		manifest,
		definition: () => import('../src/native.js'),
		...(options?.grants ? { grants: options.grants } : {}),
		...(options?.config ? { config: options.config } : {}),
	});
}

async function createDoc(
	kernel: Awaited<ReturnType<typeof bootKernel>>['kernel'],
	template: 'blank' | 'example' | 'afd-default' = 'example',
	title = 'Test tree'
): Promise<string> {
	const created = await kernel.call<{ id: string }>('document-create', {
		type: 'violet-tree',
		template,
		title,
	});
	expect(created.success, JSON.stringify(created.error)).toBe(true);
	return created.data?.id as string;
}

describe('manifest and appCheck', () => {
	it('passes loam app check with manifest v2 and all 22 commands', async () => {
		const manifest = await readAppManifest(ROOT);
		expect(manifest.manifest_version).toBe(2);
		expect(manifest.commands).toHaveLength(22);
		const report = await appCheck({ dir: ROOT });
		expect(report.refusals).toEqual([]);
		expect(report.trust?.code).toBe('TRUSTED_NOT_SANDBOXED');
	});
});

describe('port persistence, seeds, atomic import, and replacing-import guard (spec §9.1)', () => {
	it('round-trips stored records and produces deterministic seed exports', async () => {
		const k1 = await bootKernel();
		const k2 = await bootKernel();
		try {
			const d1 = await createDoc(k1.kernel, 'example', 'First');
			const d2 = await createDoc(k2.kernel, 'example', 'Second');

			const exp1 = await k1.kernel.call<{ content: { files: unknown[] } }>('violet-tree-export', {
				document: d1,
			});
			const exp2 = await k2.kernel.call<{ content: { files: unknown[] } }>('violet-tree-export', {
				document: d2,
			});
			expect(exp1.data?.content.files).toEqual(exp2.data?.content.files);

			// Mutate, clear cache, reload from store records, verify export matches.
			const edit = await k1.kernel.call('violet-token-override', {
				document: d1,
				node: 'example/dark',
				token: 'color.text.primary',
				value: '#f5f5fa',
			});
			expect(edit.success).toBe(true);
			const beforeReload = await k1.kernel.call<{ content: { files: unknown[] } }>(
				'violet-tree-export',
				{ document: d1 }
			);
			defaultPort.clearCache();
			const afterReload = await k1.kernel.call<{ content: { files: unknown[] } }>(
				'violet-tree-export',
				{ document: d1 }
			);
			expect(afterReload.data?.content.files).toEqual(beforeReload.data?.content.files);
		} finally {
			await k1.kernel.dispose();
			await k2.kernel.dispose();
		}
	});

	it('keeps query and mutation seed builds identical in node and token ids', async () => {
		const kQueryFirst = await bootKernel();
		const kMutateFirst = await bootKernel();
		try {
			const d1 = await createDoc(kQueryFirst.kernel, 'example');
			const d2 = await createDoc(kMutateFirst.kernel, 'example');

			const qList = await kQueryFirst.kernel.call('violet-node-list', { document: d1 });
			expect(qList.success).toBe(true);
			await kQueryFirst.kernel.call('violet-token-override', {
				document: d1,
				node: 'example/dark',
				token: 'color.text.primary',
				value: '#f0f0f5',
			});

			await kMutateFirst.kernel.call('violet-token-override', {
				document: d2,
				node: 'example/dark',
				token: 'color.text.primary',
				value: '#f0f0f5',
			});

			const e1 = await kQueryFirst.kernel.call<{ content: { files: unknown[] } }>(
				'violet-tree-export',
				{ document: d1 }
			);
			const e2 = await kMutateFirst.kernel.call<{ content: { files: unknown[] } }>(
				'violet-tree-export',
				{ document: d2 }
			);
			expect(e1.data?.content.files).toEqual(e2.data?.content.files);
		} finally {
			await kQueryFirst.kernel.dispose();
			await kMutateFirst.kernel.dispose();
		}
	});

	it('leaves tree and rev untouched when an import fails on a bad second file (atomic import)', async () => {
		const { kernel } = await bootKernel();
		try {
			const doc = await createDoc(kernel, 'blank');
			const beforeExport = await kernel.call<{ rev: number; content: { files: unknown[] } }>(
				'violet-tree-export',
				{ document: doc }
			);
			const bad = await kernel.call('violet-tree-import', {
				document: doc,
				content: {
					files: [
						{
							name: 'base.tokens.json',
							content: '{"color": {"$type": "color", "bg": {"$value": "#ffffff"}}}',
						},
						{
							name: 'broken.tokens.json',
							content: '{not valid json',
						},
					],
				},
			});
			expect(bad.success).toBe(false);
			const afterList = await kernel.call<{ root: string | null; nodes: unknown[] }>(
				'violet-node-list',
				{ document: doc }
			);
			expect(afterList.data?.root).toBeNull();
			expect(afterList.data?.nodes).toEqual([]);
			const afterExport = await kernel.call<{ rev: number }>('violet-tree-export', {
				document: doc,
			});
			expect(afterExport.data?.rev).toBe(beforeExport.data?.rev);
		} finally {
			await kernel.dispose();
		}
	});

	it('enforces the replacing-import guard and preserves unexported across dirty additive imports', async () => {
		const { kernel } = await bootKernel();
		try {
			const doc = await createDoc(kernel, 'example');
			await kernel.call('violet-token-override', {
				document: doc,
				node: 'example/dark',
				token: 'color.text.primary',
				value: '#f4f4f8',
			});

			// Additive import on a dirty tree must keep unexported > 0.
			const additive = await kernel.call('violet-tree-import', {
				document: doc,
				content: {
					files: [
						{
							name: 'extra.tokens.json',
							content:
								'{"$extensions": {"dev.lushly.violet": {"parent": "example", "type": "theme"}}, "color": {"text": {"primary": {"$value": "#222226"}}}}',
						},
					],
				},
			});
			expect(additive.success).toBe(true);
			const listAfterAdd = await kernel.call<{ unexported: number }>('violet-node-list', {
				document: doc,
			});
			expect(listAfterAdd.data?.unexported).toBeGreaterThan(0);

			// Replacing import without exportedRev is still refused.
			const refused = await kernel.call('violet-tree-import', {
				document: doc,
				replace: true,
				content: {
					files: [
						{
							name: 'fresh.tokens.json',
							content: '{"color": {"$type": "color", "bg": {"$value": "#ffffff"}}}',
						},
					],
				},
			});
			expect(refused.success).toBe(false);
			expect(refused.error?.code).toBe('OPERATION_NOT_ALLOWED');
			expect(refused.error?.suggestion).toContain('violet-tree-export');

			// Export to obtain rev, then replace succeeds and resets unexported to 0.
			const exported = await kernel.call<{ rev: number }>('violet-tree-export', { document: doc });
			const allowed = await kernel.call<{ rev: number; nodes: Array<{ id: string }> }>(
				'violet-tree-import',
				{
					document: doc,
					replace: true,
					exportedRev: exported.data?.rev,
					content: {
						files: [
							{
								name: 'fresh.tokens.json',
								content: '{"color": {"$type": "color", "bg": {"$value": "#ffffff"}}}',
							},
						],
					},
				}
			);
			expect(allowed.success).toBe(true);
			expect(allowed.data?.nodes.map((n) => n.id)).toEqual(['fresh']);
			const listAfterReplace = await kernel.call<{ unexported: number }>('violet-node-list', {
				document: doc,
			});
			expect(listAfterReplace.data?.unexported).toBe(0);
		} finally {
			await kernel.dispose();
		}
	});

	it('round-trips a blank document through document-export and document-import with files: []', async () => {
		const { kernel } = await bootKernel();
		try {
			const doc = await createDoc(kernel, 'blank', 'Empty tree');
			const envelope = await kernel.call<Record<string, unknown>>('document-export', {
				document: doc,
			});
			expect(envelope.success).toBe(true);
			const imported = await kernel.call<{
				id: string;
				next: { command: string; input: Record<string, unknown> };
			}>('document-import', { type: 'violet-tree', envelope: envelope.data });
			expect(imported.success).toBe(true);
			expect(imported.data?.next.command).toBe('violet-tree-import');
			const nextRes = await kernel.call(
				imported.data?.next.command as string,
				imported.data?.next.input
			);
			expect(nextRes.success, JSON.stringify(nextRes.error)).toBe(true);
			const list = await kernel.call<{ root: string | null; nodes: unknown[] }>(
				'violet-node-list',
				{
					document: imported.data?.id,
				}
			);
			expect(list.data?.root).toBeNull();
			expect(list.data?.nodes).toEqual([]);
		} finally {
			await kernel.dispose();
		}
	});
});

describe('preview/apply parity and violet-export checks (spec §9.1)', () => {
	it('agrees between preview and apply on inherited-only reset, dependent-blocked reset, root-add reset, and stale expectedRev', async () => {
		const { kernel } = await bootKernel();
		try {
			const doc = await createDoc(kernel, 'example');

			// 1. Inherited-only reset fails identically in preview and apply.
			const inheritedChange = [{ operation: 'reset' as const, token: 'color.text.primary' }];
			const prevInherited = await kernel.call('violet-change-preview', {
				document: doc,
				node: 'example/light',
				changes: inheritedChange,
			});
			const applyInherited = await kernel.call('violet-change-apply', {
				document: doc,
				node: 'example/light',
				changes: inheritedChange,
			});
			expect(prevInherited.success).toBe(false);
			expect(applyInherited.success).toBe(false);
			expect(prevInherited.error?.code).toBe('TOKEN_NOT_FOUND');
			expect(applyInherited.error?.code).toBe('TOKEN_NOT_FOUND');

			// 2. Dependent-blocked reset of a root token read by children fails identically.
			const depChange = [{ operation: 'reset' as const, token: 'color.text.primary' }];
			const prevDep = await kernel.call('violet-change-preview', {
				document: doc,
				node: 'example',
				changes: depChange,
			});
			const applyDep = await kernel.call('violet-change-apply', {
				document: doc,
				node: 'example',
				changes: depChange,
			});
			expect(prevDep.success).toBe(false);
			expect(applyDep.success).toBe(false);
			expect(prevDep.error?.code).toBe('OPERATION_NOT_ALLOWED');
			expect(applyDep.error?.code).toBe('OPERATION_NOT_ALLOWED');

			// 3. Root-add reset (leaf node with no children) succeeds identically in preview and apply.
			await kernel.call('violet-token-add', {
				document: doc,
				node: 'example/light',
				token: 'color.temp.badge',
				value: '#334455',
			});
			const rootAddReset = [{ operation: 'reset' as const, token: 'color.temp.badge' }];
			const prevReset = await kernel.call<{
				summary: { changed: number };
				apply: { command: string; input: Record<string, unknown> };
			}>('violet-change-preview', {
				document: doc,
				node: 'example/light',
				changes: rootAddReset,
			});
			expect(prevReset.success, JSON.stringify(prevReset.error)).toBe(true);
			expect(prevReset.data?.summary.changed).toBeGreaterThanOrEqual(1);

			// 4. Stale expectedRev is refused after an intervening edit.
			const staleInput = prevReset.data?.apply.input;
			await kernel.call('violet-token-override', {
				document: doc,
				node: 'example/dark',
				token: 'color.text.primary',
				value: '#e0e0ea',
			});
			const staleApply = await kernel.call('violet-change-apply', staleInput);
			expect(staleApply.success).toBe(false);
			expect(staleApply.error?.code).toBe('OPERATION_NOT_ALLOWED');
			expect(staleApply.error?.suggestion).toContain('violet-change-preview');

			// Fresh preview + apply succeeds.
			const freshPreview = await kernel.call<{ apply: { input: Record<string, unknown> } }>(
				'violet-change-preview',
				{ document: doc, node: 'example/light', changes: rootAddReset }
			);
			const freshApply = await kernel.call('violet-change-apply', freshPreview.data?.apply.input);
			expect(freshApply.success, JSON.stringify(freshApply.error)).toBe(true);

			// 5. Multi-change failing batch (inherited-only reset at index 0 + missing token at index 1)
			// must fail identically in preview and apply with details.index === 0 (never masked by changes.impact).
			const multiFailing = [
				{ operation: 'reset' as const, token: 'color.text.primary' },
				{ operation: 'override' as const, token: 'color.missing.second', value: '#111111' },
			];
			const prevMulti = await kernel.call('violet-change-preview', {
				document: doc,
				node: 'example/light',
				changes: multiFailing,
			});
			const applyMulti = await kernel.call('violet-change-apply', {
				document: doc,
				node: 'example/light',
				changes: multiFailing,
			});
			expect(prevMulti.success).toBe(false);
			expect(applyMulti.success).toBe(false);
			expect(applyMulti.error?.code).toBe(prevMulti.error?.code);
			expect(applyMulti.error?.message).toBe(prevMulti.error?.message);
			expect(applyMulti.error?.suggestion).toBe(prevMulti.error?.suggestion);
			expect(prevMulti.error?.details).toMatchObject({ index: 0 });
			expect(applyMulti.error?.details).toMatchObject({ index: 0 });

			// 6. INVALID_TOKEN_VALUE override parity: both preview and apply include tokenType in suggestion.
			const badOverride = [
				{ operation: 'override' as const, token: 'color.text.primary', value: 'url(evil)' },
			];
			const prevBad = await kernel.call('violet-change-preview', {
				document: doc,
				node: 'example/dark',
				changes: badOverride,
			});
			const applyBad = await kernel.call('violet-change-apply', {
				document: doc,
				node: 'example/dark',
				changes: badOverride,
			});
			expect(prevBad.success).toBe(false);
			expect(applyBad.success).toBe(false);
			expect(applyBad.error?.code).toBe(prevBad.error?.code);
			expect(applyBad.error?.suggestion).toBe(prevBad.error?.suggestion);
			expect(prevBad.error?.suggestion).toContain('color');
		} finally {
			await kernel.dispose();
		}
	});

	it('reports node-only violation counts and surfaces TOKEN_REFERENCE_NOT_FOUND, CIRCULAR_REFERENCE, and NOT_IMPLEMENTED on violet-export', async () => {
		const { kernel } = await bootKernel({ config: { interface: PINNED_INTERFACE } });
		try {
			const doc = await createDoc(kernel, 'example');
			// Break contrast only in example/dark, keep example root clean.
			await kernel.call('violet-token-override', {
				document: doc,
				node: 'example/dark',
				token: 'color.text.muted',
				value: '#202024',
			});
			const rootExport = await kernel.call<{ checks: { violations: number; unfilled: number } }>(
				'violet-export',
				{ document: doc, node: 'example', format: 'css' }
			);
			const darkExport = await kernel.call<{ checks: { violations: number; unfilled: number } }>(
				'violet-export',
				{ document: doc, node: 'example/dark', format: 'css' }
			);
			expect(rootExport.success).toBe(true);
			expect(rootExport.data?.checks.violations).toBe(0);
			expect(darkExport.data?.checks.violations).toBeGreaterThanOrEqual(1);

			// TOKEN_REFERENCE_NOT_FOUND
			const dMissing = await createDoc(kernel, 'blank');
			await kernel.call('violet-node-create', {
				document: dMissing,
				parent: null,
				id: 'base',
				type: 'product',
			});
			await kernel.call('violet-token-add', {
				document: dMissing,
				node: 'base',
				token: 'color.broken',
				value: '{color.does.not.exist}',
			});
			const missingRef = await kernel.call('violet-export', {
				document: dMissing,
				node: 'base',
				format: 'css',
			});
			expect(missingRef.success).toBe(false);
			expect(missingRef.error?.code).toBe('TOKEN_REFERENCE_NOT_FOUND');
			expect(missingRef.error?.suggestion).toContain('violet-token-lineage');

			// CIRCULAR_REFERENCE
			const dCycle = await createDoc(kernel, 'blank');
			await kernel.call('violet-node-create', {
				document: dCycle,
				parent: null,
				id: 'base',
				type: 'product',
			});
			await kernel.call('violet-token-add', {
				document: dCycle,
				node: 'base',
				token: 'color.a',
				value: '{color.b}',
			});
			await kernel.call('violet-token-add', {
				document: dCycle,
				node: 'base',
				token: 'color.b',
				value: '{color.a}',
			});
			const cycleRes = await kernel.call('violet-export', {
				document: dCycle,
				node: 'base',
				format: 'css',
			});
			expect(cycleRes.success).toBe(false);
			expect(cycleRes.error?.code).toBe('CIRCULAR_REFERENCE');
			expect(cycleRes.error?.suggestion).toContain('violet-token-override');

			// NOT_IMPLEMENTED (reference transform)
			const dTransform = await createDoc(kernel, 'blank');
			await kernel.call('violet-node-create', {
				document: dTransform,
				parent: null,
				id: 'base',
				type: 'product',
			});
			await kernel.call('violet-token-add', {
				document: dTransform,
				node: 'base',
				token: 'color.src',
				value: '#112233',
			});
			await kernel.call('violet-token-add', {
				document: dTransform,
				node: 'base',
				token: 'color.derived',
				value: { ref: 'color.src', transform: 'darken(10%)' },
			});
			const transformRes = await kernel.call('violet-export', {
				document: dTransform,
				node: 'base',
				format: 'css',
			});
			expect(transformRes.success).toBe(false);
			expect(transformRes.error?.code).toBe('NOT_IMPLEMENTED');
			expect(transformRes.error?.suggestion).toContain('violet-token-override');
		} finally {
			await kernel.dispose();
		}
	});
});

describe('undo acceptance tests for every undoable mutation (spec §5.7, §9.1)', () => {
	async function snapshotTree(
		kernel: Awaited<ReturnType<typeof bootKernel>>['kernel'],
		document: string
	) {
		const list = await kernel.call<{ root: string | null; nodes: unknown[]; unexported: number }>(
			'violet-node-list',
			{ document }
		);
		const exp = await kernel.call<{ content: { files: unknown[] } }>('violet-tree-export', {
			document,
		});
		expect(list.success).toBe(true);
		expect(exp.success, JSON.stringify(exp.error)).toBe(true);
		return {
			root: list.data?.root,
			nodes: list.data?.nodes,
			unexported: list.data?.unexported ?? 0,
			files: exp.data?.content.files,
		};
	}

	async function assertRoundTripUndo(
		kernel: Awaited<ReturnType<typeof bootKernel>>['kernel'],
		document: string,
		command: string,
		input: Record<string, unknown>
	) {
		const before = await snapshotTree(kernel, document);
		const mutated = await kernel.call(command, input);
		expect(mutated.success, `${command}: ${JSON.stringify(mutated.error)}`).toBe(true);
		expect(mutated.undoCommand, `${command} undoCommand`).toBeTruthy();
		expect(mutated.undoArgs, `${command} undoArgs`).toBeTruthy();
		const undone = await kernel.call(mutated.undoCommand as string, mutated.undoArgs);
		expect(undone.success, `undo ${mutated.undoCommand}: ${JSON.stringify(undone.error)}`).toBe(
			true
		);
		const after = await snapshotTree(kernel, document);
		expect(after.root).toEqual(before.root);
		expect(after.nodes).toEqual(before.nodes);
		expect(after.files).toEqual(before.files);
		expect(after.unexported).toBe(before.unexported + 2);
	}

	it('undoes inherited override, own override, add with metadata, reset of add with metadata, batch apply, node create/delete, >50 overrides, composite/ref value, and constraints', async () => {
		const { kernel } = await bootKernel();
		try {
			const doc = await createDoc(kernel, 'example');

			// 1. Inherited override -> reset
			await assertRoundTripUndo(kernel, doc, 'violet-token-override', {
				document: doc,
				node: 'example/dark',
				token: 'color.action.primary.background',
				value: '#7a63e6',
			});

			// 2. Own override -> override back
			await assertRoundTripUndo(kernel, doc, 'violet-token-override', {
				document: doc,
				node: 'example/dark',
				token: 'color.text.primary',
				value: '#fafaff',
			});

			// 3. Add with metadata -> reset
			await assertRoundTripUndo(kernel, doc, 'violet-token-add', {
				document: doc,
				node: 'example/light',
				token: 'color.accent.new',
				value: '#225588',
				metadata: { type: 'color', category: 'color', description: 'Accent' },
			});

			// 4. Reset of a removed add with metadata -> change-apply (preserves $type in exported file!)
			await kernel.call('violet-token-add', {
				document: doc,
				node: 'example/light',
				token: 'color.custom.meta',
				value: '#336699',
				metadata: { type: 'color', category: 'color', description: 'Keep me' },
			});
			await assertRoundTripUndo(kernel, doc, 'violet-token-reset', {
				document: doc,
				node: 'example/light',
				token: 'color.custom.meta',
			});

			// 5. Multi-change apply -> change-apply
			await assertRoundTripUndo(kernel, doc, 'violet-change-apply', {
				document: doc,
				node: 'example/dark',
				changes: [
					{ operation: 'override', token: 'color.text.primary', value: '#fafafa' },
					{ operation: 'add', token: 'color.temp.two', value: '#445566' },
					{ operation: 'reset', token: 'color.field.border' },
				],
			});

			// 6. Node create -> node delete
			await assertRoundTripUndo(kernel, doc, 'violet-node-create', {
				document: doc,
				parent: 'example',
				id: 'example/dim',
				type: 'theme',
			});

			// 7. Node delete -> node create with restore: true
			await assertRoundTripUndo(kernel, doc, 'violet-node-delete', {
				document: doc,
				node: 'example/high-contrast',
			});

			// 8. >50 historical overrides on one token collapse to 1 inverse change on reset.
			for (let i = 0; i < 55; i++) {
				const hex = `#${i.toString(16).padStart(2, '0')}2233`;
				const step = await kernel.call('violet-token-override', {
					document: doc,
					node: 'example/dark',
					token: 'color.text.muted',
					value: hex,
				});
				expect(step.success).toBe(true);
			}
			const beforeCollapse = await snapshotTree(kernel, doc);
			const resetMany = await kernel.call('violet-token-reset', {
				document: doc,
				node: 'example/dark',
				token: 'color.text.muted',
			});
			expect(resetMany.success).toBe(true);
			expect(resetMany.undoCommand).toBe('violet-change-apply');
			expect((resetMany.undoArgs as { changes: unknown[] }).changes).toHaveLength(1);
			const undoneMany = await kernel.call(resetMany.undoCommand as string, resetMany.undoArgs);
			expect(undoneMany.success).toBe(true);
			const afterCollapse = await snapshotTree(kernel, doc);
			expect(afterCollapse.files).toEqual(beforeCollapse.files);

			// 9. Constraint set on child with merge: true where parent already has rules.
			const rule1 = {
				id: 'child-contrast-1',
				name: 'Child contrast 1',
				applyTo: 'color.text.*',
				config: { type: 'contrast' as const, against: 'color.surface.page', min: 4.5 },
			};
			const rule2 = {
				id: 'child-contrast-2',
				name: 'Child contrast 2',
				applyTo: 'color.text.muted',
				config: { type: 'contrast' as const, against: 'color.surface.page', min: 7 },
			};
			const setFirst = await kernel.call<{ constraints: unknown[]; previous: unknown[] }>(
				'violet-constraint-set',
				{ document: doc, node: 'example/dark', constraints: [rule1], merge: false }
			);
			expect(setFirst.success, JSON.stringify(setFirst.error)).toBe(true);
			const setMerged = await kernel.call<{ constraints: unknown[]; previous: unknown[] }>(
				'violet-constraint-set',
				{ document: doc, node: 'example/dark', constraints: [rule2], merge: true }
			);
			expect(setMerged.success, JSON.stringify(setMerged.error)).toBe(true);
			expect(setMerged.data?.constraints).toHaveLength(2);
			expect(setMerged.data?.previous).toMatchObject([{ id: 'child-contrast-1' }]);
			const undoMerged = await kernel.call(setMerged.undoCommand as string, setMerged.undoArgs);
			expect(undoMerged.success, JSON.stringify(undoMerged.error)).toBe(true);
			expect((undoMerged.data as { constraints: unknown[] }).constraints).toMatchObject([
				{ id: 'child-contrast-1' },
			]);

			// 10. Imported composite/reference token value edit & undo.
			const dComp = await createDoc(kernel, 'blank');
			const impComp = await kernel.call('violet-tree-import', {
				document: dComp,
				content: {
					files: [
						{
							name: 'base.tokens.json',
							content: JSON.stringify({
								color: {
									$type: 'color',
									fg: { $value: '#111111' },
									alias: { $value: '{color.fg}' },
								},
							}),
						},
					],
				},
			});
			expect(impComp.success).toBe(true);
			// violet-tree-import advertises no undoCommand.
			expect(impComp.undoCommand).toBeUndefined();
			await assertRoundTripUndo(kernel, dComp, 'violet-token-override', {
				document: dComp,
				node: 'base',
				token: 'color.alias',
				value: '#222222',
			});

			// 11. Long imported $description (>500 chars) survives reset + undo without schema rejection.
			const longDesc = 'Long token description. '.repeat(26);
			expect(longDesc.length).toBeGreaterThan(500);
			const dLong = await createDoc(kernel, 'blank');
			const impLong = await kernel.call('violet-tree-import', {
				document: dLong,
				content: {
					files: [
						{
							name: 'base.tokens.json',
							content: JSON.stringify({
								color: {
									$type: 'color',
									accent: { $value: '#336699', $description: longDesc },
								},
							}),
						},
					],
				},
			});
			expect(impLong.success, JSON.stringify(impLong.error)).toBe(true);
			await assertRoundTripUndo(kernel, dLong, 'violet-token-reset', {
				document: dLong,
				node: 'base',
				token: 'color.accent',
			});
		} finally {
			await kernel.dispose();
		}
	});
});

describe('cache isolation, store.put failure, grants, metadata, suggestions, and bundled interface (spec §9.1)', () => {
	it('isolates cache across two kernels reusing the same document id and evicts on refused store.put', async () => {
		const sharedPort = createVioletPort();
		const h = createHandlers(sharedPort);

		const makeStore = (failPut = false) => {
			const map = new Map<string, unknown>();
			return {
				map,
				async get<T>(key: string) {
					return map.get(key) as T | undefined;
				},
				async put(key: string, value: unknown) {
					if (failPut) {
						throw Object.assign(new Error('Store quota exceeded'), { code: 'QUOTA_EXCEEDED' });
					}
					map.set(key, structuredClone(value));
				},
				async delete(key: string) {
					map.delete(key);
				},
				async list() {
					return [...map.entries()].map(([key, value]) => ({ key, value }));
				},
			};
		};

		const callHandler = (name: string, input: unknown, ctx: AppCallContextV1) => {
			const fn = h[name] as
				| ((i: unknown, c: AppCallContextV1) => Promise<Record<string, unknown>>)
				| undefined;
			if (!fn) throw new Error(`Missing handler ${name}`);
			return fn(input, ctx);
		};

		const makeCtx = (store: ReturnType<typeof makeStore>): AppCallContextV1 => ({
			traceId: 'test-trace',
			now: () => 1_700_000_000_000,
			random: () => 0.123456,
			store,
			config: {},
			scope: { workspace: 'personal' },
			client: { call: async () => ({ success: false }) as never },
		});

		const docId = 'doc_reused_id001';
		const storeA = makeStore();
		const storeB = makeStore();
		await storeA.put(documentContentKey(docId), {
			format: 'violet-tree',
			version: 1,
			rev: 0,
			syncedRev: 0,
			seed: {
				files: [
					{
						name: 'a.tokens.json',
						content: '{"color": {"$type": "color", "bg": {"$value": "#111111"}}}',
					},
				],
			},
		});
		await storeB.put(documentContentKey(docId), {
			format: 'violet-tree',
			version: 1,
			rev: 0,
			syncedRev: 0,
			seed: {
				files: [
					{
						name: 'a.tokens.json',
						content: '{"color": {"$type": "color", "bg": {"$value": "#111111"}}}',
					},
				],
			},
		});

		// Same document id, same template, different edits.
		await callHandler(
			'violet-token-override',
			{ document: docId, node: 'a', token: 'color.bg', value: '#222222' },
			makeCtx(storeA)
		);
		await callHandler(
			'violet-token-override',
			{ document: docId, node: 'a', token: 'color.bg', value: '#333333' },
			makeCtx(storeB)
		);
		const readA = await callHandler(
			'violet-token-resolve',
			{ document: docId, node: 'a' },
			makeCtx(storeA)
		);
		const readB = await callHandler(
			'violet-token-resolve',
			{ document: docId, node: 'a' },
			makeCtx(storeB)
		);
		expect((readA.data as { tokens: Array<{ value: string }> }).tokens[0]?.value).toBe('#222222');
		expect((readB.data as { tokens: Array<{ value: string }> }).tokens[0]?.value).toBe('#333333');

		// Same document id, different templates (blank vs populated).
		const storeBlank = makeStore();
		await storeBlank.put(documentContentKey(docId), {
			format: 'violet-tree',
			version: 1,
			rev: 0,
			syncedRev: 0,
			records: { nodes: [], operations: [], constraints: {}, audit: [] },
		});
		const listBlank = await callHandler(
			'violet-node-list',
			{ document: docId },
			makeCtx(storeBlank)
		);
		const listPopulated = await callHandler(
			'violet-node-list',
			{ document: docId },
			makeCtx(storeA)
		);
		expect((listBlank.data as { nodes: unknown[] }).nodes).toEqual([]);
		expect((listPopulated.data as { nodes: unknown[] }).nodes).toHaveLength(1);

		// Refused store.put drops the cache entry so the next read still sees the stored value.
		const failingStore = makeStore(true);
		failingStore.map.set(
			documentContentKey(docId),
			structuredClone(storeA.map.get(documentContentKey(docId)))
		);
		await expect(
			callHandler(
				'violet-token-override',
				{ document: docId, node: 'a', token: 'color.bg', value: '#999999' },
				makeCtx(failingStore)
			)
		).rejects.toThrow('Store quota exceeded');
		const afterFail = await callHandler(
			'violet-token-resolve',
			{ document: docId, node: 'a' },
			makeCtx(failingStore)
		);
		expect((afterFail.data as { tokens: Array<{ value: string }> }).tokens[0]?.value).toBe(
			'#222222'
		);
	});

	it('returns APP_GRANT_MISSING without store, clock, or random and drops Violet metadata', async () => {
		const h = createHandlers(createVioletPort());
		const callHandler = (name: string, input: unknown, ctx: AppCallContextV1) => {
			const fn = h[name] as
				| ((i: unknown, c: AppCallContextV1) => Promise<Record<string, unknown>>)
				| undefined;
			if (!fn) throw new Error(`Missing handler ${name}`);
			return fn(input, ctx);
		};
		const baseCtx = {
			traceId: 'trace-1',
			config: {},
			scope: { workspace: 'personal' },
			client: { call: async () => ({ success: false }) as never },
		} satisfies AppCallContextV1;

		const noStore = await callHandler('violet-node-list', { document: 'doc_1' }, baseCtx);
		expect(noStore.success).toBe(false);
		expect((noStore.error as { code?: string })?.code).toBe('APP_GRANT_MISSING');

		const emptyStore = {
			get: async () => undefined,
			put: async () => {},
			delete: async () => {},
			list: async () => [],
		};
		const noClock = await callHandler(
			'violet-node-create',
			{ document: 'doc_1', parent: null, id: 'base', type: 'product' },
			{ ...baseCtx, store: emptyStore, random: () => 0.5 }
		);
		expect(noClock.success).toBe(false);
		expect((noClock.error as { code?: string })?.code).toBe('APP_GRANT_MISSING');

		const noRandom = await callHandler(
			'violet-node-create',
			{ document: 'doc_1', parent: null, id: 'base', type: 'product' },
			{ ...baseCtx, store: emptyStore, now: () => 100 }
		);
		expect(noRandom.success).toBe(false);
		expect((noRandom.error as { code?: string })?.code).toBe('APP_GRANT_MISSING');

		// violet-change-preview dry-runs mutations and must also require clock and random grants.
		const previewNoClock = await callHandler(
			'violet-change-preview',
			{
				document: 'doc_1',
				node: 'base',
				changes: [{ operation: 'add', token: 'color.bg', value: '#ffffff' }],
			},
			{ ...baseCtx, store: emptyStore, random: () => 0.5 }
		);
		expect(previewNoClock.success).toBe(false);
		expect((previewNoClock.error as { code?: string })?.code).toBe('APP_GRANT_MISSING');

		const previewNoRandom = await callHandler(
			'violet-change-preview',
			{
				document: 'doc_1',
				node: 'base',
				changes: [{ operation: 'add', token: 'color.bg', value: '#ffffff' }],
			},
			{ ...baseCtx, store: emptyStore, now: () => 100 }
		);
		expect(previewNoRandom.success).toBe(false);
		expect((previewNoRandom.error as { code?: string })?.code).toBe('APP_GRANT_MISSING');

		// Verify Violet's reasoning/sources/confidence are dropped on handler results.
		const ok = await callHandler(
			'violet-node-create',
			{ document: 'doc_1', parent: null, id: 'base', type: 'product' },
			{ ...baseCtx, store: emptyStore, now: () => 100, random: () => 0.5 }
		);
		expect(ok.success).toBe(true);
		expect(ok.reasoning).toBeUndefined();
		expect(ok.sources).toBeUndefined();
		expect(ok.confidence).toBeUndefined();
	});

	it('rewrites every Violet error suggestion without leaving dotted names, violet call, --force, force: true, or --schema', () => {
		const forbidden =
			/\b(?:node\.(?:list|get|create|delete|update)|token\.(?:add|override|reset|remove|subtract|copy|lineage)|tokens\.(?:resolve|compare|catalog)|changes\.impact|audit\.list|constraints\.set|analyze\.violations|interface\.check|export\.tree|import\.tree|violet\s+call|force:\s*true)\b|--force|--schema/;

		const sampleErrors = [
			{
				code: 'NODE_NOT_FOUND',
				violetCommand: 'node.get',
				suggestion: "Use 'node.list' to see available nodes",
			},
			{
				code: 'TOKEN_NOT_FOUND',
				violetCommand: 'token.lineage',
				suggestion: "Use 'tokens.resolve' or 'tokens.catalog'",
			},
			{
				code: 'TOKEN_NOT_FOUND',
				violetCommand: 'token.override',
				suggestion: "Use 'token.add' to create it",
			},
			{ code: 'TOKEN_NOT_FOUND', violetCommand: 'token.remove', suggestion: "Use 'node.get'" },
			{
				code: 'NODE_ALREADY_EXISTS',
				violetCommand: 'node.create',
				message: 'Node was deleted',
				suggestion: "Use 'node.update'",
			},
			{
				code: 'NODE_HAS_CHILDREN',
				violetCommand: 'node.delete',
				suggestion: 'Pass --force or force: true',
			},
			{
				code: 'INVALID_TOKEN_VALUE',
				violetCommand: 'token.override',
				suggestion: 'Avoid unsafe CSS values',
			},
			{
				code: 'INVALID_PARENT',
				violetCommand: 'node.create',
				suggestion: "Check 'violet node list'",
			},
			{
				code: 'OPERATION_NOT_ALLOWED',
				violetCommand: 'token.remove',
				suggestion: 'Reset dependents first, or pass force: true',
			},
			{
				code: 'OPERATION_NOT_ALLOWED',
				violetCommand: 'export.tree',
				suggestion: 'Unsupported reset/subtract/copy',
			},
			{ code: 'OPERATION_NOT_ALLOWED', violetCommand: 'import.tree', suggestion: 'Export first' },
			{ code: 'TOKEN_REFERENCE_NOT_FOUND', violetCommand: 'export', suggestion: 'Missing ref' },
			{ code: 'CIRCULAR_REFERENCE', violetCommand: 'export', suggestion: 'Break cycle' },
			{ code: 'NOT_IMPLEMENTED', violetCommand: 'export', suggestion: 'Transform unsupported' },
			{
				code: 'DUPLICATE_CONSTRAINT_ID',
				violetCommand: 'constraints.set',
				suggestion: 'Duplicate id',
			},
			{
				code: 'TOKEN_ALREADY_EXISTS',
				violetCommand: 'token.add',
				suggestion: "Use 'token.override'",
			},
			{
				code: 'VALIDATION_ERROR',
				violetCommand: 'tokens.compare',
				suggestion: 'Run violet call tokens.compare --schema',
			},
			{ code: 'INTERNAL_ERROR', violetCommand: 'export', suggestion: 'Internal failure' },
		];

		// Also cover every registered Violet command against every known error code.
		const registered = violetRegistry.list();
		expect(registered.length).toBeGreaterThan(0);
		const allCodes = [...new Set(sampleErrors.map((e) => e.code))];
		for (const cmd of registered) {
			for (const errCode of allCodes) {
				sampleErrors.push({
					code: errCode,
					violetCommand: cmd.name,
					suggestion: `Run violet call ${cmd.name} --schema or use ${cmd.name} --force`,
				});
			}
		}

		for (const sample of sampleErrors) {
			const rewritten = rewriteVioletError(
				{
					code: sample.code,
					message: sample.message ?? `Error in ${sample.violetCommand}`,
					suggestion: sample.suggestion,
				},
				{ appCommand: 'violet-node-list', violetCommand: sample.violetCommand }
			);
			expect(rewritten.suggestion, `${sample.violetCommand}:${sample.code}`).toBeTruthy();
			expect(rewritten.suggestion, `${sample.violetCommand}:${sample.code}`).not.toMatch(forbidden);
			expect(rewritten.message, `${sample.violetCommand}:${sample.code}`).not.toMatch(forbidden);
		}

		// export.tree OPERATION_NOT_ALLOWED specifically names violet-tree-export, never violet-export.
		const treeExportErr = rewriteVioletError(
			{
				code: 'OPERATION_NOT_ALLOWED',
				message: 'Unsupported reset/subtract/copy',
				suggestion: 'Clean up operations then export again',
			},
			{ appCommand: 'violet-tree-export', violetCommand: 'export.tree' }
		);
		expect(treeExportErr.suggestion).toContain('violet-tree-export');
		expect(treeExportErr.suggestion).not.toMatch(/\bviolet-export\b/);
	});

	it('rejects malformed stored records with VIOLET_CONTENT_INVALID, rejects soft-deleted parents on additive import, and returns imported nodes in tree pre-order', async () => {
		const malformed = parseStoredContent({
			format: 'violet-tree',
			version: 1,
			rev: 1,
			syncedRev: 0,
			records: { nodes: [{}], operations: [], constraints: {}, audit: [] },
		});
		expect(malformed.ok).toBe(false);
		if (!malformed.ok) expect(malformed.code).toBe('VIOLET_CONTENT_INVALID');

		const { kernel } = await bootKernel();
		try {
			const doc = await createDoc(kernel, 'example');
			const del = await kernel.call('violet-node-delete', {
				document: doc,
				node: 'example/high-contrast',
			});
			expect(del.success).toBe(true);

			// Additive import targeting a soft-deleted parent must return INVALID_PARENT.
			const badParent = await kernel.call('violet-tree-import', {
				document: doc,
				content: {
					files: [
						{
							name: 'child.tokens.json',
							content: JSON.stringify({
								$extensions: {
									'dev.lushly.violet': { parent: 'example/high-contrast', type: 'theme' },
								},
								color: { $type: 'color', surface: { page: { $value: '#050505' } } },
							}),
						},
					],
				},
			});
			expect(badParent.success).toBe(false);
			expect(badParent.error?.code).toBe('INVALID_PARENT');

			// Passing child file before parent file still returns `nodes` in tree pre-order.
			const blank = await createDoc(kernel, 'blank');
			const orderedImport = await kernel.call<{
				nodes: Array<{ id: string; parent: string | null }>;
			}>('violet-tree-import', {
				document: blank,
				content: {
					files: [
						{
							name: 'child.tokens.json',
							content: JSON.stringify({
								$extensions: {
									'dev.lushly.violet': { parent: 'root', type: 'theme' },
								},
								color: { $type: 'color', bg: { $value: '#111111' } },
							}),
						},
						{
							name: 'root.tokens.json',
							content: JSON.stringify({
								$extensions: { 'dev.lushly.violet': { type: 'product' } },
								color: { $type: 'color', bg: { $value: '#ffffff' } },
							}),
						},
					],
				},
			});
			expect(orderedImport.success, JSON.stringify(orderedImport.error)).toBe(true);
			expect(orderedImport.data?.nodes.map((n) => n.id)).toEqual(['root', 'child']);
		} finally {
			await kernel.dispose();
		}
	});

	it('passes afd-default against the bundled 98-id interface with zero missing, invalid, or leaked entries and detects leaked-only failure', async () => {
		const { kernel } = await bootKernel();
		try {
			const doc = await createDoc(kernel, 'afd-default', 'AFD default');
			const checked = await kernel.call<{
				complete: boolean;
				nodes: string[];
				missing: unknown[];
				invalid: unknown[];
				leaked: unknown[];
			}>('violet-interface-check', { document: doc });
			expect(checked.success, JSON.stringify(checked.error)).toBe(true);
			expect(checked.data?.complete).toBe(true);
			expect(checked.data?.missing).toEqual([]);
			expect(checked.data?.invalid).toEqual([]);
			expect(checked.data?.leaked).toEqual([]);
			expect(checked.data?.nodes.length).toBeGreaterThanOrEqual(3);

			// Also verify 0 missing, 0 invalid + 1 leaked entry is reported as incomplete (spec §7.6, #2295).
			const leakedInterface = {
				contractVersion: 1,
				tokens: {
					'color.surface.page': { property: '--violet-color-surface-page', type: 'color' },
					'color.text.primary': { property: '--violet-color-text-primary', type: 'color' },
					'ref.palette.neutral.50': { property: '--ref-palette-neutral-50', type: 'color' },
				},
			};
			const leakKernel = await bootKernel({ config: { interface: leakedInterface } });
			try {
				const leakDoc = await createDoc(leakKernel.kernel, 'afd-default', 'Leak check');
				const addLeaked = await leakKernel.kernel.call('violet-token-add', {
					document: leakDoc,
					node: 'loam',
					token: 'ref.palette.neutral.50',
					value: '#fafafa',
					metadata: { type: 'color', category: 'color' },
				});
				expect(addLeaked.success, JSON.stringify(addLeaked.error)).toBe(true);
				const leakRes = await leakKernel.kernel.call<{
					complete: boolean;
					missing: unknown[];
					invalid: unknown[];
					leaked: Array<{ token: string; reason: string }>;
				}>('violet-interface-check', { document: leakDoc });
				expect(leakRes.success).toBe(true);
				expect(leakRes.data?.missing).toEqual([]);
				expect(leakRes.data?.invalid).toEqual([]);
				expect(leakRes.data?.complete).toBe(false);
				expect(leakRes.data?.leaked.some((entry) => entry.token === 'ref.palette.neutral.50')).toBe(
					true
				);
			} finally {
				await leakKernel.kernel.dispose();
			}
		} finally {
			await kernel.dispose();
		}
	});

	it('keeps serialized VioletTreeContentV1 well under 1 MiB after 50 overrides on afd-default (Q12)', async () => {
		const port = createVioletPort();
		const h = createHandlers(port);
		const map = new Map<string, unknown>();
		const store = {
			async get<T>(key: string) {
				return map.get(key) as T | undefined;
			},
			async put(key: string, value: unknown) {
				map.set(key, structuredClone(value));
			},
			async delete(key: string) {
				map.delete(key);
			},
			async list() {
				return [...map.entries()].map(([key, value]) => ({ key, value }));
			},
		};
		let tick = 1_700_000_000_000;
		let seq = 1;
		const ctx: AppCallContextV1 = {
			traceId: 'q12-trace',
			now: () => {
				tick += 1000;
				return tick;
			},
			random: () => {
				seq = (seq * 48271) % 2147483647;
				return seq / 2147483647;
			},
			store,
			config: {},
			scope: { workspace: 'personal' },
			client: { call: async () => ({ success: false }) as never },
		};
		const doc = 'doc_q12_measure';
		const manifest = await readAppManifest(ROOT);
		const afdSeed = manifest.ui?.documents
			?.find((d) => d.id === 'violet-tree')
			?.templates?.find((t) => t.id === 'afd-default')?.content;
		expect(afdSeed).toBeDefined();
		await store.put(documentContentKey(doc), afdSeed);

		const overrideFn = h['violet-token-override'] as (
			input: unknown,
			context: AppCallContextV1
		) => Promise<{ success: boolean; error?: unknown }>;
		for (let i = 0; i < 50; i++) {
			const hex = `#${(16 + i).toString(16).padStart(2, '0')}1820`;
			const res = await overrideFn(
				{
					document: doc,
					node: 'loam/dark',
					token: 'color.surface.page',
					value: hex,
					reason: `Iteration ${i}`,
				},
				ctx
			);
			expect(res.success, JSON.stringify(res.error)).toBe(true);
		}
		const stored = map.get(documentContentKey(doc));
		expect(stored).toBeDefined();
		const bytes = Buffer.byteLength(JSON.stringify(stored), 'utf8');
		expect(bytes).toBeGreaterThan(10_000);
		expect(bytes).toBeLessThan(1_048_576);
	});

	it('wires editor-to-inspector selection bus per document and surfaces Checks loader errors instead of healthy', async () => {
		clearSelectionBus();
		const seenA: Array<string | null> = [];
		const seenB: Array<string | null> = [];
		const unsubA = subscribeSelection('doc-a', (sel) => seenA.push(sel));
		const unsubB = subscribeSelection('doc-b', (sel) => seenB.push(sel));

		publishSelection('doc-a', 'example/dark#color.text.primary');
		expect(getSelection('doc-a')).toBe('example/dark#color.text.primary');
		expect(seenA).toEqual(['example/dark#color.text.primary']);
		expect(seenB).toEqual([]);

		// Clearing one document's cached selection must keep live subscribers wired (e.g. split editors).
		clearSelectionBus('doc-a');
		expect(getSelection('doc-a')).toBeUndefined();
		publishSelection('doc-a', 'example/dark#color.surface.page');
		expect(seenA).toEqual(['example/dark#color.text.primary', 'example/dark#color.surface.page']);

		unsubA();
		unsubB();
		publishSelection('doc-a', 'example/light#color.surface.page');
		expect(seenA).toEqual(['example/dark#color.text.primary', 'example/dark#color.surface.page']);
		clearSelectionBus();

		const failingCtx = {
			instance: 'violet',
			app: 'violet',
			version: '0.1.0',
			config: {},
			registry: {} as never,
			kit: { define: async () => {} },
			overlays: {} as never,
			client: {
				call: async (name: string) =>
					name === 'violet-interface-check'
						? { success: false, error: { code: 'INTERNAL_ERROR', message: 'Interface boom' } }
						: { success: true, data: { violations: [] } },
			},
		};
		const checks = await fetchChecksView(failingCtx as never, 'doc-a');
		expect(checks.healthy).toBe(false);
		expect(checks.summary).toBe('Checks unavailable');
		expect(checks.error).toContain('Interface boom');

		// fetchNodeCompare filters out deleted/replaced stale node IDs instead of calling violet-token-compare with them.
		let comparedNodes: string[] = [];
		const compareCtx = {
			...failingCtx,
			client: {
				call: async (_name: string, input: { nodes: string[] }) => {
					comparedNodes = input.nodes;
					return {
						success: true,
						data: { nodes: input.nodes, rows: [], summary: { differing: 0 } },
					};
				},
			},
		};
		const activeNodes = [
			{ id: 'fresh', label: 'fresh', parent: null, type: 'product', customizations: 1, depth: 0 },
			{
				id: 'fresh/light',
				label: 'light',
				parent: 'fresh',
				type: 'theme',
				customizations: 0,
				depth: 1,
			},
			{
				id: 'fresh/dark',
				label: 'dark',
				parent: 'fresh',
				type: 'theme',
				customizations: 1,
				depth: 1,
			},
		];
		const cmp = await fetchNodeCompare(compareCtx as never, 'doc-a', activeNodes, [
			'deleted/old-a',
			'deleted/old-b',
		]);
		expect(cmp.error).toBeUndefined();
		expect(cmp.compareNodes).toEqual(['fresh/light', 'fresh/dark']);
		expect(comparedNodes).toEqual(['fresh/light', 'fresh/dark']);
	});
});

describe('violet-theme-preview (#1786)', () => {
	it('names each property as the shared components read it, under the violet- prefix', async () => {
		const { kernel } = await bootKernel();
		try {
			const doc = await createDoc(kernel, 'example');
			const preview = await kernel.call<{ properties: Array<{ name: string; value: string }> }>(
				'violet-theme-preview',
				{ document: doc, node: 'example/dark' }
			);
			expect(preview.success, JSON.stringify(preview.error)).toBe(true);
			const names = preview.data?.properties.map((property) => property.name) ?? [];
			expect(names.length).toBeGreaterThan(0);
			expect(names.filter((name) => !name.startsWith('--violet-'))).toEqual([]);
			expect(names).toContain('--violet-color-text-primary');
		} finally {
			await kernel.dispose();
		}
	});
});

describe('constraint audit history and DTCG round-trip (#2329, #2330)', () => {
	it('surfaces constraint-set entries in violet-change-list and replays deterministically (#2329)', async () => {
		const { kernel, replay } = await bootKernel();
		try {
			const doc = await createDoc(kernel, 'example');
			const rule = {
				id: 'hc-contrast',
				name: 'High contrast text',
				applyTo: 'color.text.*',
				config: { type: 'contrast' as const, against: 'color.surface.page', min: 7 },
			};
			const setRes = await kernel.call('violet-constraint-set', {
				document: doc,
				node: 'example/high-contrast',
				constraints: [rule],
				merge: true,
			});
			expect(setRes.success, JSON.stringify(setRes.error)).toBe(true);

			const history = await kernel.call<{
				changes: Array<{
					node: string;
					token: string | null;
					operation: string;
					oldValue: unknown;
					value: unknown;
				}>;
				total: number;
			}>('violet-change-list', { document: doc, node: 'example/high-contrast' });
			expect(history.success, JSON.stringify(history.error)).toBe(true);
			expect(history.data?.total).toBe(1);
			expect(history.data?.changes[0]).toMatchObject({
				node: 'example/high-contrast',
				token: null,
				operation: 'constraint-set',
				oldValue: [],
				value: [expect.objectContaining({ id: 'hc-contrast', applyTo: 'color.text.*' })],
			});

			await replay();
		} finally {
			await kernel.dispose();
		}
	});

	it('exports and re-imports node constraints via violet-tree-export and violet-tree-import with dropped: [] (#2330)', async () => {
		const { kernel } = await bootKernel();
		try {
			const sourceDoc = await createDoc(kernel, 'example');
			const exported = await kernel.call<{
				content: { files: Array<{ name: string; content: string }> };
				dropped: unknown[];
			}>('violet-tree-export', { document: sourceDoc });
			expect(exported.success, JSON.stringify(exported.error)).toBe(true);
			expect(exported.data?.dropped).toEqual([]);

			const rootFile = exported.data?.content.files.find((f) => f.name === 'example.tokens.json');
			expect(rootFile).toBeDefined();
			const rootJson = JSON.parse(rootFile?.content ?? '{}');
			expect(rootJson.$extensions['dev.lushly.violet'].constraints).toEqual([
				expect.objectContaining({ id: 'text-on-page', applyTo: 'color.text.*' }),
			]);

			const targetDoc = await createDoc(kernel, 'blank');
			const imported = await kernel.call('violet-tree-import', {
				document: targetDoc,
				content: exported.data?.content,
			});
			expect(imported.success, JSON.stringify(imported.error)).toBe(true);

			// Break contrast in the re-imported tree to prove the imported constraint is active.
			await kernel.call('violet-token-override', {
				document: targetDoc,
				node: 'example/dark',
				token: 'color.text.muted',
				value: '#18181c',
			});
			const violations = await kernel.call<{
				violations: Array<{ node: string; token: string; rule: string }>;
			}>('violet-violation-list', { document: targetDoc });
			expect(violations.success).toBe(true);
			expect(violations.data?.violations).toContainEqual(
				expect.objectContaining({
					node: 'example/dark',
					token: 'color.text.muted',
					rule: 'text-on-page',
				})
			);

			// Invalid constraint in an imported file fails closed with VALIDATION_ERROR without mutating the doc.
			const blankDoc = await createDoc(kernel, 'blank');
			const badImport = await kernel.call('violet-tree-import', {
				document: blankDoc,
				content: {
					files: [
						{
							name: 'bad.tokens.json',
							content: JSON.stringify({
								$extensions: {
									'dev.lushly.violet': {
										type: 'product',
										constraints: [
											{
												id: 'bad-re',
												name: 'Bad regex',
												applyTo: 'color.*',
												config: { type: 'pattern', pattern: '^(a+)+$' },
											},
										],
									},
								},
								color: { $type: 'color', bg: { $value: '#ffffff' } },
							}),
						},
					],
				},
			});
			expect(badImport.success).toBe(false);
			expect(badImport.error?.code).toBe('VALIDATION_ERROR');
			const afterBad = await kernel.call<{ nodes: unknown[] }>('violet-node-list', {
				document: blankDoc,
			});
			expect(afterBad.data?.nodes).toEqual([]);
		} finally {
			await kernel.dispose();
		}
	});

	it('preserves file-embedded constraints in buildFromSeed, merges mixed seeds by rule ID, enforces the 50-rule cap, and survives __proto__ node IDs (#2330)', async () => {
		const port = createVioletPort();
		const h = createHandlers(port);
		const callHandler = (name: string, input: unknown, ctx: AppCallContextV1) => {
			const fn = h[name] as
				| ((i: unknown, c: AppCallContextV1) => Promise<Record<string, unknown>>)
				| undefined;
			if (!fn) throw new Error(`Missing handler ${name}`);
			return fn(input, ctx);
		};
		const makeCtx = () => {
			const map = new Map<string, unknown>();
			const store = {
				map,
				async get<T>(key: string) {
					return map.get(key) as T | undefined;
				},
				async put(key: string, value: unknown) {
					map.set(key, structuredClone(value));
				},
				async delete(key: string) {
					map.delete(key);
				},
				async list() {
					return [...map.entries()].map(([key, value]) => ({ key, value }));
				},
			};
			const ctx: AppCallContextV1 = {
				traceId: 'seed-test',
				now: () => 1_700_000_000_000,
				random: () => 0.25,
				store,
				config: {},
				scope: { workspace: 'personal' },
				client: { call: async () => ({ success: false }) as never },
			};
			return { ctx, store };
		};

		// 1. Seed with file-embedded constraints ONLY (no seed.constraints) activates rules and exports with dropped: []
		{
			const { ctx, store } = makeCtx();
			const doc = 'doc_seed_file_only';
			await store.put(documentContentKey(doc), {
				format: 'violet-tree',
				version: 1,
				rev: 0,
				syncedRev: 0,
				seed: {
					files: [
						{
							name: 'base.tokens.json',
							content: JSON.stringify({
								$extensions: {
									'dev.lushly.violet': {
										type: 'product',
										constraints: [
											{
												id: 'file-contrast',
												name: 'File contrast',
												applyTo: 'color.text',
												config: { type: 'contrast', against: 'color.bg', min: 4.5 },
											},
										],
									},
								},
								color: {
									$type: 'color',
									bg: { $value: '#ffffff' },
									text: { $value: '#cccccc' },
								},
							}),
						},
					],
				},
			});
			const viol = (await callHandler('violet-violation-list', { document: doc }, ctx)) as {
				success: boolean;
				data?: { violations: Array<{ rule: string }> };
			};
			expect(viol.success).toBe(true);
			expect(viol.data?.violations).toContainEqual(
				expect.objectContaining({ rule: 'file-contrast' })
			);
			const exp = (await callHandler('violet-tree-export', { document: doc }, ctx)) as {
				success: boolean;
				data?: { dropped: unknown[]; content: { files: Array<{ content: string }> } };
			};
			expect(exp.success).toBe(true);
			expect(exp.data?.dropped).toEqual([]);
			const exported = JSON.parse(exp.data?.content.files[0]?.content ?? '{}');
			expect(exported.$extensions['dev.lushly.violet'].constraints).toEqual([
				expect.objectContaining({ id: 'file-contrast' }),
			]);
		}

		// 2. Mixed seed (file-embedded + seed.constraints on the same node) merges by rule ID with seed.constraints precedence
		{
			const { ctx, store } = makeCtx();
			const doc = 'doc_seed_mixed';
			await store.put(documentContentKey(doc), {
				format: 'violet-tree',
				version: 1,
				rev: 0,
				syncedRev: 0,
				seed: {
					files: [
						{
							name: 'base.tokens.json',
							content: JSON.stringify({
								$extensions: {
									'dev.lushly.violet': {
										type: 'product',
										constraints: [
											{
												id: 'contrast-rule',
												name: 'File contrast',
												applyTo: 'color.text',
												config: { type: 'contrast', against: 'color.bg', min: 4.5 },
											},
											{
												id: 'shared-id',
												name: 'From file',
												applyTo: 'color.text',
												config: { type: 'enum', values: ['#000000'] },
											},
										],
									},
								},
								color: {
									$type: 'color',
									bg: { $value: '#ffffff' },
									text: { $value: '#000000' },
								},
								space: { $type: 'dimension', sm: { $value: '5px' } },
							}),
						},
					],
					constraints: {
						base: [
							{
								id: 'spacing-rule',
								name: 'Seed spacing',
								applyTo: 'space.*',
								severity: 'error',
								enabled: true,
								config: { type: 'scale', base: 4, tolerance: 0 },
							},
							{
								id: 'shared-id',
								name: 'From seed override',
								applyTo: 'color.text',
								severity: 'error',
								enabled: true,
								config: { type: 'enum', values: ['#000000'] },
							},
						],
					},
				},
			});
			const exp = (await callHandler('violet-tree-export', { document: doc }, ctx)) as {
				success: boolean;
				data?: { content: { files: Array<{ content: string }> } };
			};
			expect(exp.success).toBe(true);
			const constraints = JSON.parse(exp.data?.content.files[0]?.content ?? '{}').$extensions[
				'dev.lushly.violet'
			].constraints as Array<{ id: string; name: string }>;
			expect(constraints.map((c) => c.id)).toEqual(['contrast-rule', 'shared-id', 'spacing-rule']);
			expect(constraints.find((c) => c.id === 'shared-id')?.name).toBe('From seed override');
		}

		// 3. 50-rule cap enforced on violet-tree-import (50 succeeds, 51 fails with VALIDATION_ERROR) and buildFromSeed
		const makeRules = (count: number) =>
			Array.from({ length: count }, (_, idx) => ({
				id: `rule-${String(idx).padStart(2, '0')}`,
				name: `Rule ${idx}`,
				applyTo: 'color.*',
				config: { type: 'enum' as const, values: ['#ffffff'] },
			}));
		{
			const { kernel } = await bootKernel();
			try {
				const doc50 = await createDoc(kernel, 'blank');
				const ok50 = await kernel.call('violet-tree-import', {
					document: doc50,
					content: {
						files: [
							{
								name: 'base.tokens.json',
								content: JSON.stringify({
									$extensions: {
										'dev.lushly.violet': { type: 'product', constraints: makeRules(50) },
									},
									color: { $type: 'color', bg: { $value: '#ffffff' } },
								}),
							},
						],
					},
				});
				expect(ok50.success, JSON.stringify(ok50.error)).toBe(true);

				const doc51 = await createDoc(kernel, 'blank');
				const fail51 = await kernel.call('violet-tree-import', {
					document: doc51,
					content: {
						files: [
							{
								name: 'base.tokens.json',
								content: JSON.stringify({
									$extensions: {
										'dev.lushly.violet': { type: 'product', constraints: makeRules(51) },
									},
									color: { $type: 'color', bg: { $value: '#ffffff' } },
								}),
							},
						],
					},
				});
				expect(fail51.success).toBe(false);
				expect(fail51.error?.code).toBe('VALIDATION_ERROR');
				const list51 = await kernel.call<{ nodes: unknown[] }>('violet-node-list', {
					document: doc51,
				});
				expect(list51.data?.nodes).toEqual([]);
			} finally {
				await kernel.dispose();
			}
		}
		{
			const { ctx, store } = makeCtx();
			const docSeed51 = 'doc_seed_51';
			await store.put(documentContentKey(docSeed51), {
				format: 'violet-tree',
				version: 1,
				rev: 0,
				syncedRev: 0,
				seed: {
					files: [
						{
							name: 'base.tokens.json',
							content: JSON.stringify({
								$extensions: {
									'dev.lushly.violet': { type: 'product', constraints: makeRules(51) },
								},
								color: { $type: 'color', bg: { $value: '#ffffff' } },
							}),
						},
					],
				},
			});
			const failSeed51 = (await callHandler('violet-node-list', { document: docSeed51 }, ctx)) as {
				success: boolean;
				error?: { code: string };
			};
			expect(failSeed51.success).toBe(false);
			expect(failSeed51.error?.code).toBe('VALIDATION_ERROR');
		}

		// 4. Prototype-safe snapshot extraction for node id '__proto__' across cache clear + reload
		{
			const { ctx, store } = makeCtx();
			const docProto = 'doc_proto_node';
			const imported = (await callHandler(
				'violet-tree-import',
				{
					document: docProto,
					content: {
						files: [
							{
								name: 'proto.tokens.json',
								content: JSON.stringify({
									$extensions: {
										'dev.lushly.violet': {
											node: '__proto__',
											type: 'product',
											constraints: [
												{
													id: 'proto-rule',
													name: 'Proto rule',
													applyTo: 'color.*',
													config: { type: 'enum', values: ['#ffffff'] },
												},
											],
										},
									},
									color: { $type: 'color', bg: { $value: '#ffffff' } },
								}),
							},
						],
					},
				},
				ctx
			)) as { success: boolean; error?: unknown };
			expect(imported.success, JSON.stringify(imported.error)).toBe(true);

			// Simulate JSON round-trip persistence (as SQLite/IndexedDB stores do) + cache eviction
			const persisted = JSON.parse(JSON.stringify(store.map.get(documentContentKey(docProto))));
			store.map.set(documentContentKey(docProto), persisted);
			port.clearCache();

			const expProto = (await callHandler('violet-tree-export', { document: docProto }, ctx)) as {
				success: boolean;
				data?: { content: { files: Array<{ content: string }> } };
			};
			expect(expProto.success).toBe(true);
			const protoJson = JSON.parse(expProto.data?.content.files[0]?.content ?? '{}');
			expect(protoJson.$extensions['dev.lushly.violet'].constraints).toEqual([
				expect.objectContaining({ id: 'proto-rule' }),
			]);
		}
	});
});
