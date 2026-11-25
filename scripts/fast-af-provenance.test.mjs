import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	hasStaleShape,
	isRemoved,
	matchesRecord,
	PROVENANCE_FAMILIES,
	provenancePaths,
} from './release/provenance.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = PROVENANCE_FAMILIES['fast-af'].directory;
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const blob = (bytes) =>
	createHash('sha1')
		.update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]))
		.digest('hex');
const record = (name) => JSON.parse(readFileSync(join(root, directory, name), 'utf8'));
const provenance = record('provenance.json');
const upstream = record('upstream-selected.json');
const adaptations = record('adaptations.json');

test("FAST-AF provenance records are bound by hash and match each unit's release state", () => {
	const { adaptations: changing, ...frozen } = provenance.records;
	for (const entry of Object.values(frozen))
		assert.equal(sha(readFileSync(join(root, directory, entry.manifest))), entry.sha256);
	// Each row's current_import_sha256 still binds the record to its file (below). The digest of
	// adaptations.json, which changes with every edit, is not committed: its one line made any two
	// branches that recorded different files conflict (#1610).
	assert.equal(changing.manifest, 'adaptations.json');
	assert(
		!('sha256' in changing),
		"do not commit adaptations.json's digest (#1610). A merge made by an older pnpm base:sync " +
			'puts it back: run node scripts/release/provenance.mjs fast-af "<reason>", which removes it'
	);
	assert.equal(upstream.revision, provenance.source_revision);
	assert.equal(adaptations.source_revision, provenance.source_revision);
	const inventory = JSON.parse(readFileSync(join(root, 'scripts/release/inventory.json'), 'utf8'));
	const architecture = JSON.parse(readFileSync(join(root, 'architecture.json'), 'utf8'));
	for (const unit of provenance.units) {
		const manifestPath = `${unit.path}/package.json`;
		const owner = inventory.units.find((item) =>
			item.distributions.some((distribution) => distribution.name === unit.name)
		);
		// A preview unit is admitted on the prerelease route; every other unit stays quarantined.
		assert.ok(['preview', 'quarantined'].includes(unit.publication_state), unit.name);
		assert.equal(
			owner?.state,
			unit.publication_state === 'preview' ? 'admitted' : 'quarantined',
			unit.name
		);
		if (unit.publication_state === 'preview')
			assert.deepEqual([owner.routes, owner.distTag], [['npm-prerelease'], 'preview'], unit.name);
		assert.equal(owner.family, 'fast-af', unit.name);
		assert.equal(owner.sourceRevision, provenance.source_revision, unit.name);
		assert.equal(owner.distributions[0].manifest, manifestPath);
		const manifest = JSON.parse(readFileSync(join(root, manifestPath), 'utf8'));
		assert.equal(manifest.private === true, unit.private === true, `${unit.name} private flag`);
		assert.equal(owner.distributions[0].private === true, unit.private === true, unit.name);
		const classified = architecture.units.find((item) => item.manifest === manifestPath);
		assert.deepEqual([classified?.family, classified?.layer], ['fast-af', unit.layer], unit.name);
	}
	for (const unit of provenance.retired_units ?? []) {
		const manifestPath = `${unit.path}/package.json`;
		const owner = inventory.units.find((item) =>
			item.distributions.some((distribution) => distribution.name === unit.name)
		);
		assert.equal(owner?.family, unit.family, unit.name);
		assert.equal(owner?.distributions[0].manifest, manifestPath, unit.name);
		const classified = architecture.units.find((item) => item.manifest === manifestPath);
		assert.deepEqual([classified?.family, classified?.layer], [unit.family, unit.layer], unit.name);
		assert.deepEqual(
			adaptations.files.filter((file) => file.path.startsWith(`${unit.path}/`)),
			[],
			`retired unit ${unit.name} must have no per-file rows in adaptations.json`
		);
	}
});

const LICENSE_COPIES = [
	['packages/element/packages/fast-element/LICENSE', 'packages/element/LICENSE'],
	['packages/violet-elements/LICENSE', 'LICENSE'],
];
const IMPORTED_LICENSES = ['LICENSE', 'packages/element/LICENSE'];

test('upstream license files are imported verbatim', () => {
	// NOTICE.md is not held verbatim: fast-af wrote it about its own repository, so it is kept
	// true of this one. The notice test below holds its attribution table against the license
	// files in the tree; it does not check the notice's prose.
	for (const path of IMPORTED_LICENSES) {
		const file = adaptations.files.find((entry) => entry.upstream_path === path);
		assert.equal(file?.path, `foundations/fast-af/${path}`, path);
		assert.equal(file.current_import_sha256, file.upstream_sha256, `${path} must stay verbatim`);
	}
	for (const [copy, original] of LICENSE_COPIES)
		assert.equal(
			sha(readFileSync(join(root, 'foundations/fast-af', copy))),
			upstream.files.find((file) => file.path === original).sha256,
			`${copy} is a verbatim copy of ${original}`
		);
});

// A file that carries license or notice terms: one in a LICENSES folder (the REUSE layout), or
// one whose name carries the word license, licence, unlicense, copying, copyright or notice
// (LICENSE.md, MIT-LICENSE, LICENSE_APACHE-2.0, COPYING.LESSER, NOTICE), or third party
// (ThirdPartyNotices.txt). A source or data extension means a file that is only named like one;
// an unknown extension counts, which fails toward red. The notice itself is not one.
const NOT_A_LICENSE = /\.(?:[cm]?[jt]sx?|jsonc?|css|scss|svg|png|py|rs|ya?ml|toml|map|snap|sh)$/i;
const isLicense = (path) => {
	if (path === 'NOTICE.md') return false;
	const name = path.split('/').at(-1);
	if (NOT_A_LICENSE.test(name)) return false;
	return (
		/(?:^|\/)licenses\//i.test(path) ||
		/third[-_ .]?party/i.test(name) ||
		/(?:^|[^a-z])(?:(?:un)?licen[cs]es?|copying|copyright|notices?)(?:[^a-z]|$)/i.test(name)
	);
};
const NOTICE_COLUMNS = ['Path', 'Derived from', 'Upstream copyright', 'License file'];

/**
 * The copyright holders a license text names, each once: each line that starts with "Copyright"
 * or "Portions Copyright", less the mark, the years, "by" and "All rights reserved", with a
 * Markdown link read as its text. A license body's phrase wrapped to the start of a line
 * ("copyright notice that", "copyright on the Program", "COPYRIGHT HOLDERS BE LIABLE") or a
 * template's placeholders ("[yyyy] [name of copyright owner]", "<year>") name no one; any other
 * text counts as a holder, so an unknown phrase fails red. A body word followed by a capital, in
 * a line that is not all capitals, starts a name. `unnamed` counts lines with a mark or a year
 * and no name, whose holder may be on the next line.
 */
const BODY_WORD =
	/^(?:notices?|holders?|owners?|licen[cs]es?|laws?|statements?|permissions?|protection|infringement|and|or|on|in)\b/i;
const PLACEHOLDERS = /^(?:[[{<][^\]}>]*[\]}>]\s*)+$/;
const namesNoOne = (rest) => {
	const word = BODY_WORD.exec(rest);
	if (word) return rest === rest.toUpperCase() || !/^\s+[A-Z]/.test(rest.slice(word[0].length));
	return PLACEHOLDERS.test(rest) || /^[,.;:]/.test(rest);
};
const MARK = /^(?:\(c\)|©)\s*/i;
const YEARS = /^(?:\d{4}(?:\s*[-–]\s*(?:\d{4}|present))?\s*,?\s*)+/i;
function copyrightHolders(text) {
	const holders = new Set();
	let unnamed = 0;
	for (const [, rest] of text.matchAll(/^[ \t]*(?:portions[ \t]+)?copyright\b:?[ \t]*(.*)$/gim)) {
		const dated = rest.replace(MARK, '').replace(YEARS, '').replace(MARK, '');
		const holder = dated
			.replace(/^by\s+/i, '')
			.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
			.replace(/\.?\s*all rights reserved\.?\s*$/i, '')
			.replace(/\.\s*$/, '')
			.trim();
		if (/^[\s,.;:]*$/.test(holder)) {
			if (dated !== rest) unnamed += 1;
		} else if (!namesNoOne(holder)) holders.add(holder);
	}
	return { holders: [...holders], unnamed };
}

/**
 * What a notice gets wrong about the license files beside it, in both directions. A row names
 * one path that is in the tree and links an upstream license in that folder: a license file
 * whose text is not the root license's. Every upstream license needs the row over its path to
 * link a license with the same text and to name exactly the copyright holders that text names.
 * `paths` are relative to the notice.
 */
function noticeProblems(notice, paths, read) {
	const cells = (line) =>
		line
			.split('|')
			.slice(1, -1)
			.map((cell) => cell.trim());
	const local = (path) => path?.replace(/^\.\//, '').replace(/\/$/, '');
	// Only what the notice renders: no comments or fenced blocks, and one table, so a row the
	// rendered table does not show cannot satisfy the check.
	const lines = notice
		.replace(/<!--[\s\S]*?(?:-->|$)/g, '')
		.replace(/^[ \t]*(`{3,}|~{3,})[\s\S]*?(?:^[ \t]*\1|(?![\s\S]))/gm, '')
		.split('\n');
	// Indented four spaces or a tab, a line outside a table is code; inside one, it is a row.
	const isRow = (line) => line.trim().startsWith('|');
	const isCode = (line) => /^(?: {4}|\t)/.test(line);
	const start = lines.findIndex((line) => isRow(line) && !isCode(line));
	const end = start < 0 ? start : lines.findIndex((line, i) => i > start && !isRow(line));
	const table = start < 0 ? [] : lines.slice(start, end < 0 ? undefined : end).map((l) => l.trim());
	// A reshaped table must not read as an empty one.
	if (cells(table[0] ?? '').join('|') !== NOTICE_COLUMNS.join('|'))
		return [`the notice has no table with the columns ${NOTICE_COLUMNS.join(', ')}`];
	const problems = [];
	if (end >= 0 && lines.slice(end).some((line) => isRow(line) && !isCode(line)))
		problems.push('the notice has table rows outside its table');
	const own = paths.includes('LICENSE') ? read('LICENSE') : undefined;
	if (own === undefined) problems.push('the root LICENSE is missing');
	const rows = [];
	for (const row of table.slice(1).map(cells)) {
		if (row.length > 0 && row.every((cell) => /^:?-+:?$/.test(cell))) continue;
		if (row.length !== NOTICE_COLUMNS.length) {
			problems.push(`a row of the notice has ${row.length} cells, not ${NOTICE_COLUMNS.length}`);
			continue;
		}
		const [pathCell, source, copyright, licenseCell] = row;
		const named = [...pathCell.matchAll(/`([^`]+)`/g)].map(([, path]) => local(path));
		const license = local(/\]\(([^)]+)\)/.exec(licenseCell)?.[1]);
		if (named.length !== 1) {
			problems.push(`a row of the notice names ${named.length} paths; name one path a row`);
			continue;
		}
		const [path] = named;
		// A folder may carry more than one upstream file (an Apache LICENSE and NOTICE): a row each.
		if (rows.some((other) => other.path === path && other.license === license))
			problems.push(`the notice has more than one row for ${path} and ${license}`);
		rows.push({ path, copyright, license });
		if (!paths.some((file) => file.startsWith(`${path}/`)))
			problems.push(`the notice credits ${path}, which is not in this tree`);
		if (!source || !copyright)
			problems.push(`the notice's row for ${path} needs its upstream and its copyright holder`);
		if (!license || !paths.includes(license))
			problems.push(`the notice links ${license ?? 'no license file'}, which does not exist`);
		else if (
			!isLicense(license) ||
			// A REUSE LICENSES folder belongs to the folder that holds it.
			license.slice(0, license.lastIndexOf('/')).replace(/(?:^|\/)LICENSES$/i, '') !== path
		)
			problems.push(`the notice's row for ${path} must link a license file in ${path}`);
		else if (read(license) === own)
			problems.push(`the notice's row for ${path} links FAST-AF's own license, not an upstream's`);
	}
	if (rows.length === 0) problems.push('the notice credits no upstream');
	for (const path of paths.filter(isLicense)) {
		const text = read(path);
		if (text === own) continue;
		const row = rows.find(
			(candidate) =>
				path.startsWith(`${candidate.path}/`) &&
				paths.includes(candidate.license) &&
				read(candidate.license) === text
		);
		if (!row) {
			problems.push(`${path} is an upstream license that no row of the notice credits`);
			continue;
		}
		const { holders, unnamed } = copyrightHolders(text);
		if (unnamed > 0)
			problems.push(
				`${path} has a copyright line with no holder on it, which this check cannot read`
			);
		if (holders.length === 0)
			problems.push(`${path} names no copyright holder to check the notice against`);
		let rest = row.copyright;
		for (const holder of holders) {
			if (!rest.includes(holder))
				problems.push(
					`the notice's row for ${row.path} does not name ${holder}, whom ${path} names`
				);
			rest = rest.replace(holder, '');
		}
		if (holders.length > 0 && rest.replace(/\band\b|[\s,;&]/g, '') !== '')
			problems.push(
				`the notice's row for ${row.path} says "${row.copyright}", more than the holders ${path} names`
			);
	}
	return problems;
}

test('the notice credits every upstream license in the tree and names only what is there', () => {
	const prefix = 'foundations/fast-af/';
	// violet-elements is outside provenancePaths (#1783) and carries a license copy, so list here.
	const paths = execFileSync(
		'git',
		['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', prefix],
		{ cwd: root, encoding: 'utf8' }
	)
		.split('\0')
		.filter((path) => path && existsSync(join(root, path)))
		.map((path) => path.slice(prefix.length));
	// The license files Git sees are the ones the test above declares, in both directions: a
	// license that appears, moves or goes is a decision about this notice.
	assert.deepEqual(
		paths.filter(isLicense).sort(),
		[...IMPORTED_LICENSES, ...LICENSE_COPIES.map(([copy]) => copy)].sort(),
		'declare a new or removed license file above, and credit an upstream one in NOTICE.md'
	);
	const read = (path) => readFileSync(join(root, prefix, path), 'utf8');
	assert.deepEqual(noticeProblems(read('NOTICE.md'), paths, read), []);
});

test('noticeProblems reads a notice against its tree in both directions', () => {
	const upstreamLicense =
		'MIT License\n\nCopyright (c) Example Corporation. All rights reserved.\n';
	const tree = {
		LICENSE: 'MIT License\n\nCopyright (c) 2026 Lushly Dev\n',
		'packages/a/LICENSE': upstreamLicense,
		'packages/a/index.ts': '',
		'packages/own/LICENSE': 'MIT License\n\nCopyright (c) 2026 Lushly Dev\n',
		'packages/own/README.md': '',
	};
	const row = (path, holder = 'Example Corporation', license = `${path}/LICENSE`) =>
		`| \`${path}\` | Example (\`example/a\`) | ${holder} | [${license}](${license}) |`;
	const good = row('packages/a');
	const notice = (...rows) =>
		[`| ${NOTICE_COLUMNS.join(' | ')} |`, '|---|---|---|---|', ...rows].join('\n');
	const check = (text, files = tree) =>
		noticeProblems(text, Object.keys(files), (path) => files[path]);
	const holderRow = "the notice's row for packages/a";

	// Passing cases, which also show the harness reaches its assertions.
	assert.deepEqual(check(notice(good)), [], 'a notice that credits its tree passes');
	assert.deepEqual(
		check(notice(good), { ...tree, 'packages/a/packages/x/LICENSE': upstreamLicense }),
		[],
		'a copy of an upstream license inside the credited path is covered by that row'
	);
	assert.deepEqual(
		check(notice(good), { ...tree, 'packages/a/license-check.ts': '' }),
		[],
		'a source file named like a license is not one'
	);
	assert.deepEqual(
		check(notice(good, row('packages/a', 'Other Holder', 'packages/a/NOTICE')), {
			...tree,
			'packages/a/NOTICE': 'Example\n\nCopyright 2021 Other Holder\n',
		}),
		[],
		'a folder with an Apache LICENSE and NOTICE takes a row for each'
	);
	const { 'packages/a/LICENSE': _, ...reuse } = tree;
	assert.deepEqual(
		check(notice(row('packages/a', 'Example Corporation', 'packages/a/LICENSES/MIT.txt')), {
			...reuse,
			'packages/a/LICENSES/MIT.txt': upstreamLicense,
		}),
		[],
		"a REUSE LICENSES folder's file credits its parent"
	);
	assert.deepEqual(
		check(notice(`  ${row('packages/a/', 'Example Corporation', './packages/a/LICENSE')}`)),
		[],
		'an indented row, a trailing slash and a ./ link read the same'
	);

	// A row about something that is not there.
	assert.deepEqual(check(notice(good, row('packages/gone'))), [
		'the notice credits packages/gone, which is not in this tree',
		'the notice links packages/gone/LICENSE, which does not exist',
	]);
	// A row that credits nothing: its own license, a file that is no license, another path's
	// license, a second row for the same path.
	assert.deepEqual(check(notice(good, row('packages/own'))), [
		"the notice's row for packages/own links FAST-AF's own license, not an upstream's",
	]);
	assert.deepEqual(check(notice(good, row('packages/own', 'Someone', 'packages/own/README.md'))), [
		"the notice's row for packages/own must link a license file in packages/own",
	]);
	assert.deepEqual(
		check(notice(good, row('packages/own', 'Example Corporation', 'packages/a/LICENSE'))),
		["the notice's row for packages/own must link a license file in packages/own"]
	);
	assert.deepEqual(check(notice(good, good)), [
		'the notice has more than one row for packages/a and packages/a/LICENSE',
	]);
	assert.deepEqual(
		check(notice(good, '| `packages/a` (`packages/gone*`) | Example | Example | [x](x) |')),
		['a row of the notice names 2 paths; name one path a row']
	);
	assert.deepEqual(check(notice(good, '| `packages/own` | Example |')), [
		'a row of the notice has 2 cells, not 4',
	]);
	assert.deepEqual(
		check(notice(row('packages', 'Example Corporation', 'packages/a/LICENSE'))),
		["the notice's row for packages must link a license file in packages"],
		'a row over a parent folder would credit what it holds beside the upstream'
	);

	// An upstream license no row credits, at the top and deeper under a name the scan must know.
	assert.deepEqual(check(notice()), [
		'the notice credits no upstream',
		'packages/a/LICENSE is an upstream license that no row of the notice credits',
	]);
	for (const name of [
		'LICENSE-MIT',
		'MIT-LICENSE',
		'LICENSE_APACHE-2.0',
		'license.rst',
		'COPYING.LIB',
		'UNLICENSE',
		'NOTICE',
		'COPYRIGHT',
		'ThirdPartyNotices.txt',
		'ThirdPartyLicenses.txt',
		'LICENSE.html',
		'LICENSES/MIT.txt',
	])
		assert.deepEqual(
			check(notice(good), {
				...tree,
				[`packages/b/src/vendor/${name}`]: 'Copyright 2019 Someone Else\n',
			}),
			[`packages/b/src/vendor/${name} is an upstream license that no row of the notice credits`]
		);

	// The holder, however the license writes its copyright line.
	for (const line of [
		'Copyright (c) Example Corporation. All rights reserved.',
		'Copyright (C) 2024 Example Corporation.',
		'Copyright © 2013-2023 Example Corporation',
		'Copyright 2020, 2021 Example Corporation',
		'    copyright (c) 2019-present Example Corporation',
		'Copyright 2019 by Example Corporation',
		'Copyright 2012-2018 (c) Example Corporation',
	]) {
		const files = {
			...tree,
			'packages/a/LICENSE': `MIT License\n\n${line}\n\nThe above copyright notice stays.\n`,
		};
		assert.deepEqual(check(notice(good), files), [], line);
		assert.deepEqual(
			check(notice(row('packages/a', 'Lushly Dev')), files),
			[
				`${holderRow} does not name Example Corporation, whom packages/a/LICENSE names`,
				`${holderRow} says "Lushly Dev", more than the holders packages/a/LICENSE names`,
			],
			line
		);
	}
	assert.deepEqual(check(notice(row('packages/a', 'not Example Corporation'))), [
		`${holderRow} says "not Example Corporation", more than the holders packages/a/LICENSE names`,
	]);
	assert.deepEqual(
		check(notice(row('packages/a', 'Unknown Corp')), {
			...tree,
			'packages/a/LICENSE': 'Copyright (c) U.S. Robotics\n',
		}),
		[
			`${holderRow} does not name U.S. Robotics, whom packages/a/LICENSE names`,
			`${holderRow} says "Unknown Corp", more than the holders packages/a/LICENSE names`,
		]
	);
	assert.deepEqual(
		check(notice(row('packages/a', 'First Author and Second Author')), {
			...tree,
			'packages/a/LICENSE': 'Copyright (c) 2019 First Author\nCopyright (c) 2021 Second Author\n',
		}),
		[],
		'two holders, both named'
	);
	assert.deepEqual(
		check(notice(good), {
			...tree,
			'packages/a/LICENSE': `${upstreamLicense}\n---\n\n${upstreamLicense}`,
		}),
		[],
		'a holder the license names twice is named once'
	);
	assert.deepEqual(
		check(notice(good), {
			...tree,
			'packages/a/LICENSE': [
				'Apache License',
				'   4. You must retain, in the Source form of any Derivative Works, all',
				'      copyright notice that is included in or attached to the work',
				'      copyright license to reproduce, prepare Derivative Works of,',
				'      copyright owner or by an individual or Legal Entity authorized to submit',
				'   Copyright [yyyy] [name of copyright owner]',
				'   Copyright {yyyy} {name of copyright owner}',
				'Copyright (C) <year>  <name of author>',
				'copyright on the Program, and are irrevocable provided the stated',
				'copyright in it',
				'Copyright 2021 Example Corporation',
			].join('\n'),
		}),
		[],
		"an Apache body's wrapped copyright notice and its template line name no holder"
	);
	for (const [second, holder] of [
		['Copyright Other Holder Inc.', 'Other Holder Inc'],
		['Portions Copyright (c) Other Holder Inc.', 'Other Holder Inc'],
		['Copyright Notice Holder Inc.', 'Notice Holder Inc'],
		['Copyright (c) 2020 [Other Holder Inc](https://example.com)', 'Other Holder Inc'],
	])
		assert.deepEqual(
			check(notice(good), {
				...tree,
				'packages/a/LICENSE': `Copyright (c) 2019 Example Corporation\n${second}\n`,
			}),
			[`${holderRow} does not name ${holder}, whom packages/a/LICENSE names`],
			`a second holder written as "${second}" is read`
		);
	for (const line of ['Copyright (c) 2020', 'Copyright (c) 2011:'])
		assert.deepEqual(
			check(notice(good), {
				...tree,
				'packages/a/LICENSE': `Copyright (c) 2019 Example Corporation\n${line}\nOther Inc.\n`,
			}),
			[
				'packages/a/LICENSE has a copyright line with no holder on it, which this check cannot read',
			],
			`a holder on the line after ${line}`
		);
	assert.deepEqual(
		check(notice(good), {
			...tree,
			'packages/a/LICENSE': [
				'Copyright (c) 2019 Example Corporation',
				'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND. IN NO EVENT SHALL THE AUTHORS OR',
				'COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY.',
			].join('\n'),
		}),
		[],
		'an MIT disclaimer wrapped at COPYRIGHT HOLDERS names no one'
	);
	assert.deepEqual(
		check(notice(good), { ...tree, 'packages/a/LICENSE': 'Permission is hereby granted.\n' }),
		['packages/a/LICENSE names no copyright holder to check the notice against']
	);

	assert.deepEqual(check('| Path | License |\n|---|---|'), [
		`the notice has no table with the columns ${NOTICE_COLUMNS.join(', ')}`,
	]);
	// A table the rendered notice does not show credits nothing.
	const none = `the notice has no table with the columns ${NOTICE_COLUMNS.join(', ')}`;
	assert.deepEqual(check(`<!--\n${notice(good)}\n-->`), [none]);
	assert.deepEqual(
		check(`Text\n\n${notice(good).replace(/^/gm, '    ')}`),
		[none],
		'a table indented as code'
	);
	assert.deepEqual(
		check(`${notice(good)}\n\t${row('packages/gone')}`),
		[
			'the notice credits packages/gone, which is not in this tree',
			'the notice links packages/gone/LICENSE, which does not exist',
		],
		'a tab-indented line inside the table is still a row'
	);
	assert.deepEqual(check(`\`\`\`md\n${notice(good)}\n\`\`\``), [none]);
	assert.deepEqual(
		check(`Text\n\n<!-- ${notice(good)}`),
		[none],
		'an unclosed comment hides the rest'
	);
	assert.deepEqual(check(`${notice()}\n\n${good}`), [
		'the notice has table rows outside its table',
		'the notice credits no upstream',
		'packages/a/LICENSE is an upstream license that no row of the notice credits',
	]);
	assert.deepEqual(
		check(`Before\n\n\`\`\`sh\nx | y\n\`\`\`\n\n${notice(good)}\n\nAfter.\n`),
		[],
		'prose and a fenced block around the table do not count as rows'
	);
});

test('every imported FAST-AF file is present, recorded and unchanged since review', () => {
	const recorded = new Map(adaptations.files.map((file) => [file.path, file]));
	// Untracked-but-unignored files count; an ignored source file would fail as missing.
	const present = provenancePaths(root, 'fast-af');
	const unrecorded = present.filter((path) => !recorded.has(path));
	assert.deepEqual(unrecorded, [], 'record new FAST-AF files in adaptations.json');
	for (const file of adaptations.files) {
		if (isRemoved(file)) {
			// A removed file's record is kept as history; the file must stay gone.
			assert(
				!present.includes(file.path),
				`${file.path} is back; run scripts/release/provenance.mjs`
			);
			assert.match(
				file.removed?.on ?? '',
				/^\d{4}-\d{2}-\d{2}$/,
				`${file.path} needs a removal date`
			);
			assert(file.removed.reason && file.removed.import_classification, `${file.path} removal`);
			continue;
		}
		assert(existsSync(join(root, file.path)), `missing or ignored: ${file.path}`);
		assert(present.includes(file.path), `not visible to Git (check .gitignore): ${file.path}`);
		const bytes = readFileSync(join(root, file.path));
		assert(matchesRecord(file, bytes), `${file.path} changed; record the adaptation`);
		assert(
			!hasStaleShape(file, bytes),
			`${file.path}: its record's manifest_shape_sha256 is stale; run scripts/release/provenance.mjs`
		);
		if (file.import_classification === 'unchanged-staged')
			assert.equal(file.current_import_sha256, file.staged_sha256, file.path);
		if (file.stage_classification === 'unchanged-upstream')
			assert.equal(file.staged_sha256, file.upstream_sha256, file.path);
		assert(file.import_reason && file.stage_reason, `${file.path} needs reasons`);
	}
	const retiredUpstream = (provenance.retired_units ?? [])
		.map((unit) => unit.upstream_prefix)
		.filter(Boolean);
	const retiredExact = new Set(
		(provenance.retired_units ?? []).flatMap((unit) => unit.upstream_paths ?? [])
	);
	const isRetiredUpstream = (path) =>
		retiredExact.has(path) ||
		retiredUpstream.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
	const accounted = new Set(adaptations.files.map((file) => file.upstream_path).filter(Boolean));
	assert.deepEqual(
		upstream.files
			.map((file) => file.path)
			.filter((path) => !isRetiredUpstream(path) && !accounted.has(path)),
		[],
		'every non-retired selected upstream file maps to an import'
	);
});

test('upstream Git object ids match the bytes of every file imported unchanged', () => {
	// The FAST-AF revision is not in this repository; unchanged bytes still prove the recorded ids.
	const byPath = new Map(upstream.files.map((file) => [file.path, file]));
	let checked = 0;
	for (const file of adaptations.files) {
		if (isRemoved(file)) continue;
		if (!file.upstream_path || file.current_import_sha256 !== file.upstream_sha256) continue;
		const bytes = readFileSync(join(root, file.path));
		assert.equal(blob(bytes), byPath.get(file.upstream_path).git_blob, file.path);
		checked++;
	}
	// After retiring violet-elements from per-file FAST-AF provenance (#1783), 294 non-violet
	// files (fast-element and root files) remained verbatim copies of the selected upstream
	// import. NOTICE.md was then corrected for this repository, which leaves 293.
	// A removed file's record is kept but not counted.
	assert(checked >= 293, `only ${checked} unchanged upstream files`);
});
