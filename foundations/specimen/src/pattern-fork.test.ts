import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSpecimenBench } from './bench.js';
import { listDesignCards, readCardRecord } from './cards.js';
import { recordDecision } from './decisions.js';
import { canonicalJson, checkPack, packCatalog, packDigest, readPackFiles } from './pack.js';
import { PACK_FORMAT_VERSION, type PackPattern, type PackRules } from './pack-schema.js';
import { digestPatternText } from './pattern-fork.js';
import type { PatternFile } from './pattern-types.js';
import { recordDesignRelease } from './releases.js';

const tempDirs: string[] = [];

async function makeWorkspace(prefix: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

const personOptions = {
	decidedBy: { kind: 'person' as const, id: 'alice', channel: 'mcp-relay' as const },
	humanConfirmed: true,
};

afterEach(async () => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) await rm(dir, { recursive: true, force: true });
	}
});

async function writeUpstreamPack(
	packDir: string,
	library: string,
	version: string,
	patterns: PatternFile[]
): Promise<void> {
	const encoder = new TextEncoder();
	const files = new Map<string, Uint8Array>();

	const rules: PackRules = { format: PACK_FORMAT_VERSION, library, rules: [] };
	const rulesPath = `rules/${library}.json`;
	const rulesJson = canonicalJson(rules);
	files.set(rulesPath, encoder.encode(rulesJson));
	await mkdir(join(packDir, 'rules'), { recursive: true });
	await writeFile(join(packDir, rulesPath), rulesJson);

	await mkdir(join(packDir, 'data', library, 'patterns'), { recursive: true });
	for (const p of patterns) {
		const record: PackPattern = {
			format: PACK_FORMAT_VERSION,
			pattern: p.pattern,
			...(p.summary ? { summary: p.summary } : {}),
			status: p.status ?? 'stable',
			...(p.approvalStatus ? { approvalStatus: p.approvalStatus } : {}),
			...(p.derivedFrom ? { derivedFrom: p.derivedFrom } : {}),
			...(p.waivedKeep ? { waivedKeep: p.waivedKeep } : {}),
			scope: p.scope,
			facets: p.facets ?? {},
			useWhen: p.useWhen ?? [],
			avoidWhen: p.avoidWhen ?? [],
			keep: p.keep ?? [],
			customize: p.customize ?? [],
			setups: p.setups ?? {},
			gates: p.gates ?? {},
			implementations: [],
		};
		const rel = `data/${library}/patterns/${p.pattern}.json`;
		const json = canonicalJson(record);
		files.set(rel, encoder.encode(json));
		await writeFile(join(packDir, rel), json);
	}

	const catalogJson = packCatalog(files, library, {
		title: `${library} pack`,
		package: { name: `@test/${library}`, version },
		prefix: 'x-',
	});
	await writeFile(join(packDir, 'data', library, 'library.json'), catalogJson);
}

describe('Phase B2 — copied patterns, waivers, and Pack Format 2 bindings', () => {
	it('satisfies Scenario 06: fork default pattern as proposed with pending binding, refuse overwrite, activate on approval, compile into Pack Format 2, and detect post-approval tampering', async () => {
		const root = await makeWorkspace('specimen-b2-s06-');
		await writeFile(
			join(root, 'package.json'),
			JSON.stringify({ name: '@bookshop/ui', version: '1.0.0' }, null, '\t')
		);
		await writeFile(
			join(root, 'commands.json'),
			JSON.stringify(
				{
					app: 'bookshop',
					localLibrary: 'bookshop-ui',
					commands: [{ name: 'order-create', errors: ['OUT_OF_STOCK'] }],
				},
				null,
				'\t'
			)
		);
		await writeFile(
			join(root, 'specimen.config.json'),
			JSON.stringify(
				{
					defaults: 'afd-defaults@1.0.0',
					commandManifest: './commands.json',
					patterns: ['specimens/patterns/*/pattern.json'],
					pack: {
						library: 'bookshop-ui',
						title: 'Bookshop UI',
						prefix: 'bk-',
						directory: './pack',
						package: './package.json',
						localElements: { tags: ['bk-alert'] },
					},
				},
				null,
				'\t'
			)
		);

		const bench = await createSpecimenBench({ root });
		try {
			// Step 1: unknown default pattern -> PATTERN_UNKNOWN with discovery suggestion
			await expect(
				bench.patternFork({ source: 'afd-defaults/nonexistent-pattern' })
			).rejects.toMatchObject({
				code: 'PATTERN_UNKNOWN',
				suggestion: expect.stringContaining('pattern'),
			});

			// Step 2: fork afd-defaults/error-recovery with bind: true -> proposed + pending-approval + guidance card
			const forked = await bench.patternFork({
				source: 'afd-defaults/error-recovery',
				target: 'error-recovery',
				bind: true,
			});
			expect(forked.pattern).toBe('error-recovery');
			expect(forked.path).toBe('specimens/patterns/error-recovery/pattern.json');
			expect(forked.approvalStatus).toBe('proposed');
			expect(forked.derivedFrom.library).toBe('afd-defaults');
			expect(forked.derivedFrom.pattern).toBe('error-recovery');
			expect(forked.derivedFrom.version).toBe('1.0.0');
			expect(Object.keys(forked.derivedFrom.statements).length).toBeGreaterThan(0);
			expect(forked.bindingStatus).toBe('pending-approval');
			expect(forked.card).toMatch(/^card-/);
			expect(forked.nextSteps[0]).toContain('decision-record');

			// Step 3: re-forking onto existing target -> ALREADY_EXISTS suggesting specimen-pattern-compare
			await expect(
				bench.patternFork({ source: 'afd-defaults/error-recovery', target: 'error-recovery' })
			).rejects.toMatchObject({
				code: 'ALREADY_EXISTS',
				suggestion: expect.stringContaining('specimen-pattern-compare'),
			});

			// Step 4: while still proposed, design-states continues resolving to approved afd-defaults/error-recovery,
			// while includeProposed: true previews the pending local copy and packExport omits unapproved bindings.
			const statesBefore = await bench.designStates({ commands: ['order-create'] });
			expect(statesBefore.states[0]).toMatchObject({
				pattern: 'afd-defaults/error-recovery',
				source: 'default',
				approvalStatus: 'approved',
			});
			const statesProposed = await bench.designStates({
				commands: ['order-create'],
				includeProposed: true,
			});
			expect(statesProposed.states[0]).toMatchObject({
				pattern: 'bookshop-ui/error-recovery',
				source: 'copied',
				approvalStatus: 'proposed',
			});
			await bench.pack();
			const proposedExportDir = join(root, 'exported-proposed');
			await bench.packExport({ directory: './exported-proposed' });
			const proposedCatalog = JSON.parse(
				await readFile(join(proposedExportDir, 'data', 'bookshop-ui', 'library.json'), 'utf8')
			) as { patternBindings?: Record<string, string> };
			expect(proposedCatalog.patternBindings).toBeUndefined();

			// Step 5: approving the fork card flips approvalStatus to 'approved' and activates patternBindings
			const dec = await bench.recordDecision(
				{
					card: forked.card,
					chosen: 'approve',
					reason: 'Use bookshop-ui kiosk error-recovery copy',
				},
				personOptions
			);
			expect('decision' in dec && dec.chosen === 'approve').toBe(true);

			const approvedFile = JSON.parse(
				await readFile(join(root, forked.path), 'utf8')
			) as PatternFile;
			expect(approvedFile.approvalStatus).toBe('approved');

			// Step 6: after approval, design-states resolves through patternBindings to bookshop-ui/error-recovery
			const statesAfter = await bench.designStates({ commands: ['order-create'] });
			expect(statesAfter.states[0]).toMatchObject({
				pattern: 'bookshop-ui/error-recovery',
				source: 'copied',
				approvalStatus: 'approved',
			});

			// Pack export compiles active approved patternBindings into Pack Format 2 library.json
			await bench.pack();
			const exportedDir = join(root, 'exported-pack');
			await bench.packExport({ directory: './exported-pack' });
			const exportedFiles = await readPackFiles(exportedDir);
			const check = checkPack(exportedFiles, { form: 'exported' });
			expect(check.valid).toBe(true);
			const catalog = JSON.parse(
				await readFile(join(exportedDir, 'data', 'bookshop-ui', 'library.json'), 'utf8')
			) as {
				patternBindings?: Record<string, string>;
				patterns: Array<{ pattern: string; approvalStatus?: string }>;
			};
			expect(catalog.patternBindings).toEqual({
				'afd-defaults/error-recovery': 'bookshop-ui/error-recovery',
			});
			expect(catalog.patterns[0]?.approvalStatus).toBe('approved');

			// Tampering with an approved copied pattern on disk fails specimen-validate with PATTERN_APPROVAL_MISMATCH
			approvedFile.summary = 'Tampered without person approval';
			await writeFile(join(root, forked.path), `${JSON.stringify(approvedFile, null, '\t')}\n`);
			const tamperedBench = await createSpecimenBench({ root });
			try {
				const report = tamperedBench.validate({ file: forked.path });
				expect(report.valid).toBe(false);
				expect(report.issues.some((i) => i.code === 'PATTERN_APPROVAL_MISMATCH')).toBe(true);
			} finally {
				await tamperedBench.close();
			}
		} finally {
			await bench.close();
		}
	});

	it('satisfies Scenario 07: compare all 7 statuses + bulk summary, refuse non-copied and unresolved conflicts, stage pinned merge with paired gates, refuse UPSTREAM_CHANGED, apply on approval', async () => {
		const root = await makeWorkspace('specimen-b2-s07-');
		const v1PackDir = join(root, 'packs', 'v1');
		const v11PackDir = join(root, 'packs', 'v11');

		const v1Pattern: PatternFile = {
			pattern: 'error-recovery',
			summary: 'Error recovery v1',
			status: 'stable',
			scope: 'composition',
			useWhen: [{ id: 'error-recovery.use.failure', text: 'When a command fails.' }],
			keep: [
				{ id: 'error-recovery.keep.local-edit', text: 'Original local edit target.' },
				{
					id: 'error-recovery.keep.clear-next-step',
					text: 'Original clear next step.',
					gate: 'shows-next',
				},
				{ id: 'error-recovery.keep.conflict-item', text: 'Original conflict item.' },
			],
			customize: [{ id: 'error-recovery.customize.tone', text: 'Keep tone calm.' }],
			setups: {
				'failed-state': {
					text: 'Mount an error state.',
					targets: { alert: { role: 'alert' } },
				},
			},
			gates: {
				'shows-next': {
					setup: 'failed-state',
					scenario: [{ id: 'check-alert', expect: { target: 'alert', a11y: { role: 'alert' } } }],
				},
			},
		};

		const v11Pattern: PatternFile = {
			...v1Pattern,
			summary: 'Error recovery v1.1',
			keep: [
				{ id: 'error-recovery.keep.local-edit', text: 'Original local edit target.' },
				{
					id: 'error-recovery.keep.clear-next-step',
					text: 'Updated upstream clear next step with recovery command.',
					gate: 'shows-next-v2',
				},
				{
					id: 'error-recovery.keep.conflict-item',
					text: 'Upstream conflict wording.',
				},
			],
			customize: [
				{ id: 'error-recovery.customize.tone', text: 'Keep tone calm.' },
				{ id: 'error-recovery.customize.extra-hint', text: 'Show optional retry timing hint.' },
			],
			setups: {
				...v1Pattern.setups,
				'failed-state-v2': {
					text: 'Mount error state with retry action.',
					targets: { alert: { role: 'alert' }, retry: { role: 'button', name: 'Retry' } },
				},
			},
			gates: {
				...v1Pattern.gates,
				'shows-next-v2': {
					setup: 'failed-state-v2',
					scenario: [{ id: 'check-retry', expect: { target: 'retry', a11y: { role: 'button' } } }],
				},
			},
		};

		await writeUpstreamPack(v1PackDir, 'afd-defaults', '1.0.0', [v1Pattern]);
		await writeUpstreamPack(v11PackDir, 'afd-defaults', '1.1.0', [v11Pattern]);

		// Create a native (non-copied) pattern
		await mkdir(join(root, 'specimens', 'patterns', 'bookshop-shelf-card'), { recursive: true });
		await writeFile(
			join(root, 'specimens', 'patterns', 'bookshop-shelf-card', 'pattern.json'),
			JSON.stringify(
				{
					pattern: 'bookshop-shelf-card',
					summary: 'Native shelf card',
					scope: 'composition',
					useWhen: [{ id: 'shelf-card.use.grid', text: 'Use on book grid.' }],
				},
				null,
				'\t'
			)
		);

		await writeFile(
			join(root, 'specimen.config.json'),
			JSON.stringify(
				{
					patternSources: ['./packs/v1'],
					patterns: ['specimens/patterns/*/pattern.json'],
					commandManifest: './commands.json',
				},
				null,
				'\t'
			)
		);
		await writeFile(join(root, 'commands.json'), JSON.stringify({ commands: ['order-create'] }));

		const bench = await createSpecimenBench({ root });
		try {
			// Fork from v1.0.0 and approve
			const forked = await bench.patternFork({
				source: 'afd-defaults/error-recovery',
				target: 'error-recovery',
			});
			await bench.recordDecision(
				{ card: forked.card, chosen: 'approve', reason: 'Approve initial v1.0.0 copy' },
				personOptions
			);

			// Customize two statements locally (one will be changed-here, one changed-both against v1.1.0)
			const localPath = join(root, forked.path);
			const localData = JSON.parse(await readFile(localPath, 'utf8')) as PatternFile;
			localData.keep = (localData.keep ?? []).map((item) => {
				if (item.id === 'error-recovery.keep.local-edit') {
					return { ...item, text: 'Customized locally for kiosk.' };
				}
				if (item.id === 'error-recovery.keep.conflict-item') {
					return { ...item, text: 'Local kiosk conflict wording.' };
				}
				return item;
			});
			await writeFile(localPath, `${JSON.stringify(localData, null, '\t')}\n`);

			// Point patternSources at v1.1.0 pack
			await writeFile(
				join(root, 'specimen.config.json'),
				JSON.stringify(
					{
						patternSources: ['./packs/v11'],
						patterns: ['specimens/patterns/*/pattern.json'],
						commandManifest: './commands.json',
					},
					null,
					'\t'
				)
			);

			// Step 1: comparing native non-copied pattern fails with NOT_A_COPIED_PATTERN
			await expect(bench.patternCompare({ pattern: 'bookshop-shelf-card' })).rejects.toMatchObject({
				code: 'NOT_A_COPIED_PATTERN',
				suggestion: expect.stringContaining('specimen-pattern-fork'),
			});

			// Step 2: comparing copied pattern classifies all changed statuses accurately
			const cmp = await bench.patternCompare({ pattern: 'error-recovery', onlyChanged: true });
			expect('statements' in cmp).toBe(true);
			if (!('statements' in cmp)) throw new Error('Expected single pattern compare result');
			expect(cmp.source).toEqual({
				library: 'afd-defaults',
				pattern: 'error-recovery',
				baseVersion: '1.0.0',
				currentVersion: '1.1.0',
			});
			expect(cmp.statements.map((s) => [s.id, s.status])).toEqual([
				['error-recovery.keep.local-edit', 'changed-here'],
				['error-recovery.keep.clear-next-step', 'changed-upstream'],
				['error-recovery.keep.conflict-item', 'changed-both'],
				['error-recovery.customize.extra-hint', 'added-upstream'],
			]);
			expect(cmp.nextSteps[0]).toContain('specimen-pattern-merge');

			// onlyChanged: false includes unchanged statements
			const cmpAll = await bench.patternCompare({ pattern: 'error-recovery', onlyChanged: false });
			expect(
				'statements' in cmpAll && cmpAll.statements.some((s) => s.status === 'unchanged')
			).toBe(true);

			// Bulk summary mode (pattern omitted) summarizes all copied patterns
			const bulk = await bench.patternCompare({});
			expect('patterns' in bulk).toBe(true);
			if ('patterns' in bulk) {
				expect(bulk.patterns).toHaveLength(1);
				expect(bulk.patterns[0]?.counts).toEqual({
					changedHere: 1,
					changedUpstream: 1,
					changedBoth: 1,
					droppedHere: 0,
					addedUpstream: 1,
					declined: 0,
				});
			}

			// Step 3: accepting changed-both without resolutions fails with STATEMENT_CONFLICT
			await expect(
				bench.patternMerge({
					pattern: 'error-recovery',
					upstreamVersion: '1.1.0',
					accept: ['error-recovery.keep.conflict-item'],
				})
			).rejects.toMatchObject({
				code: 'STATEMENT_CONFLICT',
				suggestion: expect.stringContaining('resolutions'),
			});

			// Declining an upstream keep without waivers fails with VALIDATION_ERROR
			await expect(
				bench.patternMerge({
					pattern: 'error-recovery',
					upstreamVersion: '1.1.0',
					decline: ['error-recovery.keep.clear-next-step'],
				})
			).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

			// Staging a first merge then a second merge supersedes the first card cleanly
			const firstMerge = await bench.patternMerge({
				pattern: 'error-recovery',
				upstreamVersion: '1.1.0',
				accept: ['error-recovery.keep.clear-next-step'],
			});

			// Step 4: stage chosen accepts, declines, and conflict resolution
			const merged = await bench.patternMerge({
				pattern: 'error-recovery',
				upstreamVersion: '1.1.0',
				accept: ['error-recovery.keep.clear-next-step', 'error-recovery.keep.conflict-item'],
				decline: ['error-recovery.customize.extra-hint'],
				resolutions: [
					{
						id: 'error-recovery.keep.conflict-item',
						text: 'Announce recovery clearly in the kiosk banner with the next action',
					},
				],
			});
			expect(merged.card).toMatch(/^card-/);
			expect(merged.upstreamVersion).toBe('1.1.0');
			expect(merged.stagedStatus).toBe('proposed');
			expect(merged.nextSteps[0]).toContain('decision-record');
			// Prior open merge card was withdrawn cleanly
			expect((await readCardRecord(root, firstMerge.card)).status).toBe('withdrawn');

			// Live pattern.json stays untouched before approval!
			const beforeApprove = JSON.parse(await readFile(localPath, 'utf8')) as PatternFile;
			expect(beforeApprove.derivedFrom?.version).toBe('1.0.0');

			// Step 5: mutating upstream before approval causes decision-record to fail with UPSTREAM_CHANGED
			const upstreamFile = join(
				v11PackDir,
				'data',
				'afd-defaults',
				'patterns',
				'error-recovery.json'
			);
			const savedUpstreamJson = await readFile(upstreamFile, 'utf8');
			const tamperedUpstream = JSON.parse(savedUpstreamJson) as PackPattern;
			tamperedUpstream.keep[1] = {
				...tamperedUpstream.keep[1],
				id: 'error-recovery.keep.clear-next-step',
				text: 'Upstream moved silently after staging!',
			};
			await writeFile(upstreamFile, canonicalJson(tamperedUpstream));
			await expect(
				recordDecision(
					root,
					{ card: merged.card, chosen: 'approve', reason: 'Approve stale merge' },
					personOptions
				)
			).rejects.toMatchObject({
				code: 'UPSTREAM_CHANGED',
				suggestion: expect.stringContaining('specimen-pattern-compare'),
			});

			// Restore upstream and approve pinned merge card (Step 6)
			await writeFile(upstreamFile, savedUpstreamJson);
			const approvedMerge = await bench.recordDecision(
				{
					card: merged.card,
					chosen: 'approve',
					reason: 'Adopt upstream clear-next-step improvement',
				},
				personOptions
			);
			expect('decision' in approvedMerge && approvedMerge.chosen === 'approve').toBe(true);

			// Live pattern now has merged text, paired gate & setup, refreshed derivedFrom, and declined digest
			const afterApprove = JSON.parse(await readFile(localPath, 'utf8')) as PatternFile;
			expect(afterApprove.approvalStatus).toBe('approved');
			expect(afterApprove.derivedFrom?.version).toBe('1.1.0');
			expect(afterApprove.derivedFrom?.declined?.['error-recovery.customize.extra-hint']).toMatch(
				/^sha256:/
			);
			expect(afterApprove.gates?.['shows-next-v2']).toBeDefined();
			expect(afterApprove.setups?.['failed-state-v2']).toBeDefined();
			expect(
				afterApprove.keep?.find((k) => k.id === 'error-recovery.keep.conflict-item')?.text
			).toBe('Announce recovery clearly in the kiosk banner with the next action');

			// Re-comparing classifies the declined non-keep statement as 'declined'
			const cmpAfter = await bench.patternCompare({ pattern: 'error-recovery', onlyChanged: true });
			if (!('statements' in cmpAfter)) throw new Error('Expected single pattern compare result');
			const declinedEntry = cmpAfter.statements.find(
				(s) => s.id === 'error-recovery.customize.extra-hint'
			);
			expect(declinedEntry?.status).toBe('declined');
		} finally {
			await bench.close();
		}
	});

	it('satisfies Scenario 11: dropped keep fails specimen-validate with WAIVER_REASON_REQUIRED, passes once waived, stays visible in compare and design-card-list, and blocks release until decided', async () => {
		const root = await makeWorkspace('specimen-b2-s11-');
		const keepText = 'Focus returns to the invoking trigger after dismissing the alert.';
		const keepDigest = digestPatternText(keepText);
		const useText = 'Use when a command fails.';
		const useDigest = digestPatternText(useText);

		const upstreamPack = join(root, 'packs', 'defaults');
		await writeUpstreamPack(upstreamPack, 'afd-defaults', '1.0.0', [
			{
				pattern: 'error-recovery',
				summary: 'Error recovery',
				scope: 'composition',
				useWhen: [{ id: 'error-recovery.use.failure', text: useText }],
				keep: [{ id: 'error-recovery.keep.focus-returns', text: keepText }],
			},
		]);

		const revision = `sha256:${createHash('sha256').update('rev-1').digest('hex')}`;
		const baseDerived = {
			library: 'afd-defaults',
			pattern: 'error-recovery',
			version: '1.0.0',
			revision,
			statements: {
				'error-recovery.use.failure': useDigest,
				'error-recovery.keep.focus-returns': keepDigest,
			},
		};

		// Unwaived dropped keep
		await mkdir(join(root, 'specimens', 'patterns', 'error-recovery-unwaived'), {
			recursive: true,
		});
		await writeFile(
			join(root, 'specimens', 'patterns', 'error-recovery-unwaived', 'pattern.json'),
			JSON.stringify(
				{
					pattern: 'error-recovery-unwaived',
					summary: 'Dropped keep without waiver',
					scope: 'composition',
					derivedFrom: baseDerived,
					useWhen: [{ id: 'error-recovery-unwaived.use.failure', text: useText }],
					keep: [],
				},
				null,
				'\t'
			)
		);

		// Waived dropped keep
		await mkdir(join(root, 'specimens', 'patterns', 'error-recovery'), { recursive: true });
		await writeFile(
			join(root, 'specimens', 'patterns', 'error-recovery', 'pattern.json'),
			JSON.stringify(
				{
					pattern: 'error-recovery',
					summary: 'Dropped keep with waiver',
					scope: 'composition',
					derivedFrom: baseDerived,
					waivedKeep: [
						{
							id: 'error-recovery.keep.focus-returns',
							reason: 'Touch-only kiosk has no persistent focus ring to restore.',
						},
					],
					useWhen: [{ id: 'error-recovery.use.failure', text: useText }],
					keep: [],
				},
				null,
				'\t'
			)
		);

		await writeFile(
			join(root, 'specimen.config.json'),
			JSON.stringify(
				{
					patternSources: ['./packs/defaults'],
					patterns: ['specimens/patterns/*/pattern.json'],
					commandManifest: './commands.json',
				},
				null,
				'\t'
			)
		);
		await writeFile(join(root, 'commands.json'), JSON.stringify({ commands: ['order-create'] }));

		const bench = await createSpecimenBench({ root });
		try {
			// Step 1: unwaived dropped keep fails specimen-validate with WAIVER_REASON_REQUIRED
			const invalidReport = bench.validate({
				file: 'specimens/patterns/error-recovery-unwaived/pattern.json',
			});
			expect(invalidReport.valid).toBe(false);
			expect(invalidReport.issues[0]).toMatchObject({
				severity: 'error',
				code: 'WAIVER_REASON_REQUIRED',
				suggestion: expect.stringContaining('waivedKeep'),
			});

			// Step 2: waived dropped keep passes specimen-validate
			const validReport = bench.validate({
				file: 'specimens/patterns/error-recovery/pattern.json',
			});
			expect(validReport.valid).toBe(true);

			// Step 3: specimen-pattern-compare reports dropped-here and waiverReason + waivers
			const cmp = await bench.patternCompare({ pattern: 'error-recovery' });
			expect('statements' in cmp).toBe(true);
			if (!('statements' in cmp)) throw new Error('Expected single pattern compare result');
			expect(cmp.statements[0]).toMatchObject({
				id: 'error-recovery.keep.focus-returns',
				status: 'dropped-here',
				waiverReason: expect.stringContaining('kiosk'),
			});
			expect(cmp.waivers[0]).toEqual({
				id: 'error-recovery.keep.focus-returns',
				reason: expect.stringContaining('kiosk'),
			});

			// Step 4: design-card-list (scope: guidance) surfaces open keep-waiver card (pure read: no specimens/cards created)
			expect(existsSync(join(root, 'specimens', 'cards'))).toBe(false);
			const cards = await listDesignCards(root, { scope: 'guidance' });
			expect(existsSync(join(root, 'specimens', 'cards'))).toBe(false);
			expect(cards.cards.length).toBeGreaterThanOrEqual(1);
			const waiverCard = cards.cards[0];
			expect(waiverCard?.why.trigger).toBe('keep-waiver');
			expect(waiverCard?.status).toBe('open');

			// Person approving the keep-waiver card persists it and unblocks design-release
			const dec = await recordDecision(
				root,
				{
					card: waiverCard?.card,
					chosen: 'approve',
					reason: 'Accepted kiosk waiver for touch-only display.',
				},
				personOptions
			);
			const decId = 'decision' in dec ? dec.decision : '';
			const afterCards = await listDesignCards(root, { scope: 'guidance' });
			expect(afterCards.cards).toHaveLength(0);
			const rel = await recordDesignRelease(
				root,
				{ release: '1.0.0', decisions: [decId] },
				personOptions
			);
			expect(rel.release).toBe('1.0.0');

			// Changing the waiver reason after approval immediately opens a fresh review card
			const waivedFile = JSON.parse(
				await readFile(
					join(root, 'specimens', 'patterns', 'error-recovery', 'pattern.json'),
					'utf8'
				)
			) as PatternFile;
			waivedFile.waivedKeep = [
				{
					id: 'error-recovery.keep.focus-returns',
					reason: 'Changed rationale that has not been approved yet.',
				},
			];
			await writeFile(
				join(root, 'specimens', 'patterns', 'error-recovery', 'pattern.json'),
				`${JSON.stringify(waivedFile, null, '\t')}\n`
			);
			const reopenedCards = await listDesignCards(root, { scope: 'guidance' });
			expect(reopenedCards.cards).toHaveLength(1);
			expect(reopenedCards.cards[0]?.card).not.toBe(waiverCard?.card);
			expect(reopenedCards.cards[0]?.status).toBe('open');
		} finally {
			await bench.close();
		}
	});

	it('validates Pack Format 2 approvalStatus, derivedFrom, duplicate waivedKeep, and patternBindings in checkPack', () => {
		const encoder = new TextEncoder();
		const rules = canonicalJson({ format: 2, library: 'demo', rules: [] });
		const pat: PackPattern = {
			format: 2,
			pattern: 'error-recovery',
			summary: 'Error recovery',
			status: 'stable',
			approvalStatus: 'proposed',
			derivedFrom: {
				library: 'afd-defaults',
				pattern: 'error-recovery',
				version: '1.0.0',
				revision: packDigest('seed'),
				statements: { 'error-recovery.keep.next': packDigest('next') },
				declined: { 'error-recovery.customize.hint': packDigest('hint') },
			},
			waivedKeep: [{ id: 'error-recovery.keep.focus', reason: 'Kiosk touch display' }],
			scope: 'composition',
			facets: { purpose: ['feedback'] },
			useWhen: [],
			avoidWhen: [],
			keep: [
				{ id: 'error-recovery.keep.next', text: 'Provide next step.', approvalStatus: 'approved' },
			],
			customize: [],
			setups: {},
			gates: {},
			implementations: [],
		};
		const patJson = canonicalJson(pat);
		const committed = new Map<string, Uint8Array>([
			['rules/demo.json', encoder.encode(rules)],
			['data/demo/patterns/error-recovery.json', encoder.encode(patJson)],
		]);
		expect(checkPack(committed, { form: 'committed' }).valid).toBe(true);

		// Exported catalog carries approvalStatus & patternBindings cleanly
		const catalog = packCatalog(committed, 'demo', {
			title: 'Demo',
			package: { name: '@demo/ui', version: '1.0.0' },
			prefix: 'dm-',
			patternBindings: { 'afd-defaults/error-recovery': 'demo/error-recovery' },
		});
		const exported = new Map(committed);
		exported.set('data/demo/library.json', encoder.encode(catalog));
		expect(checkPack(exported, { form: 'exported' }).valid).toBe(true);

		// Drifting approvalStatus in catalog triggers CATALOG_MISMATCH
		const driftedCatalog = JSON.parse(catalog) as {
			patterns: Array<{ approvalStatus?: string }>;
		};
		if (driftedCatalog.patterns[0]) driftedCatalog.patterns[0].approvalStatus = 'approved';
		exported.set('data/demo/library.json', encoder.encode(canonicalJson(driftedCatalog)));
		const driftCheck = checkPack(exported, { form: 'exported' });
		expect(driftCheck.valid).toBe(false);
		expect(driftCheck.problems.some((p) => p.code === 'CATALOG_MISMATCH')).toBe(true);

		// Duplicate waivedKeep id triggers DUPLICATE_ID
		const dupPat: PackPattern = {
			...pat,
			waivedKeep: [
				{ id: 'error-recovery.keep.focus', reason: 'First' },
				{ id: 'error-recovery.keep.focus', reason: 'Duplicate' },
			],
		};
		const dupCommitted = new Map<string, Uint8Array>([
			['rules/demo.json', encoder.encode(rules)],
			['data/demo/patterns/error-recovery.json', encoder.encode(canonicalJson(dupPat))],
		]);
		const dupCheck = checkPack(dupCommitted, { form: 'committed' });
		expect(dupCheck.valid).toBe(false);
		expect(dupCheck.problems.some((p) => p.code === 'DUPLICATE_ID')).toBe(true);

		// Pack Format 1 isolation: format-1 catalog omits patternBindings
		const rulesV1 = canonicalJson({ format: 1, library: 'legacy', rules: [] });
		const v1Files = new Map<string, Uint8Array>([['rules/legacy.json', encoder.encode(rulesV1)]]);
		const v1Catalog = JSON.parse(
			packCatalog(v1Files, 'legacy', {
				title: 'Legacy',
				package: { name: '@demo/legacy', version: '1.0.0' },
				prefix: 'lg-',
				patternBindings: { 'afd-defaults/error-recovery': 'legacy/error-recovery' },
			})
		) as { format: number; patternBindings?: unknown };
		expect(v1Catalog.format).toBe(1);
		expect(v1Catalog.patternBindings).toBeUndefined();
	});

	it('enforces approval fail-closed, local merge drift, shared gate/setup conflicts, keep-waiver merge dedup, external patternSources, and symlink confinement', async () => {
		const root = await makeWorkspace('specimen-b2-hardening-');
		const externalPackParent = await mkdtemp(join(tmpdir(), 'specimen-b2-extpack-'));
		tempDirs.push(externalPackParent);
		const externalPackDir = join(externalPackParent, 'pack-ext');
		const setupDef = {
			text: 'Failed submission state',
			targets: {
				alert: { role: 'alert' as const },
				status: { role: 'status' as const },
			},
		};
		const gateDefA = {
			setup: 'shared-setup',
			scenario: [{ id: 'shows-alert', expect: { target: 'alert', focus: true } }],
		};
		const gateDefB = {
			setup: 'shared-setup',
			scenario: [{ id: 'shows-status', expect: { target: 'status', focus: true } }],
		};
		await writeUpstreamPack(externalPackDir, 'acme-defaults', '1.0.0', [
			{
				pattern: 'shared-gates',
				summary: 'Shared gates v1',
				scope: 'composition',
				useWhen: [{ id: 'shared.use.first', text: 'Use on failure.' }],
				keep: [
					{ id: 'shared.must-stay-one', text: 'Keep one.', gate: 'shared-gate' },
					{ id: 'shared.must-stay-two', text: 'Keep two.', gate: 'shared-gate' },
					{ id: 'shared.must-stay-three', text: 'Keep three.' },
				],
				setups: { 'shared-setup': setupDef },
				gates: { 'shared-gate': gateDefA },
			},
		]);

		await writeFile(
			join(root, 'specimen.config.json'),
			JSON.stringify(
				{
					patternSources: [externalPackDir],
					patterns: ['specimens/patterns/*/pattern.json'],
					commandManifest: './commands.json',
					pack: {
						library: 'acme-app',
						title: 'Acme',
						prefix: 'ac-',
						directory: './pack',
						package: './package.json',
						dependencies: ['acme-defaults'],
					},
				},
				null,
				'\t'
			)
		);
		await writeFile(
			join(root, 'package.json'),
			JSON.stringify({ name: '@acme/app', version: '1.0.0' })
		);
		await writeFile(join(root, 'commands.json'), JSON.stringify({ commands: ['item-save'] }));

		const bench = await createSpecimenBench({ root });
		try {
			// Fork with bind: true from external pack outside workspace root, then reject -> cleans up pending binding
			const tempFork = await bench.patternFork({
				source: 'acme-defaults/shared-gates',
				target: 'temp-copy',
				bind: true,
			});
			const cfgPending = JSON.parse(await readFile(join(root, 'specimen.config.json'), 'utf8')) as {
				patternBindings?: Record<string, string>;
			};
			expect(cfgPending.patternBindings?.['acme-defaults/shared-gates']).toBe('acme-app/temp-copy');

			await bench.recordDecision(
				{
					card: tempFork.card,
					chosen: 'reject',
					refusalScope: 'not-a-priority',
					reason: 'Drop experimental fork.',
				},
				personOptions
			);
			const cfgAfterReject = JSON.parse(
				await readFile(join(root, 'specimen.config.json'), 'utf8')
			) as { patternBindings?: Record<string, string> };
			expect(cfgAfterReject.patternBindings).toBeUndefined();

			// Forging approvalStatus: 'approved' on a copied pattern with no approval decision fails PATTERN_APPROVAL_MISMATCH,
			// and dropping a non-'.keep.' derived keep statement without waiver fails WAIVER_REASON_REQUIRED.
			const forgedPath = join(root, 'specimens', 'patterns', 'temp-copy', 'pattern.json');
			const forged = JSON.parse(await readFile(forgedPath, 'utf8')) as PatternFile;
			forged.approvalStatus = 'approved';
			forged.keep = (forged.keep ?? []).filter((k) => k.id !== 'shared.must-stay-three');
			await writeFile(forgedPath, `${JSON.stringify(forged, null, '\t')}\n`);
			const forgedBench = await createSpecimenBench({ root });
			try {
				const rep = forgedBench.validate({ file: 'specimens/patterns/temp-copy/pattern.json' });
				expect(rep.valid).toBe(false);
				expect(rep.issues.some((i) => i.code === 'PATTERN_APPROVAL_MISMATCH')).toBe(true);
				expect(rep.issues.some((i) => i.code === 'WAIVER_REASON_REQUIRED')).toBe(true);
			} finally {
				await forgedBench.close();
			}
			await rm(join(root, 'specimens', 'patterns', 'temp-copy'), { recursive: true, force: true });

			// Fork & approve clean copy from external pack outside root
			const forked = await bench.patternFork({
				source: 'acme-defaults/shared-gates',
				target: 'shared-gates',
				bind: false,
			});
			await bench.recordDecision(
				{ card: forked.card, chosen: 'approve', reason: 'Approve clean copy.' },
				personOptions
			);

			// Bump external pack to 1.1.0 with modified shared-gate, modified useWhen, and new keep statement
			await writeUpstreamPack(externalPackDir, 'acme-defaults', '1.1.0', [
				{
					pattern: 'shared-gates',
					summary: 'Shared gates v1.1',
					scope: 'composition',
					useWhen: [{ id: 'shared.use.first', text: 'Use on failure (updated upstream).' }],
					keep: [
						{ id: 'shared.must-stay-one', text: 'Keep one updated.', gate: 'shared-gate' },
						{ id: 'shared.must-stay-two', text: 'Keep two.', gate: 'shared-gate' },
						{ id: 'shared.must-stay-three', text: 'Keep three.' },
						{ id: 'shared.must-stay-four', text: 'Keep four new.' },
					],
					setups: { 'shared-setup': setupDef },
					gates: { 'shared-gate': gateDefB },
				},
			]);

			// Shared gate conflict: accepting only shared.must-stay-one would silently overwrite shared-gate used by untouched shared.must-stay-two
			await expect(
				bench.patternMerge({
					pattern: 'shared-gates',
					accept: ['shared.must-stay-one'],
				})
			).rejects.toMatchObject({ code: 'STATEMENT_CONFLICT' });

			// Decline changed-upstream non-keep + decline new keep with waiver, stage merge from external pack
			const stagedMerge = await bench.patternMerge({
				pattern: 'shared-gates',
				decline: ['shared.use.first', 'shared.must-stay-four'],
				waivers: [{ id: 'shared.must-stay-four', reason: 'Not applicable to acme-app.' }],
			});

			// Concurrent local edit after staging -> STALE_CARD (never silently overwrites local edits)
			const localPath = join(root, 'specimens', 'patterns', 'shared-gates', 'pattern.json');
			const origLocalText = await readFile(localPath, 'utf8');
			const editedLocal = JSON.parse(origLocalText) as PatternFile;
			editedLocal.summary = 'Concurrent local edit';
			await writeFile(localPath, `${JSON.stringify(editedLocal, null, '\t')}\n`);
			await expect(
				bench.recordDecision(
					{ card: stagedMerge.card, chosen: 'approve', reason: 'Should fail on local drift.' },
					personOptions
				)
			).rejects.toMatchObject({ code: 'STALE_CARD' });

			// Restore local file; upstream adding a gate to previously ungated keep -> UPSTREAM_CHANGED
			await writeFile(localPath, origLocalText);
			await writeUpstreamPack(externalPackDir, 'acme-defaults', '1.1.0', [
				{
					pattern: 'shared-gates',
					summary: 'Shared gates v1.1',
					scope: 'composition',
					useWhen: [{ id: 'shared.use.first', text: 'Use on failure (updated upstream).' }],
					keep: [
						{ id: 'shared.must-stay-one', text: 'Keep one updated.', gate: 'shared-gate' },
						{ id: 'shared.must-stay-two', text: 'Keep two.', gate: 'shared-gate' },
						{ id: 'shared.must-stay-three', text: 'Keep three.', gate: 'shared-gate' },
						{ id: 'shared.must-stay-four', text: 'Keep four new.' },
					],
					setups: { 'shared-setup': setupDef },
					gates: { 'shared-gate': gateDefB },
				},
			]);
			await expect(
				bench.recordDecision(
					{
						card: stagedMerge.card,
						chosen: 'approve',
						reason: 'Should fail on newly added upstream gate.',
					},
					personOptions
				)
			).rejects.toMatchObject({ code: 'UPSTREAM_CHANGED' });

			// Restore pinned 1.1.0 external pack -> approval succeeds across external patternSources,
			// does NOT resurrect a duplicate open virtual keep-waiver card, and declined changed-upstream classifies 'declined'.
			await writeUpstreamPack(externalPackDir, 'acme-defaults', '1.1.0', [
				{
					pattern: 'shared-gates',
					summary: 'Shared gates v1.1',
					scope: 'composition',
					useWhen: [{ id: 'shared.use.first', text: 'Use on failure (updated upstream).' }],
					keep: [
						{ id: 'shared.must-stay-one', text: 'Keep one updated.', gate: 'shared-gate' },
						{ id: 'shared.must-stay-two', text: 'Keep two.', gate: 'shared-gate' },
						{ id: 'shared.must-stay-three', text: 'Keep three.' },
						{ id: 'shared.must-stay-four', text: 'Keep four new.' },
					],
					setups: { 'shared-setup': setupDef },
					gates: { 'shared-gate': gateDefB },
				},
			]);
			const approvedMerge = await bench.recordDecision(
				{ card: stagedMerge.card, chosen: 'approve', reason: 'Approve external merge + waiver.' },
				personOptions
			);
			const mergeDecId = 'decision' in approvedMerge ? approvedMerge.decision : '';
			const openAfterMerge = await listDesignCards(root, { scope: 'guidance' });
			expect(openAfterMerge.cards).toHaveLength(0);
			const relAfterMerge = await recordDesignRelease(
				root,
				{ release: '1.1.0', decisions: [mergeDecId] },
				personOptions
			);
			expect(relAfterMerge.release).toBe('1.1.0');

			const cmpDeclined = await bench.patternCompare({
				pattern: 'shared-gates',
				onlyChanged: true,
			});
			if (!('statements' in cmpDeclined)) throw new Error('Expected single compare result');
			expect(cmpDeclined.statements.find((s) => s.id === 'shared.use.first')?.status).toBe(
				'declined'
			);
		} finally {
			await bench.close();
		}

		// Symlink escape test: specimens/patterns symlinked outside workspace must be refused by patternCompare
		const escapeRoot = await makeWorkspace('specimen-b2-symlink-');
		const outsideDir = await mkdtemp(join(tmpdir(), 'specimen-b2-outside-'));
		tempDirs.push(outsideDir);
		await mkdir(join(outsideDir, 'escaped'), { recursive: true });
		await writeFile(
			join(outsideDir, 'escaped', 'pattern.json'),
			JSON.stringify({ pattern: 'escaped', scope: 'composition' })
		);
		await mkdir(join(escapeRoot, 'specimens'), { recursive: true });
		await symlink(outsideDir, join(escapeRoot, 'specimens', 'patterns'));
		await writeFile(
			join(escapeRoot, 'specimen.config.json'),
			JSON.stringify({ commandManifest: './commands.json' })
		);
		await writeFile(join(escapeRoot, 'commands.json'), JSON.stringify({ commands: ['a-b'] }));
		const escapeBench = await createSpecimenBench({ root: escapeRoot });
		try {
			await expect(escapeBench.patternCompare({ pattern: 'escaped' })).rejects.toThrow(
				/escapes workspace root/
			);
		} finally {
			await escapeBench.close();
		}
	});
});
