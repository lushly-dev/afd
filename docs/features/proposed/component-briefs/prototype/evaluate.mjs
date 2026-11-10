#!/usr/bin/env node
// Phase 0 evaluator: mounts each produced story file in Specimen and scores acceptance checks 1 to
// 4. Run from the library's directory in a built checkout: it loads the Specimen installed there
// and stages each page in the library's `src/phase0/`, which it removes when it ends.
//
//   node evaluate.mjs calibrate <allowed.json>           what the library's own stories carry
//   node evaluate.mjs evaluate <results dir> <allowed.json>
import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(process.cwd());
// Specimen as the library resolves it, not as this folder would: a bare import resolves from the
// script's own location, where nothing is installed.
const { createSpecimenBench } = await import(
	pathToFileURL(join(root, 'node_modules/@lushly-dev/specimen/dist/index.js')).href
);
const [mode, ...rest] = process.argv.slice(2);

const manifest = JSON.parse(readFileSync(join(root, 'custom-elements.json'), 'utf8'));
const declared = new Map(
	manifest.modules
		.flatMap((module) => module.declarations ?? [])
		.filter((declaration) => declaration.tagName)
		.map((declaration) => [
			declaration.tagName,
			new Map(
				(declaration.attributes ?? []).map((attribute) => [
					attribute.name,
					attribute.type?.text ?? '',
				])
			),
		])
);
const GLOBAL = new Set([
	...[
		'id',
		'class',
		'slot',
		'style',
		'hidden',
		'tabindex',
		'title',
		'lang',
		'dir',
		'role',
		'part',
		'inert',
	],
]);
const isGlobal = (name) => GLOBAL.has(name) || /^(aria-|data-)/.test(name);

/** Check 4's findings for one capture: tags, attributes and literal values the manifest lacks. */
function manifestFindings(elements, allowed) {
	const findings = [];
	for (const { tag, attributes } of elements) {
		if (!tag.startsWith('violet-')) continue;
		const known = declared.get(tag);
		if (!known) {
			findings.push({ problem: 'unknown-tag', tag });
			continue;
		}
		for (const [name, value] of Object.entries(attributes)) {
			if (!known.has(name)) {
				if (!isGlobal(name) && !allowed.has(`${tag} ${name}`))
					findings.push({ problem: 'unknown-attribute', tag, attribute: name });
				continue;
			}
			const type = known.get(name);
			if (!/["']/.test(type)) continue;
			const values = [...type.matchAll(/["']([^"']*)["']/g)].map((match) => match[1]);
			if (!values.includes(value))
				findings.push({ problem: 'value-not-allowed', tag, attribute: name, value });
		}
	}
	return findings;
}

/** Chromium's ARIA snapshot as a tree of { role, name, flags, text, children }. */
function parseSnapshot(snapshot) {
	const top = { role: 'root', name: '', flags: [], text: '', children: [] };
	const stack = [{ indent: -1, node: top }];
	for (const line of snapshot.split('\n')) {
		const match = line.match(/^(\s*)- (.*)$/);
		if (!match) continue;
		const indent = match[1].length;
		let body = match[2];
		const node = { role: '', name: '', flags: [], text: '', children: [] };
		node.role = body.match(/^[\w-]+/)?.[0] ?? '';
		body = body.slice(node.role.length);
		const named = body.match(/^ "((?:[^"\\]|\\.)*)"/) ?? body.match(/^ \/(.*?)\/(?= |:|$)/);
		if (named) {
			node.name = named[1].replace(/\\"/g, '"');
			body = body.slice(named[0].length);
		}
		for (const flag of body.matchAll(/\[([^\]]+)\]/g)) node.flags.push(flag[1]);
		body = body.replace(/\s*\[[^\]]+\]/g, '');
		node.text = body.replace(/^:\s?/, '').trim();
		while (stack.at(-1).indent >= indent) stack.pop();
		stack.at(-1).node.children.push(node);
		stack.push({ indent, node });
	}
	return top;
}
const same = (a, b) => a.replace(/\s+/g, ' ').trim().toLowerCase() === b.toLowerCase();
function* walk(node) {
	yield node;
	for (const child of node.children) yield* walk(child);
}
const all = (tree, roles, test = () => true) =>
	[...walk(tree)].filter((node) => [roles].flat().includes(node.role) && test(node));
const named = (tree, roles, name) => all(tree, roles, (node) => same(node.name, name));
const textOf = (node) => [...walk(node)].map((each) => `${each.name} ${each.text}`).join(' ');

const hasAttribute = (elements, name, value) =>
	elements.some(
		(element) =>
			element.attributes[name] !== undefined &&
			(value === undefined || element.attributes[name] === value)
	);
const hasTag = (elements, ...tags) => elements.some((element) => tags.includes(element.tag));

/** Each task's required parts. Every check returns the names of the parts that are missing. */
const REQUIRED = {
	t1: {
		stories: ['Page', 'Invalid'],
		check(story, { tree, elements, snapshot }) {
			const missing = [];
			const need = (label, ok) => ok || missing.push(label);
			need('form', hasTag(elements, 'form'));
			need('textbox Name', named(tree, 'textbox', 'Name').length);
			need('textbox Bio', named(tree, 'textbox', 'Bio').length);
			need('Role choice', named(tree, ['combobox', 'listbox', 'radiogroup'], 'Role').length);
			const dom = this.dom;
			need(
				'Role options',
				['Viewer', 'Editor', 'Admin'].every((option) => dom.includes(option))
			);
			need(
				'Editor chosen',
				/(radio|option) "Editor"[^\n]*\[(checked|selected)\]/.test(snapshot) ||
					/combobox "Role"[^\n]*Editor/.test(snapshot) ||
					elements.some(
						(element) =>
							/^(violet-(select|combobox|radio-group|listbox)|select)$/.test(element.tag) &&
							/^editor$/i.test(element.attributes.value ?? '')
					)
			);
			need(
				'switch Email notifications, on',
				named(tree, 'switch', 'Email notifications').some((node) => node.flags.includes('checked'))
			);
			need('checkbox I accept the terms', named(tree, 'checkbox', 'I accept the terms').length);
			need('button Save', named(tree, 'button', 'Save').length);
			need('button Cancel', named(tree, 'button', 'Cancel').length);
			need(
				'Name required',
				hasAttribute(elements, 'required') || hasAttribute(elements, 'aria-required', 'true')
			);
			const names = new Set(
				elements
					.filter(
						(element) =>
							element.attributes.name &&
							(element.state?.formAssociated === true ||
								/^(input|select|textarea)$/.test(element.tag)) &&
							!/^violet-radio$/.test(element.tag)
					)
					.map((element) => element.attributes.name)
			);
			need('four named form controls', names.size >= 4);
			if (story === 'Invalid') {
				need('Name marked invalid', hasAttribute(elements, 'aria-invalid', 'true'));
				need('message Enter a name.', snapshot.includes('Enter a name.'));
			}
			return missing;
		},
	},
	t2: {
		stories: ['Closed', 'ConfirmOpen'],
		check(story, { tree, elements }) {
			const missing = [];
			const need = (label, ok) => ok || missing.push(label);
			const dom = this.dom;
			need('an icon', hasTag(elements, 'violet-icon', 'svg'));
			need(
				'three menu items',
				elements.filter(
					(element) => element.tag === 'violet-menu-item' || element.attributes.role === 'menuitem'
				).length >= 3 && ['Rename', 'Duplicate', 'Delete'].every((item) => dom.includes(item))
			);
			need('help text', dom.includes('Deleting a project cannot be undone.'));
			// A modal dialog leaves the story root's ARIA snapshot empty, so the open dialog is read
			// from the DOM: an open dialog element, and its title, text and buttons in the markup.
			const open = elements.some(
				(element) =>
					/^(violet-dialog|dialog)$/.test(element.tag) && element.attributes.open !== undefined
			);
			if (story === 'Closed') {
				need('button Actions', named(tree, 'button', 'Actions').length);
				need('button Help', named(tree, 'button', 'Help').length);
				need('no dialog open', !open);
			} else {
				need('dialog open', open);
				need('dialog title', dom.includes('Delete project?'));
				need('dialog text', dom.includes('This removes the project and its files.'));
				need('dialog buttons', dom.includes('Cancel') && dom.includes('Delete'));
			}
			return missing;
		},
	},
	t3: {
		stories: ['Page'],
		check(_story, { tree, elements }) {
			const missing = [];
			const need = (label, ok) => ok || missing.push(label);
			const navigation = all(tree, 'navigation').find((node) =>
				['Home', 'Projects', 'Atlas'].every((level) => textOf(node).includes(level))
			);
			need('breadcrumb navigation with three levels', navigation);
			need('current page marked', hasAttribute(elements, 'aria-current', 'page'));
			need('tree', all(tree, 'tree').length);
			need(
				'treeitem src, expanded',
				named(tree, 'treeitem', 'src').some((node) => node.flags.includes('expanded'))
			);
			need('treeitem index.ts', named(tree, 'treeitem', 'index.ts').length);
			need(
				'treeitem app.ts, selected',
				named(tree, 'treeitem', 'app.ts').some((node) => node.flags.includes('selected')) ||
					(named(tree, 'treeitem', 'app.ts').length &&
						hasAttribute(elements, 'aria-current', 'true'))
			);
			need(
				'treeitem docs, collapsed',
				named(tree, 'treeitem', 'docs').some((node) => !node.flags.includes('expanded'))
			);
			need('tablist', all(tree, 'tablist').length);
			const tab = (name) =>
				all(tree, 'tab', (node) => node.name.trim().toLowerCase().startsWith(name.toLowerCase()));
			need('tab Files', tab('Files').length);
			need('tab Settings', tab('Settings').length);
			need(
				'tab Activity, selected',
				tab('Activity').some((node) => node.flags.includes('selected'))
			);
			need(
				'Activity count 3',
				tab('Activity').some((node) => textOf(node).includes('3'))
			);
			const panel = all(tree, 'tabpanel').find((node) => textOf(node).includes('No activity yet'));
			need('Activity panel with empty state', panel);
			if (panel)
				need('button Invite a teammate', named(panel, 'button', 'Invite a teammate').length);
			need(
				'loading indicator',
				hasTag(elements, 'violet-spinner', 'violet-progress', 'violet-skeleton', 'progress') ||
					hasAttribute(elements, 'role', 'progressbar') ||
					hasAttribute(elements, 'role', 'status')
			);
			return missing;
		},
	},
};
const FILES = {
	t1: 'member-settings.stories.ts',
	t2: 'project-actions.stories.ts',
	t3: 'project-browser.stories.ts',
};

const stage = join(root, 'src/phase0');

if (mode === 'calibrate') {
	rmSync(stage, { recursive: true, force: true });
	const bench = await createSpecimenBench({ root });
	const seen = new Set();
	let failed = 0;
	try {
		for (const entry of bench.list()) {
			try {
				const run = await bench.run({ id: entry.id });
				for (const finding of manifestFindings(run.observation.channels.elements, new Set()))
					if (finding.problem === 'unknown-attribute')
						seen.add(`${finding.tag} ${finding.attribute}`);
			} catch {
				failed += 1;
			}
		}
	} finally {
		await bench.close();
	}
	writeFileSync(resolve(rest[0]), JSON.stringify([...seen].sort(), null, '\t'));
	console.log(
		`${seen.size} undeclared attribute uses in the library's own stories; ${failed} stories did not run`
	);
} else if (mode === 'evaluate') {
	const results = resolve(rest[0]);
	const allowed = new Set(JSON.parse(readFileSync(resolve(rest[1]), 'utf8')));
	// A page left staged would be picked up by the library's own story runs.
	process.on('exit', () => rmSync(stage, { recursive: true, force: true }));
	for (const task of readdirSync(results).filter((name) => REQUIRED[name]))
		for (const arm of readdirSync(join(results, task)))
			for (const run of readdirSync(join(results, task, arm))) {
				const directory = join(results, task, arm, run);
				const page = join(directory, 'page.stories.ts');
				const verdict = { task, arm, run: Number(run), stories: {}, checks: {} };
				if (!existsSync(page)) {
					verdict.checks = { complete: false, mounts: false, accessible: false, manifest: false };
					verdict.note = 'no file produced';
					writeFileSync(join(directory, 'eval.json'), JSON.stringify(verdict, null, '\t'));
					continue;
				}
				rmSync(stage, { recursive: true, force: true });
				mkdirSync(stage, { recursive: true });
				cpSync(page, join(stage, FILES[task]));
				let bench;
				try {
					bench = await createSpecimenBench({ root });
					const entries = bench.list().filter((entry) => entry.module.includes('src/phase0/'));
					const missing = [];
					const manifestProblems = [];
					let mounts = entries.length > 0;
					let accessible = entries.length > 0;
					for (const story of REQUIRED[task].stories) {
						const entry = entries.find((each) => each.exportName === story);
						if (!entry) {
							missing.push(`story ${story}`);
							continue;
						}
						let run;
						try {
							run = await bench.run({ id: entry.id });
						} catch (error) {
							mounts = false;
							accessible = false;
							missing.push(`story ${story} did not run`);
							verdict.stories[story] = { error: String(error).slice(0, 400) };
							continue;
						}
						const { channels } = run.observation;
						const failures = run.outcome.failures ?? [];
						const hard = failures.filter((failure) => !/a11y/.test(failure.category ?? ''));
						if (hard.length || channels.console.errors.length) mounts = false;
						const violations = [
							...(run.outcome.a11y?.violations ?? []),
							...(run.outcome.settled?.violations ?? []),
						];
						if (violations.length) accessible = false;
						const tree = parseSnapshot(channels.a11y.snapshot);
						const context = { tree, elements: channels.elements, snapshot: channels.a11y.snapshot };
						const storyMissing = REQUIRED[task].check.call(
							{ dom: channels.dom.raw },
							story,
							context
						);
						missing.push(...storyMissing.map((part) => `${story}: ${part}`));
						const problems = manifestFindings(channels.elements, allowed);
						manifestProblems.push(...problems);
						verdict.stories[story] = {
							status: run.outcome.status,
							failures: failures.map(
								(failure) => `${failure.category}: ${String(failure.message).slice(0, 200)}`
							),
							consoleErrors: channels.console.errors.map((error) => error.slice(0, 200)),
							violations: [...new Set(violations.map((violation) => violation.id))],
							missing: storyMissing,
							manifest: problems,
							tags: [
								...new Set(
									channels.elements
										.map((element) => element.tag)
										.filter((tag) => tag.startsWith('violet-'))
								),
							].sort(),
							snapshot: channels.a11y.snapshot,
						};
					}
					const unique = [...new Set(manifestProblems.map((problem) => JSON.stringify(problem)))];
					verdict.missing = missing;
					verdict.manifestProblems = unique.map((problem) => JSON.parse(problem));
					verdict.checks = {
						complete: missing.length === 0,
						mounts: mounts && !missing.some((part) => /did not run|^story /.test(part)),
						accessible,
						manifest: unique.length === 0,
					};
				} catch (error) {
					verdict.checks = { complete: false, mounts: false, accessible: false, manifest: false };
					verdict.note = `bench failed: ${String(error).slice(0, 400)}`;
				} finally {
					await bench?.close();
				}
				writeFileSync(join(directory, 'eval.json'), JSON.stringify(verdict, null, '\t'));
				console.log(
					`${task}:${arm}:${run} ${Object.entries(verdict.checks)
						.map(([name, ok]) => `${name}=${ok ? 1 : 0}`)
						.join(
							' '
						)}${verdict.missing?.length ? ` missing: ${verdict.missing.join('; ')}` : ''}${verdict.note ? ` (${verdict.note})` : ''}`
				);
			}
	rmSync(stage, { recursive: true, force: true });
} else {
	console.error(
		'Usage: node evaluate.mjs calibrate <allowed.json> | evaluate <results dir> <allowed.json>'
	);
	process.exit(2);
}
