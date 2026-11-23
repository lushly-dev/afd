#!/usr/bin/env node
/**
 * Capability manifest validator and parity table renderer (#1738).
 *
 * Single source of truth for per-language AFD capabilities:
 *   spec/capabilities/catalog.json        capability IDs, labels and rendered tables
 *   spec/capabilities/typescript.json     TypeScript status and evidence
 *   spec/capabilities/python.json         Python status and evidence
 *   spec/capabilities/rust.json           Rust status and evidence
 *   spec/capabilities/cpp.json            C++ status and evidence
 *
 * Usage:
 *   node scripts/check-capabilities.mjs           verify manifests, evidence paths and rendered tables
 *   node scripts/check-capabilities.mjs --write   regenerate all marked tables from the manifests
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const STATUS_LABELS = Object.freeze({
	yes: 'Yes',
	partial: 'Partial',
	no: 'No',
	planned: 'Planned',
	deferred: 'Deferred',
	na: 'N/A',
});

const VALID_STATUSES = new Set(Object.keys(STATUS_LABELS));
const VALID_FIELDS = new Set(['status', 'view', 'evidence']);

const MARKER_RE = /<!--\s*generated:capabilities:([^:\s]+):(start|end)\s*-->/g;
const UNESCAPED_PIPE_RE = /(^|[^\\])\|/;

function isPlainObject(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSafeRelative(root, file) {
	if (
		typeof file !== 'string' ||
		!file ||
		file.startsWith('/') ||
		file.includes('\\') ||
		file.includes('..') ||
		/^[A-Za-z]:/.test(file) ||
		isAbsolute(file)
	) {
		return false;
	}
	const resolved = resolve(root, file);
	const rel = relative(resolve(root), resolved);
	return rel !== '' && !isAbsolute(rel) && !rel.startsWith('..') && !rel.startsWith(sep);
}

function readJsonObject(filePath, label, problems) {
	if (!existsSync(filePath)) {
		problems.push(`${label}: file is missing`);
		return null;
	}
	let parsed;
	try {
		parsed = JSON.parse(readFileSync(filePath, 'utf8'));
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		problems.push(`${label}: invalid JSON (${detail})`);
		return null;
	}
	if (!isPlainObject(parsed)) {
		problems.push(`${label}: top-level JSON value must be an object`);
		return null;
	}
	return parsed;
}

function stripPathAnchor(value) {
	return value.replace(/[#?:].*$/, '');
}

function checkCellText(text, where, problems) {
	if (typeof text !== 'string') {
		problems.push(`${where}: must be a string`);
		return;
	}
	if (/[\r\n]/.test(text)) {
		problems.push(`${where}: must be a single line (no newline characters)`);
	}
	if (UNESCAPED_PIPE_RE.test(text)) {
		problems.push(`${where}: contains an unescaped '|' that breaks Markdown table columns`);
	}
}

/** Read doc line-limit policy from `scripts/policy/doc-line-limits.json` when present. */
function readLineLimitPolicy(root) {
	const policyPath = join(root, 'scripts', 'policy', 'doc-line-limits.json');
	if (existsSync(policyPath)) {
		try {
			const policy = JSON.parse(readFileSync(policyPath, 'utf8'));
			if (Number.isInteger(policy?.limit) && policy.limit > 0 && Array.isArray(policy.files)) {
				return { limit: policy.limit, files: new Set(policy.files) };
			}
		} catch {
			// Fall back to default below; check-doc-lines.mjs reports malformed policy JSON.
		}
	}
	return { limit: 1500, files: new Set(['docs/language-parity.md']) };
}

/** Format one status cell from a manifest entry and optional view name. */
export function renderCell(entry, viewName) {
	const label = STATUS_LABELS[entry.status];
	const detail =
		viewName && entry.views && Object.hasOwn(entry.views, viewName)
			? entry.views[viewName]
			: entry.note;
	if (!detail) return label;
	if (detail.startsWith('(')) return `${label} ${detail}`;
	if (/^[,;:.]/.test(detail)) return `${label}${detail}`;
	return `${label}: ${detail}`;
}

/** Render one table definition from the catalog and loaded manifests. */
export function renderTable(table, catalog, manifests) {
	const capById = new Map(catalog.capabilities.map((cap) => [cap.id, cap]));
	const layout = table.layout ?? 'matrix';

	if (layout === 'by-language') {
		const headers = [table.firstColumn ?? 'Language', ...table.columns.map((col) => col.header)];
		const lines = [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`];
		for (const lang of catalog.languages) {
			const manifest = manifests.get(lang.id);
			const rowCells = [lang.displayName];
			for (const col of table.columns) {
				const entry = manifest.capabilities[col.capability];
				const field = col.field ?? 'status';
				if (field === 'evidence') {
					const override =
						col.view && entry.views && Object.hasOwn(entry.views, col.view)
							? entry.views[col.view]
							: null;
					if (override !== null) {
						rowCells.push(override);
					} else {
						rowCells.push(entry.evidence.map((item) => `\`${item}\``).join(', '));
					}
				} else if (field === 'view') {
					const val =
						col.view && entry.views && Object.hasOwn(entry.views, col.view)
							? entry.views[col.view]
							: (entry.note ?? '');
					rowCells.push(val);
				} else {
					rowCells.push(renderCell(entry, col.view));
				}
			}
			lines.push(`| ${rowCells.join(' | ')} |`);
		}
		return lines.join('\n');
	}

	const headers = [
		table.firstColumn ?? 'Capability',
		...catalog.languages.map((lang) => lang.displayName),
	];
	const lines = [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`];
	for (const row of table.rows) {
		const cap = capById.get(row.capability);
		const label = row.label ?? cap.label;
		const cells = [
			label,
			...catalog.languages.map((lang) => {
				const entry = manifests.get(lang.id).capabilities[row.capability];
				return renderCell(entry, row.view);
			}),
		];
		lines.push(`| ${cells.join(' | ')} |`);
	}
	return lines.join('\n');
}

/** Collect every view name declared in `catalog.tables` for each capability id. */
function declaredViewsByCapability(catalog) {
	const map = new Map();
	const record = (capId, view) => {
		if (!view) return;
		if (!map.has(capId)) map.set(capId, new Set());
		map.get(capId).add(view);
	};
	for (const table of catalog.tables) {
		if ((table.layout ?? 'matrix') === 'by-language') {
			for (const col of table.columns ?? []) record(col.capability, col.view);
		} else {
			for (const row of table.rows ?? []) record(row.capability, row.view);
		}
	}
	return map;
}

/** Load and validate catalog + all language manifests. */
export function loadAndValidate(root = REPO_ROOT) {
	const problems = [];
	const capDir = join(root, 'spec', 'capabilities');
	const catalogPath = join(capDir, 'catalog.json');
	const catalog = readJsonObject(catalogPath, 'spec/capabilities/catalog.json', problems);
	if (!catalog) return { catalog: null, manifests: new Map(), problems };

	if (!Array.isArray(catalog.languages) || catalog.languages.length === 0) {
		problems.push('spec/capabilities/catalog.json: "languages" must be a non-empty array');
	}
	if (!Array.isArray(catalog.capabilities) || catalog.capabilities.length === 0) {
		problems.push('spec/capabilities/catalog.json: "capabilities" must be a non-empty array');
	}
	if (!Array.isArray(catalog.tables) || catalog.tables.length === 0) {
		problems.push('spec/capabilities/catalog.json: "tables" must be a non-empty array');
	}
	if (problems.length > 0) return { catalog, manifests: new Map(), problems };

	const langIds = new Set();
	const expectedManifestFiles = new Set(['catalog.json']);
	for (const lang of catalog.languages) {
		if (!isPlainObject(lang) || typeof lang.id !== 'string' || !lang.id) {
			problems.push('spec/capabilities/catalog.json: each language needs a non-empty "id"');
			continue;
		}
		if (typeof lang.displayName !== 'string' || !lang.displayName) {
			problems.push(`spec/capabilities/catalog.json: language "${lang.id}" needs "displayName"`);
		} else {
			checkCellText(lang.displayName, `catalog.json language "${lang.id}" displayName`, problems);
		}
		if (langIds.has(lang.id)) {
			problems.push(`spec/capabilities/catalog.json: duplicate language "${lang.id}"`);
		}
		langIds.add(lang.id);
		expectedManifestFiles.add(`${lang.id}.json`);
	}

	// Refuse untracked/unlisted manifest files in spec/capabilities/ (two-way reconciliation).
	for (const name of readdirSync(capDir)) {
		if (!name.endsWith('.json') || name.endsWith('.schema.json')) continue;
		if (!expectedManifestFiles.has(name)) {
			problems.push(`spec/capabilities/${name}: unexpected JSON file not declared in catalog.json`);
		}
	}

	const capIds = new Set();
	for (const cap of catalog.capabilities) {
		if (!isPlainObject(cap) || typeof cap.id !== 'string' || !cap.id) {
			problems.push('spec/capabilities/catalog.json: each capability needs a non-empty "id"');
			continue;
		}
		if (capIds.has(cap.id)) {
			problems.push(`spec/capabilities/catalog.json: duplicate capability "${cap.id}"`);
		}
		capIds.add(cap.id);
		checkCellText(cap.label, `catalog.json capability "${cap.id}" label`, problems);
	}

	const tableIds = new Set();
	const referencedCaps = new Set();
	for (const table of catalog.tables) {
		if (!isPlainObject(table) || typeof table.id !== 'string' || !table.id) {
			problems.push('spec/capabilities/catalog.json: each table needs a non-empty "id"');
			continue;
		}
		if (tableIds.has(table.id)) {
			problems.push(`spec/capabilities/catalog.json: duplicate table "${table.id}"`);
		}
		tableIds.add(table.id);
		if (!isSafeRelative(root, table.file)) {
			problems.push(`catalog.json table "${table.id}": invalid "file" path`);
		}
		if (table.firstColumn !== undefined) {
			checkCellText(table.firstColumn, `catalog.json table "${table.id}" firstColumn`, problems);
		}
		const layout = table.layout ?? 'matrix';
		if (layout !== 'matrix' && layout !== 'by-language') {
			problems.push(`catalog.json table "${table.id}": unknown layout "${layout}"`);
			continue;
		}
		if (layout === 'by-language') {
			if (!Array.isArray(table.columns) || table.columns.length === 0) {
				problems.push(`catalog.json table "${table.id}": "columns" must be a non-empty array`);
				continue;
			}
			for (const col of table.columns) {
				if (!isPlainObject(col)) {
					problems.push(`catalog.json table "${table.id}": each column must be an object`);
					continue;
				}
				checkCellText(col.header, `catalog.json table "${table.id}" column header`, problems);
				if (col.field !== undefined && !VALID_FIELDS.has(col.field)) {
					problems.push(
						`catalog.json table "${table.id}": column "${col.header}" has invalid field ${JSON.stringify(col.field)} (expected one of ${[...VALID_FIELDS].join(', ')})`
					);
				}
				if (!capIds.has(col.capability)) {
					problems.push(
						`catalog.json table "${table.id}": column "${col.header}" references unknown capability "${col.capability}"`
					);
				} else {
					referencedCaps.add(col.capability);
				}
			}
		} else {
			if (!Array.isArray(table.rows) || table.rows.length === 0) {
				problems.push(`catalog.json table "${table.id}": "rows" must be a non-empty array`);
				continue;
			}
			for (const row of table.rows) {
				if (!isPlainObject(row) || !capIds.has(row.capability)) {
					problems.push(
						`catalog.json table "${table.id}": row references unknown capability "${row?.capability}"`
					);
				} else {
					referencedCaps.add(row.capability);
				}
				if (row?.label !== undefined) {
					checkCellText(
						row.label,
						`catalog.json table "${table.id}" row "${row.capability}" label`,
						problems
					);
				}
			}
		}
	}

	for (const id of capIds) {
		if (!referencedCaps.has(id)) {
			problems.push(
				`spec/capabilities/catalog.json: capability "${id}" is not rendered in any table`
			);
		}
	}

	const declaredViews = declaredViewsByCapability(catalog);
	const manifests = new Map();

	for (const lang of catalog.languages) {
		const rel = `spec/capabilities/${lang.id}.json`;
		const data = readJsonObject(join(root, rel), rel, problems);
		if (!data) continue;
		if (data.language !== lang.id) {
			problems.push(
				`${rel}: "language" must be "${lang.id}", got ${JSON.stringify(data.language)}`
			);
		}
		if (!isPlainObject(data.capabilities)) {
			problems.push(`${rel}: "capabilities" must be an object`);
			continue;
		}
		manifests.set(lang.id, data);

		for (const id of capIds) {
			if (!Object.hasOwn(data.capabilities, id)) {
				problems.push(`${rel}: missing capability "${id}"`);
			}
		}

		for (const [id, entry] of Object.entries(data.capabilities)) {
			const where = `${rel} "${id}"`;
			if (!capIds.has(id)) {
				problems.push(`${where}: unknown capability not listed in catalog.json`);
				continue;
			}
			if (!isPlainObject(entry)) {
				problems.push(`${where}: entry must be an object`);
				continue;
			}
			if (!VALID_STATUSES.has(entry.status)) {
				problems.push(
					`${where}: invalid status ${JSON.stringify(entry.status)} (expected one of ${[...VALID_STATUSES].join(', ')})`
				);
			}
			if (entry.note !== undefined) {
				checkCellText(entry.note, `${where} note`, problems);
			}
			if (!Array.isArray(entry.evidence)) {
				problems.push(`${where}: "evidence" must be an array of repository-relative paths`);
			} else {
				for (const item of entry.evidence) {
					if (typeof item !== 'string' || !item.trim()) {
						problems.push(`${where}: evidence items must be non-empty strings`);
						continue;
					}
					const pathOnly = stripPathAnchor(item);
					if (!isSafeRelative(root, pathOnly) || !existsSync(join(root, pathOnly))) {
						problems.push(`${where}: evidence path "${item}" does not exist`);
					}
				}
				if ((entry.status === 'yes' || entry.status === 'partial') && entry.evidence.length === 0) {
					problems.push(`${where}: status "${entry.status}" requires non-empty "evidence"`);
				}
			}
			if (
				(entry.status === 'planned' || entry.status === 'deferred') &&
				!entry.note &&
				!entry.issue &&
				(!Array.isArray(entry.evidence) || entry.evidence.length === 0)
			) {
				problems.push(
					`${where}: status "${entry.status}" requires a "note", "issue" or "evidence"`
				);
			}
			if (entry.views !== undefined) {
				if (!isPlainObject(entry.views)) {
					problems.push(`${where}: "views" must be an object`);
				} else {
					const allowed = declaredViews.get(id) ?? new Set();
					for (const [viewKey, viewText] of Object.entries(entry.views)) {
						if (!allowed.has(viewKey)) {
							problems.push(
								`${where}: unused view "${viewKey}" (not referenced by any table for "${id}")`
							);
						}
						checkCellText(viewText, `${where} views.${viewKey}`, problems);
					}
				}
			}
		}
	}

	return { catalog, manifests, problems };
}

/** Find all markdown files that could contain capability markers (targets + docs/language-parity.md + spec/*.md). */
function markerScanFiles(root, catalog) {
	const files = new Set(catalog.tables.map((t) => t.file));
	if (existsSync(join(root, 'docs', 'language-parity.md'))) {
		files.add('docs/language-parity.md');
	}
	const specDir = join(root, 'spec');
	if (existsSync(specDir)) {
		for (const name of readdirSync(specDir)) {
			if (name.endsWith('.md')) files.add(`spec/${name}`);
		}
	}
	return [...files].sort();
}

/** Replace or check all generated table regions across target markdown files. */
export function checkCapabilities({ root = REPO_ROOT, write = false } = {}) {
	const { catalog, manifests, problems } = loadAndValidate(root);
	if (problems.length > 0 || !catalog) {
		return {
			problems,
			updated: [],
			stats: { languages: 0, capabilities: 0, tables: 0, files: 0 },
		};
	}

	const linePolicy = readLineLimitPolicy(root);
	const tableById = new Map(catalog.tables.map((t) => [t.id, t]));
	const tablesByFile = new Map();
	for (const table of catalog.tables) {
		if (!tablesByFile.has(table.file)) tablesByFile.set(table.file, []);
		tablesByFile.get(table.file).push(table);
	}

	// Scan for orphan, wrong-file, or duplicate markers in all candidate markdown files.
	const filesWithMarkerErrors = new Set();
	for (const relFile of markerScanFiles(root, catalog)) {
		const absFile = join(root, relFile);
		if (!existsSync(absFile)) {
			if (tablesByFile.has(relFile)) {
				problems.push(`${relFile}: target file is missing`);
				filesWithMarkerErrors.add(relFile);
			}
			continue;
		}
		const content = readFileSync(absFile, 'utf8');
		const seen = new Map();
		for (const match of content.matchAll(MARKER_RE)) {
			const [, id, kind] = match;
			if (!tableById.has(id)) {
				problems.push(`${relFile}: orphan capability marker "${id}" (not in catalog.json)`);
				filesWithMarkerErrors.add(relFile);
				continue;
			}
			const owner = tableById.get(id).file;
			if (owner !== relFile) {
				problems.push(`${relFile}: marker "${id}" belongs to ${owner}, not ${relFile}`);
				filesWithMarkerErrors.add(relFile);
				continue;
			}
			const key = `${id}:${kind}`;
			if (seen.has(key)) {
				problems.push(`${relFile}: duplicate ${kind} marker for "${id}"`);
				filesWithMarkerErrors.add(relFile);
			}
			seen.set(key, match.index);
		}
	}

	const updated = [];

	for (const [relFile, tables] of tablesByFile) {
		const absFile = join(root, relFile);
		if (!existsSync(absFile)) continue;
		const original = readFileSync(absFile, 'utf8');
		const eol = original.includes('\r\n') ? '\r\n' : '\n';
		let current = original.replace(/\r\n/g, '\n');
		let fileHasErrors = filesWithMarkerErrors.has(relFile);

		for (const table of tables) {
			const startTag = `<!-- generated:capabilities:${table.id}:start -->`;
			const endTag = `<!-- generated:capabilities:${table.id}:end -->`;
			const startIndex = current.indexOf(startTag);
			const endIndex = current.indexOf(endTag);
			if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) {
				problems.push(
					`${relFile}: missing or misordered markers for table "${table.id}" (${startTag} ... ${endTag})`
				);
				fileHasErrors = true;
				continue;
			}
			const rendered = renderTable(table, catalog, manifests);
			if (linePolicy.files.has(relFile)) {
				for (const line of rendered.split('\n')) {
					const len = [...line].length;
					if (len > linePolicy.limit) {
						problems.push(
							`${relFile} (table "${table.id}"): rendered line is ${len} characters, over the ${linePolicy.limit}-character doc-line limit (${line.slice(0, 60)}...)`
						);
						fileHasErrors = true;
					}
				}
			}
			const existingBlock = current.slice(startIndex + startTag.length, endIndex);
			const expectedBlock = `\n${rendered}\n`;
			if (existingBlock !== expectedBlock) {
				if (write) {
					current =
						current.slice(0, startIndex + startTag.length) +
						expectedBlock +
						current.slice(endIndex);
				} else {
					problems.push(
						`${relFile}: table "${table.id}" is out of date with spec/capabilities/*.json (run pnpm capabilities:sync)`
					);
				}
			}
		}

		if (write && !fileHasErrors) {
			const nextContent = eol === '\r\n' ? current.replace(/\n/g, '\r\n') : current;
			if (nextContent !== original) {
				writeFileSync(absFile, nextContent, 'utf8');
				updated.push(relFile);
			}
		}
	}

	return {
		problems,
		updated,
		stats: {
			languages: catalog.languages.length,
			capabilities: catalog.capabilities.length,
			tables: catalog.tables.length,
			files: tablesByFile.size,
		},
	};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const write = process.argv.includes('--write');
	const result = checkCapabilities({ root: REPO_ROOT, write });
	for (const file of result.updated) {
		console.log(`  ✎ Updated ${file}`);
	}
	if (result.problems.length > 0) {
		for (const problem of result.problems) {
			console.error(`check-capabilities: ${problem}`);
		}
		console.error(`check-capabilities: ${result.problems.length} problem(s)`);
		process.exit(1);
	}
	const { languages, capabilities, tables, files } = result.stats;
	console.log(
		`check-capabilities: ${languages} languages, ${capabilities} capabilities, ${tables} tables in ${files} files ok`
	);
}
