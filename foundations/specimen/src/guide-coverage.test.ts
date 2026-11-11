import { describe, expect, it } from 'vitest';
import type { LoadedConfig } from './config.js';
import { type CoverageCase, computeCoverage } from './coverage.js';
import { runCoverage } from './coverage-run.js';
import { computeGuideCoverage, GUIDE_OBLIGATIONS } from './guide-coverage.js';
import type { LoadedGuides } from './guides.js';
import type { ComponentSchema } from './plugin.js';
import type { ClaimRecord, ExpectationRecord, Observation } from './types.js';

const schema = (tag: string, attributes: string[] = []): ComponentSchema =>
	({
		tag,
		sources: ['manifest'],
		properties: [],
		attributes: attributes.map((name) => ({ name })),
		slots: [],
		events: [],
		cssProperties: [],
		commands: [],
		unknown: [],
	}) as unknown as ComponentSchema;

const schemas = [schema('x-button', ['disabled']), schema('x-link'), schema('x-card')];

const guides: LoadedGuides = {
	files: ['./button.guide.json', './rules.guide.json'],
	components: [
		{
			file: './button.guide.json',
			tag: 'x-button',
			usage: [{ id: 'button.when', text: 'Use for an action.' }],
			a11y: [{ id: 'button.name', text: 'It needs a name.' }],
		},
	],
	rules: [
		{
			file: './rules.guide.json',
			index: 0,
			id: 'actions.disabled',
			text: 'A disabled control is skipped.',
			appliesTo: { attributes: ['disabled'] },
		},
		{
			file: './rules.guide.json',
			index: 1,
			id: 'actions.one-primary',
			text: 'Keep to one main action.',
			appliesTo: { tags: ['x-link'] },
		},
	],
	problems: [],
};

type Claim = Partial<ClaimRecord> & Pick<ClaimRecord, 'obligation'>;

function capture(
	id: string,
	claims: Claim[],
	expectations: ExpectationRecord[] = [],
	elements = [{ tag: 'x-button', ref: 'root/x-button:1' }]
): CoverageCase {
	const observation = {
		manifest: { checkpoint: { name: 'after-run' } },
		channels: {
			elements: elements.map((element) => ({ ...element, attributes: {}, state: {} })),
			events: { history: [] },
			evidence: {
				expectations,
				claims: claims.map((claim) => ({
					target: 'x-button',
					ref: 'root/x-button:1',
					checkpoint: 'after-run',
					expectations: ['said'],
					source: 'play',
					...claim,
				})),
				commands: [],
				formData: [],
				validity: [],
				attributesSet: [],
			},
		},
	} as unknown as Observation;
	return { id, observation };
}
const played: ExpectationRecord = { id: 'said', kind: 'play', target: 'x-button' };

describe('guides@1', () => {
	it('verifies a statement only through a claim whose check ran, and counts the rest as authored', () => {
		const report = computeGuideCoverage(guides, schemas, [
			capture('one', [{ obligation: 'guide:button.name', checked: true }], [played]),
		]);
		expect(report.obligations).toBe(GUIDE_OBLIGATIONS);
		expect(report.statements.map(({ id, level }) => [id, level])).toEqual([
			['guide:button.when', 'authored'],
			['guide:button.name', 'verified'],
			['guide:actions.disabled', 'authored'],
			['guide:actions.one-primary', 'authored'],
		]);
		expect(report.statements[1]).toMatchObject({
			kind: 'a11y',
			tag: 'x-button',
			file: './button.guide.json',
			evidence: [
				{
					specimen: 'one',
					checkpoint: 'after-run',
					target: 'root/x-button:1',
					expectations: ['said'],
				},
			],
			evidenceCount: 1,
		});
		expect(report.counts).toEqual({ verified: 1, authored: 3 });
		expect(report.invalidClaims).toEqual([]);
		expect(report.complete).toBe(false);
	});

	it('is complete when every statement is verified and no guide claim is invalid', () => {
		const cases = [
			capture(
				'all',
				[
					{ obligation: 'guide:button.when', checked: true },
					{ obligation: 'guide:button.name', checked: true },
					// A rule reaches a component through an attribute it has.
					{ obligation: 'guide:actions.disabled', checked: true },
					{
						obligation: 'guide:actions.one-primary',
						checked: true,
						target: 'x-link',
						ref: 'root/x-link:1',
					},
				],
				[played],
				[
					{ tag: 'x-button', ref: 'root/x-button:1' },
					{ tag: 'x-link', ref: 'root/x-link:1' },
				]
			),
		];
		const report = computeGuideCoverage(guides, schemas, cases);
		expect(report.counts).toEqual({ verified: 4, authored: 0 });
		expect(report.complete).toBe(true);
		// With nothing to verify, there is nothing complete.
		expect(computeGuideCoverage(undefined, schemas, []).complete).toBe(false);
	});

	it.each([
		[
			{ obligation: 'guide:button.name' },
			'A story’s guide claim needs its check: pass it to claim(), which runs it.',
		],
		[{ obligation: 'guide:button.name', checked: false }, 'needs its check'],
		[{ obligation: 'guide:button.nope', checked: true }, "No guide states 'button.nope'."],
		[
			{ obligation: 'guide:actions.one-primary', checked: true },
			"'actions.one-primary' is about <x-link>, not <x-button>.",
		],
		[
			{ obligation: 'guide:button.name', checked: true, ref: null },
			"'x-button' did not resolve to an element in the capture.",
		],
		[
			{ obligation: 'guide:button.name', source: 'declared', expectations: ['later'] },
			'Expectations did not run: later.',
		],
		[
			{ obligation: 'guide:button.name', source: 'declared', expectations: ['other'] },
			"No expectation it names is about 'x-button'.",
		],
	] as [Claim, string][])('reports %j as an invalid claim, in guides@1 only', (claim, reason) => {
		const other: ExpectationRecord = { id: 'other', kind: 'state', target: 'elsewhere' };
		const cases = [capture('bad', [claim], [played, other])];
		const report = computeGuideCoverage(guides, schemas, cases);
		expect(report.invalidClaims).toEqual([
			{
				specimen: 'bad',
				target: claim.target ?? 'x-button',
				obligation: claim.obligation,
				reason: expect.stringContaining(reason),
			},
		]);
		expect(report.counts.verified).toBe(0);
		expect(report.complete).toBe(false);
		// The other set neither sees nor counts it.
		expect(computeCoverage(schemas, cases).invalidClaims).toEqual([]);
	});

	it('takes a native specimen’s declared claim, whose expect steps are its check', () => {
		const held: ExpectationRecord = { id: 'named', kind: 'state', target: 'x-button' };
		const report = computeGuideCoverage(guides, schemas, [
			capture(
				'native',
				[{ obligation: 'guide:button.name', source: 'declared', expectations: ['named'] }],
				[held]
			),
		]);
		expect(report.statements.find((item) => item.id === 'guide:button.name')?.level).toBe(
			'verified'
		);
	});

	it('narrows to one component: the statements about it, and claims on it', () => {
		const cases = [
			capture(
				'mixed',
				[
					{ obligation: 'guide:button.nope', checked: true },
					{ obligation: 'guide:nope.here', checked: true, target: 'x-link', ref: 'root/x-link:1' },
				],
				[played],
				[
					{ tag: 'x-button', ref: 'root/x-button:1' },
					{ tag: 'x-link', ref: 'root/x-link:1' },
				]
			),
		];
		const link = computeGuideCoverage(guides, schemas, cases, 'x-link');
		expect(link.statements.map((item) => item.id)).toEqual(['guide:actions.one-primary']);
		expect(link.invalidClaims.map((item) => item.obligation)).toEqual(['guide:nope.here']);
		const card = computeGuideCoverage(guides, schemas, cases, 'x-card');
		expect(card.statements).toEqual([]);
		expect(card.complete).toBe(false);
	});

	it('keeps the first of two statements with one id, as specimen-validate reports the second', () => {
		const twice: LoadedGuides = {
			...guides,
			rules: guides.rules
				.slice(1)
				.map((rule) => ({ ...rule, id: 'button.when', file: './again.guide.json' })),
		};
		const report = computeGuideCoverage(twice, schemas, []);
		expect(report.statements.filter((item) => item.id === 'guide:button.when')).toEqual([
			expect.objectContaining({ file: './button.guide.json', kind: 'usage' }),
		]);
	});

	it('leaves every schema-partitions@1 result as it was when a case claims a statement', () => {
		const plain = capture('same', [], [played]);
		const guided = capture(
			'same',
			[{ obligation: 'guide:button.name', checked: true }, { obligation: 'guide:button.nope' }],
			[played]
		);
		expect(computeCoverage(schemas, [guided])).toEqual(computeCoverage(schemas, [plain]));
	});

	it('takes a capture only a guide claim needs for guides@1 alone, never for the partitions', async () => {
		const at = (checkpoint: string, claims: Claim[]) => {
			const { observation } = capture('native', claims, [
				{ id: 'named', kind: 'state', target: 'x-button' },
			]);
			return {
				...observation,
				manifest: { checkpoint: { name: checkpoint } },
			} as unknown as Observation;
		};
		const run = async (claims: Claim[]) => {
			const rendered: string[] = [];
			const config = {
				root: '/',
				config: {},
				entries: [{ id: 'native', module: './a.js', title: 'A', exportName: 'A' }],
				schemas: Object.fromEntries(schemas.map((item) => [item.tag, item])),
				guides,
			} as unknown as LoadedConfig;
			const report = await runCoverage(
				{
					config,
					prepare: async () => {},
					inspect: async () => null,
					runStory: async () => {
						throw new Error('No stories here.');
					},
					render: async (_id, checkpoint) => {
						rendered.push(checkpoint);
						return at(checkpoint, claims);
					},
				},
				{ workers: 1 }
			);
			return { rendered, report };
		};
		const declared = { source: 'declared' as const, expectations: ['named'] };
		const guided = await run([
			{ obligation: 'guide:button.name', checkpoint: 'before', ...declared },
		]);
		const plain = await run([]);
		expect(guided.rendered).toEqual(['after-run', 'before']);
		expect(plain.rendered).toEqual(['after-run']);
		const partitions = ({ guides: _, elapsedMs: __, ...rest }: typeof guided.report) => rest;
		expect(partitions(guided.report)).toEqual(partitions(plain.report));
		expect(
			guided.report.guides?.statements.find((item) => item.id === 'guide:button.name')
		).toMatchObject({ level: 'verified', evidence: [{ checkpoint: 'before' }] });
		// A partition claim at the same checkpoint still takes it, once, for both sets.
		const both = await run([
			{ obligation: 'guide:button.name', checkpoint: 'before', ...declared },
			{ obligation: 'default', checkpoint: 'before', ...declared },
		]);
		expect(both.rendered).toEqual(['after-run', 'before']);
	});
});
