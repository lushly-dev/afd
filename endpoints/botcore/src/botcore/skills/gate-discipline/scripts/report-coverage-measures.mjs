#!/usr/bin/env node
/**
 * Reads coverage artifacts and emits a Health `schema_version = "1.0"` measures file.
 *
 * Supports Istanbul `coverage-summary.json`, Istanbul/Vitest `coverage-final.json`,
 * Python `coverage.py` JSON (`coverage.json`), and LCOV (`lcov.info`, both summary tags
 * and DA/FNDA/BRDA detail records). Aggregates weighted repository totals plus per-unit
 * line/statement/branch/function percentages.
 *
 * Refuses an empty input set or zero measurable totals (exit 1) unless `--allow-empty`
 * is explicitly passed, so a broken coverage artifact fails loudly rather than silently
 * writing empty measures.
 *
 * Needs only Node. Usage:
 *   node report-coverage-measures.mjs [--root <dir>] [--input [<unit>=]<path>]...
 *                                     [--scan] [--target <id>] [--allow-empty]
 *                                     [--json] [--measures-out <file>]
 */
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MEASURES_SCHEMA_VERSION = '1.0';
const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const SKIP_SCAN_DIRS = new Set([
	'.git',
	'node_modules',
	'dist',
	'build',
	'target',
	'.venv',
	'venv',
	'__pycache__',
	'.pytest_cache',
	'.vitest',
	'vendor',
]);
const COVERAGE_FILENAMES = [
	'coverage-summary.json',
	'coverage-final.json',
	'coverage.json',
	'lcov.info',
];

function roundPct(covered, total) {
	if (total <= 0) return null;
	return Math.round((covered / total) * 10000) / 100;
}

function emptyMetric() {
	return { covered: 0, total: 0 };
}

function validateCounter(value, label) {
	if (
		typeof value !== 'number' ||
		!Number.isInteger(value) ||
		value < 0 ||
		value > Number.MAX_SAFE_INTEGER
	) {
		throw new Error(`Invalid coverage counter for ${label}: ${value}`);
	}
	return value;
}

function validatedMetric(covered, total, label) {
	const c = validateCounter(covered, `${label}.covered`);
	const t = validateCounter(total, `${label}.total`);
	if (c > t) {
		throw new Error(`Invalid coverage counter for ${label}: covered (${c}) exceeds total (${t}).`);
	}
	return { covered: c, total: t };
}

function addMetric(target, delta) {
	if (!delta || delta.total <= 0) return;
	target.covered += delta.covered;
	target.total += delta.total;
}

/** Parse Istanbul `coverage-summary.json` (`total.{lines,statements,branches,functions}`). */
function parseIstanbulSummary(data) {
	const t = data.total;
	const metric = (row, name) =>
		row && typeof row === 'object' && 'total' in row && 'covered' in row
			? validatedMetric(row.covered, row.total, name)
			: emptyMetric();
	return {
		format: 'istanbul-summary',
		lines: metric(t.lines, 'lines'),
		statements: metric(t.statements, 'statements'),
		branches: metric(t.branches, 'branches'),
		functions: metric(t.functions, 'functions'),
	};
}

/** Parse Istanbul/Vitest `coverage-final.json` (per-file statement/fn/branch maps). */
function parseIstanbulFinal(data) {
	const lines = emptyMetric();
	const statements = emptyMetric();
	const branches = emptyMetric();
	const functions = emptyMetric();
	for (const entry of Object.values(data)) {
		if (!entry || typeof entry !== 'object') continue;
		const s = entry.s ?? {};
		const sMap = entry.statementMap ?? {};
		const lineHits = new Map();
		for (const [id, count] of Object.entries(s)) {
			if (typeof count !== 'number') continue;
			validateCounter(count, `statement[${id}]`);
			statements.total += 1;
			if (count > 0) statements.covered += 1;
			const line = sMap[id]?.start?.line;
			if (typeof line === 'number') {
				lineHits.set(line, Math.max(lineHits.get(line) ?? 0, count));
			}
		}
		for (const hits of lineHits.values()) {
			lines.total += 1;
			if (hits > 0) lines.covered += 1;
		}
		const f = entry.f ?? {};
		for (const [id, count] of Object.entries(f)) {
			if (typeof count !== 'number') continue;
			validateCounter(count, `function[${id}]`);
			functions.total += 1;
			if (count > 0) functions.covered += 1;
		}
		const b = entry.b ?? {};
		for (const [id, counts] of Object.entries(b)) {
			if (!Array.isArray(counts)) continue;
			for (const count of counts) {
				if (typeof count !== 'number') continue;
				validateCounter(count, `branch[${id}]`);
				branches.total += 1;
				if (count > 0) branches.covered += 1;
			}
		}
	}
	return { format: 'istanbul-final', lines, statements, branches, functions };
}

/** Parse Python `coverage.py` JSON (`totals.{covered_lines,num_statements,num_branches,...}`). */
function parseCoveragePy(data) {
	const t = data.totals;
	const statements =
		'num_statements' in t && 'covered_lines' in t
			? validatedMetric(t.covered_lines, t.num_statements, 'statements')
			: emptyMetric();
	const branches =
		'num_branches' in t && 'covered_branches' in t
			? validatedMetric(t.covered_branches, t.num_branches, 'branches')
			: emptyMetric();
	return {
		format: 'coverage-py',
		lines: { ...statements },
		statements,
		branches,
		functions: emptyMetric(),
	};
}

function parseLcovInt(raw, label) {
	if (!/^\d+$/.test(raw.trim())) throw new Error(`Invalid LCOV ${label} counter: ${raw}`);
	return validateCounter(Number(raw.trim()), label);
}

/** Parse LCOV (`lcov.info`), using summary counters when present or deriving from DA/FNDA/BRDA. */
export function parseLcov(text) {
	const lines = emptyMetric();
	const branches = emptyMetric();
	const functions = emptyMetric();
	let sawRecord = false;

	let rec = null;
	const startRecord = () => {
		sawRecord = true;
		rec = {
			lf: null,
			lh: null,
			brf: null,
			brh: null,
			fnf: null,
			fnh: null,
			da: new Map(),
			fnda: new Map(),
			brdaTotal: 0,
			brdaCovered: 0,
		};
	};
	const flushRecord = () => {
		if (!rec) return;
		if (rec.lf !== null || rec.lh !== null) {
			addMetric(lines, validatedMetric(rec.lh ?? 0, rec.lf ?? 0, 'lcov.lines'));
		} else if (rec.da.size > 0) {
			let covered = 0;
			for (const hits of rec.da.values()) if (hits > 0) covered += 1;
			addMetric(lines, { covered, total: rec.da.size });
		}
		if (rec.brf !== null || rec.brh !== null) {
			addMetric(branches, validatedMetric(rec.brh ?? 0, rec.brf ?? 0, 'lcov.branches'));
		} else if (rec.brdaTotal > 0) {
			addMetric(branches, { covered: rec.brdaCovered, total: rec.brdaTotal });
		}
		if (rec.fnf !== null || rec.fnh !== null) {
			addMetric(functions, validatedMetric(rec.fnh ?? 0, rec.fnf ?? 0, 'lcov.functions'));
		} else if (rec.fnda.size > 0) {
			let covered = 0;
			for (const hits of rec.fnda.values()) if (hits > 0) covered += 1;
			addMetric(functions, { covered, total: rec.fnda.size });
		}
		rec = null;
	};

	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line) continue;
		if (line.startsWith('SF:')) {
			flushRecord();
			startRecord();
		} else if (line === 'end_of_record') {
			flushRecord();
		} else if (rec) {
			if (line.startsWith('LF:')) rec.lf = parseLcovInt(line.slice(3), 'LF');
			else if (line.startsWith('LH:')) rec.lh = parseLcovInt(line.slice(3), 'LH');
			else if (line.startsWith('BRF:')) rec.brf = parseLcovInt(line.slice(4), 'BRF');
			else if (line.startsWith('BRH:')) rec.brh = parseLcovInt(line.slice(4), 'BRH');
			else if (line.startsWith('FNF:')) rec.fnf = parseLcovInt(line.slice(4), 'FNF');
			else if (line.startsWith('FNH:')) rec.fnh = parseLcovInt(line.slice(4), 'FNH');
			else if (line.startsWith('DA:')) {
				const parts = line.slice(3).split(',');
				if (parts.length >= 2) {
					const lineNo = parseLcovInt(parts[0], 'DA.line');
					const hits = parseLcovInt(parts[1], 'DA.hits');
					rec.da.set(lineNo, Math.max(rec.da.get(lineNo) ?? 0, hits));
				}
			} else if (line.startsWith('FNDA:')) {
				const comma = line.indexOf(',', 5);
				if (comma > 5) {
					const hits = parseLcovInt(line.slice(5, comma), 'FNDA.hits');
					const fnName = line.slice(comma + 1);
					rec.fnda.set(fnName, Math.max(rec.fnda.get(fnName) ?? 0, hits));
				}
			} else if (line.startsWith('BRDA:')) {
				const parts = line.slice(5).split(',');
				if (parts.length >= 4) {
					rec.brdaTotal += 1;
					const taken = parts[3].trim();
					if (taken !== '-' && parseLcovInt(taken, 'BRDA.taken') > 0) rec.brdaCovered += 1;
				}
			}
		}
	}
	flushRecord();
	if (!sawRecord) throw new Error('Input is not a valid LCOV file (no SF: records found).');
	return { format: 'lcov', lines, statements: emptyMetric(), branches, functions };
}

/** Parse one coverage artifact file (JSON or LCOV). */
export function parseCoverageFile(filePath) {
	const text = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
	const name = basename(filePath).toLowerCase();
	if (name.endsWith('.info') || name.endsWith('.lcov')) {
		return parseLcov(text);
	}
	let data;
	try {
		data = JSON.parse(text);
	} catch (cause) {
		throw new Error(`Invalid JSON coverage file ${filePath}: ${cause.message}`);
	}
	if (!data || typeof data !== 'object' || Array.isArray(data)) {
		throw new Error(`Coverage file ${filePath} must contain a JSON object.`);
	}
	if (data.total && typeof data.total === 'object' && 'lines' in data.total) {
		return parseIstanbulSummary(data);
	}
	if (data.totals && typeof data.totals === 'object' && 'num_statements' in data.totals) {
		return parseCoveragePy(data);
	}
	const values = Object.values(data);
	if (values.length > 0 && values.every((v) => v && typeof v === 'object' && 's' in v)) {
		return parseIstanbulFinal(data);
	}
	throw new Error(`Unrecognized coverage JSON format in ${filePath}.`);
}

/** Derive a stable Health identifier slug for a unit from its path relative to `root`. */
export function unitSlug(root, filePath) {
	let rel = relative(root, dirname(filePath)).replaceAll('\\', '/');
	rel = rel.replace(/(?:^|\/)coverage$/i, '').replace(/^\/+|\/+$/g, '');
	if (!rel || rel === '.') return 'root';
	const slug = rel
		.replaceAll('/', '.')
		.replace(/[^a-zA-Z0-9._-]+/g, '-')
		.replace(/^[^a-zA-Z0-9]+/, '');
	return slug || 'unit';
}

function resolveCoverageTarget(resolvedRoot, inputPath) {
	const full = resolve(resolvedRoot, inputPath);
	if (!existsSync(full)) throw new Error(`Coverage input not found: ${inputPath}`);
	if (statSync(full).isDirectory()) {
		for (const candidate of COVERAGE_FILENAMES) {
			const direct = join(full, candidate);
			if (existsSync(direct)) return direct;
			const nested = join(full, 'coverage', candidate);
			if (existsSync(nested)) return nested;
		}
		throw new Error(`No recognized coverage artifact found in directory: ${inputPath}`);
	}
	return full;
}

/** Recursively discover coverage artifacts under `root`, preferring summary over final per dir. */
export function scanCoverageFiles(root) {
	const found = [];
	const walk = (dir) => {
		const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
			a.name.localeCompare(b.name)
		);
		const filesInDir = new Set(entries.filter((e) => e.isFile()).map((e) => e.name));
		for (const preferred of COVERAGE_FILENAMES) {
			if (filesInDir.has(preferred)) {
				found.push(join(dir, preferred));
				break;
			}
		}
		for (const entry of entries) {
			if (!entry.isDirectory() || SKIP_SCAN_DIRS.has(entry.name)) continue;
			walk(join(dir, entry.name));
		}
	};
	walk(resolve(root));
	return found;
}

/** Read all selected coverage inputs and compute per-unit and aggregate totals. */
export function reportCoverageMeasures({
	root = process.cwd(),
	inputs = [],
	scan = false,
	allowEmpty = false,
} = {}) {
	const resolvedRoot = resolve(root);
	const pairs = [];
	for (const spec of inputs) {
		const eq = spec.indexOf('=');
		if (eq > 0 && !spec.slice(0, eq).includes('/') && !spec.slice(0, eq).includes('\\')) {
			const unit = spec.slice(0, eq);
			if (!IDENTIFIER.test(unit)) throw new Error(`Invalid unit identifier: ${unit}`);
			pairs.push({ unit, path: resolveCoverageTarget(resolvedRoot, spec.slice(eq + 1)) });
		} else {
			const path = resolveCoverageTarget(resolvedRoot, spec);
			pairs.push({ unit: unitSlug(resolvedRoot, path), path });
		}
	}
	if (scan) {
		const seenPaths = new Set(pairs.map((p) => p.path));
		for (const path of scanCoverageFiles(resolvedRoot)) {
			if (seenPaths.has(path)) continue;
			pairs.push({ unit: unitSlug(resolvedRoot, path), path });
		}
	}
	if (pairs.length === 0 && !allowEmpty) {
		throw new Error(
			'No coverage artifacts found. Pass --input <path> or --scan after running coverage, or pass --allow-empty.'
		);
	}
	const seenUnits = new Set();
	const units = [];
	const aggregate = {
		lines: emptyMetric(),
		statements: emptyMetric(),
		branches: emptyMetric(),
		functions: emptyMetric(),
	};
	for (const { unit, path } of pairs) {
		if (seenUnits.has(unit)) {
			throw new Error(`Duplicate coverage unit identifier "${unit}" (${path}).`);
		}
		seenUnits.add(unit);
		const parsed = parseCoverageFile(path);
		addMetric(aggregate.lines, parsed.lines);
		addMetric(aggregate.statements, parsed.statements);
		addMetric(aggregate.branches, parsed.branches);
		addMetric(aggregate.functions, parsed.functions);
		units.push({
			unit,
			path,
			format: parsed.format,
			lines: { ...parsed.lines, pct: roundPct(parsed.lines.covered, parsed.lines.total) },
			statements: {
				...parsed.statements,
				pct: roundPct(parsed.statements.covered, parsed.statements.total),
			},
			branches: {
				...parsed.branches,
				pct: roundPct(parsed.branches.covered, parsed.branches.total),
			},
			functions: {
				...parsed.functions,
				pct: roundPct(parsed.functions.covered, parsed.functions.total),
			},
		});
	}
	const hasAnyMetric =
		aggregate.lines.total > 0 ||
		aggregate.statements.total > 0 ||
		aggregate.branches.total > 0 ||
		aggregate.functions.total > 0;
	if (!hasAnyMetric && !allowEmpty) {
		throw new Error(
			'Parsed coverage artifacts contain zero coverable lines, statements, branches or functions; pass --allow-empty to emit an empty measures list.'
		);
	}
	return {
		unitCount: units.length,
		aggregate: {
			lines: { ...aggregate.lines, pct: roundPct(aggregate.lines.covered, aggregate.lines.total) },
			statements: {
				...aggregate.statements,
				pct: roundPct(aggregate.statements.covered, aggregate.statements.total),
			},
			branches: {
				...aggregate.branches,
				pct: roundPct(aggregate.branches.covered, aggregate.branches.total),
			},
			functions: {
				...aggregate.functions,
				pct: roundPct(aggregate.functions.covered, aggregate.functions.total),
			},
		},
		units,
	};
}

/** Build a Health 1.0 measures document from a coverage report. */
export function toMeasuresDocument(report, { source = 'coverage', target } = {}) {
	if (target !== undefined && !IDENTIFIER.test(target)) {
		throw new Error(`Invalid measure target identifier: ${target}`);
	}
	if (!IDENTIFIER.test(source)) {
		throw new Error(`Invalid measure source identifier: ${source}`);
	}
	const measures = [];
	const aggSpecs = [
		['coverage_lines_pct', 'Line coverage', report.aggregate.lines.pct],
		['coverage_statements_pct', 'Statement coverage', report.aggregate.statements.pct],
		['coverage_branches_pct', 'Branch coverage', report.aggregate.branches.pct],
		['coverage_functions_pct', 'Function coverage', report.aggregate.functions.pct],
	];
	for (const [key, label, value] of aggSpecs) {
		if (value === null) continue;
		measures.push({ key, label, value, unit: 'percent', direction: 'higher_is_better' });
	}
	for (const entry of report.units) {
		const unitSpecs = [
			['coverage_lines', 'Line coverage', entry.lines.pct],
			['coverage_statements', 'Statement coverage', entry.statements.pct],
			['coverage_branches', 'Branch coverage', entry.branches.pct],
			['coverage_functions', 'Function coverage', entry.functions.pct],
		];
		for (const [prefix, label, value] of unitSpecs) {
			if (value === null) continue;
			measures.push({
				key: `${prefix}.${entry.unit}`,
				label: `${label} (${entry.unit})`,
				value,
				unit: 'percent',
				direction: 'higher_is_better',
			});
		}
	}
	return {
		schema_version: MEASURES_SCHEMA_VERSION,
		source,
		...(target !== undefined ? { target } : {}),
		measures,
	};
}

export function formatReport(report) {
	const fmt = (m) => (m.pct === null ? 'n/a' : `${m.pct.toFixed(2)}% (${m.covered}/${m.total})`);
	const lines = [
		`Coverage measures (${report.unitCount} ${report.unitCount === 1 ? 'unit' : 'units'}):`,
		`  lines: ${fmt(report.aggregate.lines)}`,
		`  statements: ${fmt(report.aggregate.statements)}`,
		`  branches: ${fmt(report.aggregate.branches)}`,
		`  functions: ${fmt(report.aggregate.functions)}`,
	];
	if (report.units.length > 0) {
		lines.push('', 'Per unit:');
		for (const u of report.units) {
			lines.push(
				`  ${u.unit} [${u.format}]: lines ${fmt(u.lines)}, branches ${fmt(u.branches)}, functions ${fmt(u.functions)}`
			);
		}
	}
	return lines.join('\n');
}

function requireValue(argv, index, flag) {
	const value = argv[index + 1];
	if (value === undefined || value.trim() === '') {
		throw new Error(`${flag} requires a non-empty value.`);
	}
	return value;
}

function parseArguments(argv) {
	const options = { inputs: [] };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--root') options.root = resolve(requireValue(argv, i++, arg));
		else if (arg === '--input') options.inputs.push(requireValue(argv, i++, arg));
		else if (arg === '--scan') options.scan = true;
		else if (arg === '--allow-empty') options.allowEmpty = true;
		else if (arg === '--target') options.target = requireValue(argv, i++, arg);
		else if (arg === '--measures-out') options.measuresOut = resolve(requireValue(argv, i++, arg));
		else if (arg === '--json') options.json = true;
		else throw new Error(`Unknown argument ${arg}.`);
	}
	return options;
}

if (
	process.argv[1] &&
	realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
	try {
		const options = parseArguments(process.argv.slice(2));
		const report = reportCoverageMeasures(options);
		if (options.measuresOut) {
			const doc = toMeasuresDocument(report, { target: options.target });
			mkdirSync(dirname(options.measuresOut), { recursive: true });
			writeFileSync(options.measuresOut, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
		}
		console.log(options.json ? JSON.stringify(report, null, 2) : formatReport(report));
	} catch (cause) {
		console.error(cause instanceof Error ? cause.message : String(cause));
		process.exitCode = 1;
	}
}
