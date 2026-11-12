// Step 0.6 of the Ideas plan: do Violet's hierarchy engine and command layer, as they are on
// main, fit ideas in place of design tokens? Loads invented gardening ideas as composite token
// values into a tree of framings and runs 15 named checks through Violet's command registry
// (the same commands the violet CLI and MCP server call), against the in-memory store.
//
// Run from the repository root (needs the built dist of violet-core and violet-afd, which
// `pnpm check` produces):
//   fnm exec --using "$(cat .nvmrc)" -- node docs/features/active/ideas/prototype/violet/framings.mjs
// Writes results.json next to this file. Invented data only; no network.

import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const AFD = new URL('../../../../../../integrations/violet-afd/dist/index.js', import.meta.url);
const { createMemoryDatabase, initializeCore, registry } = await import(AFD.href);
initializeCore();

// ---------------------------------------------------------------- invented ideas

const SUBJECTS = [
	'Tomatoes',
	'Garlic',
	'Raised beds',
	'Compost',
	'Mulch',
	'Clay soil',
	'Seedlings',
	'Fruit trees',
	'Cover crops',
	'Rainwater',
	'Pollinators',
	'Slugs',
	'Kale',
	'Herbs',
	'Potatoes',
];
const CLAIMS = [
	'do better with deep, infrequent watering',
	'should be planted after the last frost',
	'need at least six hours of sun',
	'suffer when the soil stays waterlogged',
	'benefit from a thin layer of finished compost',
	'are easiest to start from transplants',
	'pay back the effort of a soil test',
	'want rotating to a new bed each year',
	'attract more beneficial insects when flowers are near',
	'are best harvested in the morning',
];
const TYPES = ['claim', 'principle', 'question', 'observation', 'method'];
const TAGS = ['soil', 'water', 'pests', 'planting', 'harvest', 'tools', 'climate', 'beginner'];

function makeIdeas(n) {
	const ideas = [];
	for (let i = 0; i < n; i++) {
		const tags = [TAGS[i % TAGS.length], TAGS[(i * 3 + 1) % TAGS.length]];
		if (i % 37 === 0) tags.push('private');
		ideas.push({
			id: `idea.i${String(i).padStart(4, '0')}`,
			value: {
				statement: `${SUBJECTS[i % SUBJECTS.length]} ${CLAIMS[(i * 7) % CLAIMS.length]} (#${i}).`,
				type: TYPES[i % TYPES.length],
				tags: [...new Set(tags)],
			},
		});
	}
	return ideas;
}

// ---------------------------------------------------------------- harness

let ctx;
async function run(command, input) {
	const result = await registry.execute(command, input, ctx);
	return result;
}
async function ok(command, input) {
	const result = await run(command, input);
	if (!result.success) {
		throw new Error(`${command} failed: ${JSON.stringify(result.error)}`);
	}
	return result.data;
}
async function resolveMap(nodeId, filter) {
	const data = await ok('tokens.resolve', { nodeId, ...(filter ? { filter } : {}) });
	return new Map(data.tokens.map((t) => [t.id, t]));
}
const stmt = (token) => token?.value?.statement;

// Framings: core (root); public, book, product (children); public-short (grandchild of core)
async function buildTree(n) {
	ctx = { db: createMemoryDatabase(), actor: 'prototype' };
	const ideas = makeIdeas(n);
	await ok('node.create', { id: 'core', name: 'core', type: 'root' });
	for (const id of ['public', 'book', 'product']) {
		await ok('node.create', { id, name: id, parentId: 'core', type: 'custom' });
	}
	await ok('node.create', { id: 'public-short', name: 'public-short', parentId: 'public' });
	const t0 = performance.now();
	for (const idea of ideas) {
		await ok('token.add', { nodeId: 'core', tokenId: idea.id, value: idea.value });
	}
	const loadMs = performance.now() - t0;
	return { ideas, loadMs };
}

const checks = [];
function record(n, name, outcome, note, evidence) {
	checks.push({ check: n, name, outcome, note, evidence });
	console.log(`${n}. ${name}: ${outcome} - ${note}`);
}
const FRAMINGS = ['core', 'public', 'book', 'product', 'public-short'];

// ---------------------------------------------------------------- the 15 checks, at 300

const { ideas } = await buildTree(300);
const I = (k) => ideas[k].id;

// 1 root idea resolves in every framing
{
	const seen = [];
	for (const f of FRAMINGS)
		seen.push((await resolveMap(f)).get(I(1))?.value?.statement === ideas[1].value.statement);
	const counts = [];
	for (const f of FRAMINGS) counts.push((await resolveMap(f)).size);
	record(
		1,
		'root idea resolves in every framing',
		seen.every(Boolean) ? 'works as is' : 'not possible',
		`tokens.resolve returns the composite value unchanged in all 5 framings; counts ${counts.join('/')}`,
		{ seen, counts }
	);
}

// 2 override in one framing, siblings unaffected
{
	const v = { ...ideas[2].value, statement: 'For the book: garlic goes in the ground in October.' };
	await ok('token.override', { nodeId: 'book', tokenId: I(2), value: v });
	const book = stmt((await resolveMap('book')).get(I(2)));
	const pub = stmt((await resolveMap('public')).get(I(2)));
	const prod = stmt((await resolveMap('product')).get(I(2)));
	const pass = book === v.statement && pub === ideas[2].value.statement && prod === pub;
	record(
		2,
		'override in one framing, siblings unaffected',
		pass ? 'works as is' : 'not possible',
		'token.override on book changes book only; public and product keep the root statement',
		{ book, pub, prod }
	);
}

// 3 a root change reaches framings that did not override
{
	const v = { ...ideas[3].value, statement: 'Compost: revised at the root.' };
	const r = await run('token.override', { nodeId: 'core', tokenId: I(3), value: v });
	const after = {};
	for (const f of FRAMINGS) after[f] = stmt((await resolveMap(f)).get(I(3)));
	// and one that did override
	await ok('token.override', {
		nodeId: 'book',
		tokenId: I(4),
		value: { ...ideas[4].value, statement: 'book wording' },
	});
	await ok('token.override', {
		nodeId: 'core',
		tokenId: I(4),
		value: { ...ideas[4].value, statement: 'root rewording' },
	});
	const bookKeeps = stmt((await resolveMap('book')).get(I(4)));
	const pubGets = stmt((await resolveMap('public')).get(I(4)));
	const pass =
		r.success &&
		Object.values(after).every((s) => s === v.statement) &&
		bookKeeps === 'book wording' &&
		pubGets === 'root rewording';
	record(
		3,
		'root change reaches framings that did not override',
		pass ? 'works as is' : 'works awkwardly',
		'a root change is an override at the root itself (there is no update command); it reaches every framing that did not override, and an overriding framing keeps its own wording without notice',
		{ rootOverrideAccepted: r.success, after, bookKeeps, pubGets }
	);
}

// 4 subtract in a framing hides it from its child too
{
	await ok('token.subtract', { nodeId: 'public', tokenId: I(5) });
	const inPub = (await resolveMap('public')).has(I(5));
	const inShort = (await resolveMap('public-short')).has(I(5));
	const inBook = (await resolveMap('book')).has(I(5));
	const pass = !inPub && !inShort && inBook;
	record(
		4,
		'subtract in a framing hides it from its child too',
		pass ? 'works as is' : 'not possible',
		'token.subtract on public removes the idea from public and public-short; book keeps it',
		{ inPub, inShort, inBook }
	);
}

// 5 reset restores (an override, and a subtract)
{
	const r1 = await run('token.reset', { nodeId: 'book', tokenId: I(2) });
	const bookAfter = stmt((await resolveMap('book')).get(I(2)));
	const r2 = await run('token.reset', { nodeId: 'public', tokenId: I(5) });
	const pubAfter = (await resolveMap('public')).has(I(5));
	const shortAfter = (await resolveMap('public-short')).has(I(5));
	const opsBook = (await ctx.db.getOperations('book'))
		.filter((o) => o.tokenId === I(2))
		.map((o) => o.type);
	const pass1 = r1.success && bookAfter === ideas[2].value.statement;
	const pass2 = r2.success && pubAfter && shortAfter;
	record(
		5,
		'reset restores',
		pass1 && pass2 ? 'works as is' : pass1 ? 'works awkwardly' : 'not possible',
		`reset of an override restores the root statement (${pass1}); reset of a subtract (an omit) ${r2.success ? (pass2 ? 'restores it' : 'is accepted but the idea stays hidden') : `is refused: ${r2.error?.code}`}; reset appends an op (book ops for the idea: ${opsBook.join(',')})`,
		{
			r1: r1.success,
			bookAfter,
			r2: r2.success ? r2.data : r2.error,
			pubAfter,
			shortAfter,
			opsBook,
		}
	);
}

// 6 add an idea only a framing has
{
	const r = await run('token.add', {
		nodeId: 'product',
		tokenId: 'idea.product.onboarding',
		value: {
			statement: 'New gardeners want one plant that cannot fail.',
			type: 'claim',
			tags: ['beginner'],
		},
	});
	const inProd = (await resolveMap('product')).has('idea.product.onboarding');
	const inCore = (await resolveMap('core')).has('idea.product.onboarding');
	const clash = await run('token.add', {
		nodeId: 'product',
		tokenId: I(6),
		value: { statement: 'x', type: 'claim', tags: [] },
	});
	record(
		6,
		'add an idea only a framing has',
		r.success && inProd && !inCore ? 'works as is' : 'not possible',
		`token.add on product: present in product, absent from core; adding an id the root already has is refused (${clash.error?.code})`,
		{ inProd, inCore, clash: clash.error?.code }
	);
}

// 7 copy: pin or follow?
{
	await ok('token.override', {
		nodeId: 'book',
		tokenId: I(7),
		value: { ...ideas[7].value, statement: 'book v1' },
	});
	await ok('token.copy', { nodeId: 'product', tokenId: I(7), fromNode: 'book' });
	const v1 = stmt((await resolveMap('product')).get(I(7)));
	await ok('token.override', {
		nodeId: 'book',
		tokenId: I(7),
		value: { ...ideas[7].value, statement: 'book v2' },
	});
	const v2 = stmt((await resolveMap('product')).get(I(7)));
	const lineage = await ok('token.lineage', { nodeId: 'product', tokenId: I(7) });
	const copyStep =
		lineage.chain?.find((s) => s.operation === 'copy') ??
		lineage.lineage?.chain?.find((s) => s.operation === 'copy');
	record(
		7,
		'copy: pins or follows',
		v1 === 'book v1' && v2 === 'book v2' ? 'works awkwardly' : 'not possible',
		`copy follows its source (product read ${v1} then ${v2}); lineage marks tracksSource=${copyStep?.tracksSource}; there is no pinned copy (a pin needs an override with the value at that moment)`,
		{ v1, v2, copyStep }
	);
}

// 8 lineage of a resolved idea in the grandchild
{
	await ok('token.override', {
		nodeId: 'public',
		tokenId: I(8),
		value: { ...ideas[8].value, statement: 'public wording' },
	});
	const lin = await ok('token.lineage', { nodeId: 'public-short', tokenId: I(8) });
	const L = lin.chain ? lin : (lin.lineage ?? lin);
	const steps = (L.chain ?? []).map((s) => `${s.nodeId}:${s.operation}`);
	record(
		8,
		'lineage in the grandchild',
		steps.length >= 2 ? 'works as is' : 'works awkwardly',
		`token.lineage on public-short: ${steps.join(' > ')}, resolvedAt ${L.resolvedAt}`,
		{ steps, resolvedAt: L.resolvedAt }
	);
}

// 9 compare two framings
{
	const cmp = await run('tokens.compare', { nodeIds: ['public', 'book'], onlyDifferent: true });
	const cn = await run('compare.nodes', { nodeA: 'public', nodeB: 'book' });
	const summarize = (r) =>
		r.success
			? Object.fromEntries(
					Object.entries(r.data).filter(([, v]) => typeof v !== 'object' || v === null)
				)
			: r.error;
	const diffCount = cmp.success
		? (cmp.data.tokens ?? cmp.data.rows ?? cmp.data.differences ?? []).length
		: null;
	record(
		9,
		'compare two framings',
		cmp.success && cn.success ? 'works as is' : 'works awkwardly',
		`tokens.compare (onlyDifferent) and compare.nodes both run; composite values compare whole, so a tags-only change counts the same as a reworded statement (${diffCount} differing rows)`,
		{
			tokensCompare: summarize(cmp),
			compareNodes: summarize(cn),
			diffCount,
			sample: cmp.success ? JSON.stringify(cmp.data).slice(0, 600) : null,
		}
	);
}

// 10 impact / dry run: one change, a batch at one node, a batch across nodes
{
	const one = await run('changes.impact', {
		nodeId: 'core',
		changes: [
			{ type: 'override', tokenId: I(10), value: { ...ideas[10].value, statement: 'dry run' } },
		],
	});
	const batch = await run('changes.impact', {
		nodeId: 'core',
		changes: ideas
			.slice(11, 21)
			.map((d) => ({ type: 'override', tokenId: d.id, value: { ...d.value, statement: 'batch' } })),
	});
	const tooMany = await run('changes.impact', {
		nodeId: 'core',
		changes: ideas.slice(0, 51).map((d) => ({ type: 'subtract', tokenId: d.id })),
	});
	const across = await run('changes.impact', {
		nodeId: 'core',
		changes: [{ type: 'subtract', tokenId: I(12) }],
		nodes: { public: [{ type: 'subtract', tokenId: I(13) }] },
	});
	const nodesOf = (r) =>
		r.success ? (r.data.nodes ?? []).map((n) => `${n.id}:${n.effect}`) : r.error?.code;
	const unchanged = stmt((await resolveMap('core')).get(I(10))) === ideas[10].value.statement;
	record(
		10,
		'impact / dry run of one change and of a batch across nodes',
		'works awkwardly',
		`changes.impact previews one or up to 50 changes at ONE node and writes nothing (store unchanged: ${unchanged}); 51 changes refused (${tooMany.error?.code}); there is no input for changes at several nodes (an extra key is ${across.success ? 'silently ignored' : 'refused'}), so a batch across framings cannot be previewed as one`,
		{
			one: nodesOf(one),
			batchNodes: nodesOf(batch),
			tooMany: tooMany.error?.code,
			acrossAccepted: across.success,
			unchanged,
		}
	);
}

// 11 change one field (tags) without overriding the statement
{
	// The only way: override the whole composite with the new tags in the framing
	await ok('token.override', {
		nodeId: 'book',
		tokenId: I(14),
		value: { ...ideas[14].value, tags: [...ideas[14].value.tags, 'book-only'] },
	});
	await ok('token.override', {
		nodeId: 'core',
		tokenId: I(14),
		value: { ...ideas[14].value, statement: 'root reworded later' },
	});
	const book = (await resolveMap('book')).get(I(14));
	// metadata.tags exists on tokens but override cannot set metadata
	const meta = await run('token.override', {
		nodeId: 'book',
		tokenId: I(15),
		value: ideas[15].value,
		metadata: { tags: ['x'] },
	});
	const partial = await run('token.override', {
		nodeId: 'book',
		tokenId: I(16),
		value: { tags: ['only-tags'] },
	});
	const partialStmt = stmt((await resolveMap('book')).get(I(16)));
	record(
		11,
		'change one field without overriding the statement',
		'not possible',
		`override replaces the whole value: after tagging in book and rewording at the root, book still reads "${book.value.statement}"; a partial value {tags} is ${partial.success ? `accepted and drops the statement (book now reads ${partialStmt})` : 'refused'}; a metadata key on override is ${meta.success ? 'silently dropped (not in its input schema)' : 'refused'}`,
		{
			bookStatement: book.value.statement,
			partialAccepted: partial.success,
			partialStmt,
			metadataOnOverride: meta.success,
		}
	);
}

// 12 read the tree as of an earlier moment
{
	const before = new Date().toISOString();
	await new Promise((r) => setTimeout(r, 5));
	await ok('token.override', {
		nodeId: 'core',
		tokenId: I(17),
		value: { ...ideas[17].value, statement: 'changed after the moment' },
	});
	const auditCount = (
		await ok('audit.list', { nodeId: 'core', tokenId: I(17), since: before, limit: 10, offset: 0 })
	).events?.length;
	// No command takes an "as of"; emulate by filtering stored operations by createdAt.
	const db = ctx.db;
	const asOf = Object.create(db);
	asOf.getOperations = async (id) =>
		(await db.getOperations(id)).filter((o) => o.createdAt <= before);
	const { resolveInheritance } = await import(
		new URL(
			'../../../../../../foundations/violet/packages/core/dist/engine/resolver.js',
			import.meta.url
		).href
	);
	const past = (await resolveInheritance(asOf, 'public-short', ['core', 'public'], false)).find(
		(t) => t.id === I(17)
	);
	const schemaHasAsOf = ['tokens.resolve', 'token.lineage', 'tokens.compare'].some((c) =>
		Object.keys(registry.getInputJsonSchema(c).properties).some((k) =>
			/^(asOf|at|time|version|since|until)$/i.test(k)
		)
	);
	record(
		12,
		'read the tree as of an earlier moment',
		'not possible',
		`no command takes a moment (asOf-like input: ${schemaHasAsOf}); audit.list returns the change (${auditCount} event); replaying stored operations up to the moment through resolveInheritance gives "${stmt(past)}", but node edits, deletions and includes are not versioned, so that is outside the engine`,
		{ schemaHasAsOf, auditCount, replayed: stmt(past) }
	);
}

// 13 an idea held back from descendants until released
{
	// Emulation: add at core, subtract in each child; release = reset in each child
	const held = I(18);
	for (const f of ['public', 'book', 'product'])
		await ok('token.subtract', { nodeId: f, tokenId: held });
	const hidden = [];
	for (const f of ['public', 'book', 'product', 'public-short'])
		hidden.push(!(await resolveMap(f)).has(held));
	await ok('node.create', { id: 'talks', name: 'talks', parentId: 'core' });
	const leaksToNew = (await resolveMap('talks')).has(held);
	const release = [];
	for (const f of ['public', 'book', 'product'])
		release.push((await run('token.reset', { nodeId: f, tokenId: held })).success);
	const visibleAfter = (await resolveMap('public')).has(held);
	await ok('node.delete', { id: 'talks', force: true }).catch(() => null);
	record(
		13,
		'idea held back from descendants until released',
		'works awkwardly',
		`emulated by a subtract in every child (hidden: ${hidden.every(Boolean)}); a framing created later receives it at once (leak: ${leaksToNew}); release by reset ${visibleAfter ? 'works' : 'does not bring it back, and no command removes the subtract'}; no held state exists`,
		{ hidden, leaksToNew, release, visibleAfter }
	);
}

// 14 constraint: a public framing may not hold an idea tagged private
{
	const set = await run('constraints.set', {
		nodeId: 'public',
		constraints: [
			{
				id: 'no-private',
				name: 'No private ideas in public',
				applyTo: 'idea.*',
				severity: 'error',
				config: { type: 'pattern', pattern: '^(?!.*"private").*$' },
			},
		],
	});
	const val = set.success ? await run('constraints.validate', { nodeId: 'public' }) : null;
	const valShort = set.success
		? await run('constraints.validate', { nodeId: 'public-short' })
		: null;
	const errors = (r) => (r?.success ? (r.data.summary ?? Object.keys(r.data)) : r?.error?.code);
	// does a write that breaks it get refused?
	const privateIdea = ideas.find((d) => d.value.tags.includes('private') && d.id !== I(0));
	const write = await run('token.override', {
		nodeId: 'public',
		tokenId: I(19),
		value: { ...ideas[19].value, tags: ['private'] },
	});
	record(
		14,
		'constraint: public may not hold an idea tagged private',
		set.success ? 'works awkwardly' : 'not possible',
		set.success
			? `a pattern constraint over the JSON of the value, scoped by id glob at public; validate reports (public ${JSON.stringify(errors(val))}, public-short ${JSON.stringify(errors(valShort))}); a write that breaks it is ${write.success ? 'accepted, only reported' : 'refused'}`
			: `constraints.set refused the pattern: ${set.error?.message}`,
		{
			set: set.success ? 'ok' : set.error,
			validatePublic: errors(val),
			validateShort: errors(valShort),
			writeAccepted: write.success,
			privateExample: privateIdea?.id,
		}
	);
}

// 15 anything else: ids, value types, node types
{
	const tries = {};
	for (const id of [
		'idea.Plant garlic in fall',
		'idea/i1',
		'idea.__proto__',
		'01HZX5ULIDLIKEID',
		'idea.i0000.v2',
	]) {
		const r = await run('token.add', {
			nodeId: 'core',
			tokenId: id,
			value: { statement: 's', type: 'claim', tags: [] },
		});
		tries[id] = r.success ? 'accepted' : r.error?.code;
	}
	const arr = await run('token.add', { nodeId: 'core', tokenId: 'idea.array', value: ['a', 'b'] });
	const tok = (await resolveMap('core')).get(I(0));
	const nodeType = await run('node.create', {
		id: 'f1',
		name: 'f1',
		parentId: 'core',
		type: 'framing',
	});
	record(
		15,
		'other: ids, value types, node types',
		'works awkwardly',
		`any non-empty id except reserved segments (${JSON.stringify(tries)}); a bare array value ${arr.success ? 'accepted' : 'refused'}; composite resolvedValue is JSON text; tokens carry design metadata defaults (category ${tok.metadata.category}, tier ${tok.metadata.tier}); node type 'framing' ${nodeType.success ? 'accepted' : 'refused, so framings use custom'}`,
		{
			tries,
			arrayValue: arr.success,
			resolvedValueSample: String(tok.resolvedValue).slice(0, 80),
			metadata: tok.metadata,
			nodeTypeFraming: nodeType.success,
		}
	);
}

// ---------------------------------------------------------------- timings

async function time(n) {
	const { loadMs } = await buildTree(n);
	for (let k = 0; k < Math.min(n, 30); k++) {
		await ok('token.override', {
			nodeId: 'public',
			tokenId: `idea.i${String(k).padStart(4, '0')}`,
			value: { statement: `public ${k}`, type: 'claim', tags: [] },
		});
	}
	let t = performance.now();
	const res = await ok('tokens.resolve', { nodeId: 'public-short' });
	const resolveMs = performance.now() - t;
	t = performance.now();
	await ok('tokens.compare', { nodeIds: ['public', 'book'], onlyDifferent: true });
	const compareMs = performance.now() - t;
	t = performance.now();
	await ok('changes.impact', {
		nodeId: 'core',
		changes: [
			{
				type: 'override',
				tokenId: 'idea.i0040',
				value: { statement: 'x', type: 'claim', tags: [] },
			},
		],
	});
	const impactMs = performance.now() - t;
	const round = (x) => Math.round(x);
	return {
		ideas: n,
		loadMs: round(loadMs),
		perAddMs: +(loadMs / n).toFixed(2),
		resolveGrandchildMs: round(resolveMs),
		resolved: res.tokens.length,
		compareMs: round(compareMs),
		impactOneChangeMs: round(impactMs),
	};
}
const timings = [await time(300), await time(3000)];
console.log(timings);

writeFileSync(
	new URL('./results.json', import.meta.url),
	`${JSON.stringify(
		{
			step: '0.6',
			ranAt: new Date().toISOString(),
			node: process.version,
			engine:
				'integrations/violet-afd dist (command registry) over foundations/violet core, MemoryDatabase',
			tree: { core: null, public: 'core', book: 'core', product: 'core', 'public-short': 'public' },
			checks,
			timings,
		},
		null,
		'\t'
	)}\n`
);
