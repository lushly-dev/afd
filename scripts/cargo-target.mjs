/**
 * Resolves Cargo's effective output directories (`target-dir` and `build-dir`) for a workspace,
 * following Cargo's own precedence: environment variables, then nearest `.cargo/config` or
 * `.cargo/config.toml` walking up from the invocation directory, then `$CARGO_HOME/config[.toml]`.
 *
 * Used by Umbel launchers (`scripts/umbel-components.mjs`, `scripts/build-site-umbel.mjs`),
 * `scripts/rust-sweep.mjs`, and `scripts/affected.mjs`'s Rust disk-floor preflight (#2241).
 */
import { existsSync, readFileSync, statfsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

const CONFIG_NAMES = ['config', 'config.toml'];
const MAX_INCLUDE_DEPTH = 10;
const GIB = 1024 ** 3;
export const DEFAULT_VERIFY_MIN_DISK_GB = 15;

/**
 * Zero-dependency TOML subset reader for Cargo config files (`include`, `[build] target-dir`,
 * `[build] build-dir`, dotted `build.*`, and inline `build = { ... }`). `scripts/affected.mjs`
 * imports this module and runs in `queue.yml` on bare checkouts without `node_modules`.
 */
export function parseCargoConfigToml(source) {
	const text = source.startsWith('\uFEFF') ? source.slice(1) : source;
	let pos = 0;
	const len = text.length;

	const skipInlineWs = () => {
		while (pos < len && (text[pos] === ' ' || text[pos] === '\t')) pos += 1;
	};
	const skipWsAndComments = () => {
		while (pos < len) {
			const ch = text[pos];
			if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
				pos += 1;
			} else if (ch === '#') {
				while (pos < len && text[pos] !== '\n') pos += 1;
			} else {
				break;
			}
		}
	};
	const skipToLineEnd = () => {
		while (pos < len && text[pos] !== '\n') pos += 1;
		if (pos < len) pos += 1;
	};

	const readBasicString = (multiline) => {
		pos += multiline ? 3 : 1;
		if (multiline) {
			if (text[pos] === '\r' && text[pos + 1] === '\n') pos += 2;
			else if (text[pos] === '\n') pos += 1;
		}
		let out = '';
		while (pos < len) {
			if (multiline && text.startsWith('"""', pos)) {
				let quotes = 0;
				while (text[pos + quotes] === '"') quotes += 1;
				if (quotes > 5) throw new Error('too many quotes in multiline string');
				out += '"'.repeat(quotes - 3);
				pos += quotes;
				return out;
			}
			const ch = text[pos];
			if (!multiline && ch === '"') {
				pos += 1;
				return out;
			}
			if (!multiline && (ch === '\n' || ch === '\r')) throw new Error('unterminated string');
			if (ch === '\\') {
				pos += 1;
				const esc = text[pos];
				if (esc === undefined) throw new Error('unterminated escape');
				if (multiline && (esc === '\n' || esc === '\r' || esc === ' ' || esc === '\t')) {
					while (pos < len && (text[pos] === ' ' || text[pos] === '\t')) pos += 1;
					if (text[pos] !== '\r' && text[pos] !== '\n')
						throw new Error('line-ending backslash must be followed by a newline');
					if (text[pos] === '\r') pos += 1;
					if (text[pos] === '\n') pos += 1;
					while (pos < len && ' \t\r\n'.includes(text[pos])) pos += 1;
					continue;
				}
				pos += 1;
				if (esc === 'b') out += '\b';
				else if (esc === 't') out += '\t';
				else if (esc === 'n') out += '\n';
				else if (esc === 'f') out += '\f';
				else if (esc === 'r') out += '\r';
				else if (esc === '"' || esc === '\\') out += esc;
				else if (esc === 'u' || esc === 'U') {
					const width = esc === 'u' ? 4 : 8;
					const hex = text.slice(pos, pos + width);
					if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length !== width) throw new Error('bad unicode');
					out += String.fromCodePoint(Number.parseInt(hex, 16));
					pos += width;
				} else throw new Error(`bad escape \\${esc}`);
			} else {
				out += ch;
				pos += 1;
			}
		}
		throw new Error('unterminated string');
	};

	const readLiteralString = (multiline) => {
		pos += multiline ? 3 : 1;
		if (multiline) {
			if (text[pos] === '\r' && text[pos + 1] === '\n') pos += 2;
			else if (text[pos] === '\n') pos += 1;
		}
		const end = text.indexOf(multiline ? "'''" : "'", pos);
		if (end === -1) throw new Error('unterminated literal string');
		let out = text.slice(pos, end);
		if (!multiline && (out.includes('\n') || out.includes('\r')))
			throw new Error('unterminated literal string');
		if (multiline) {
			let quotes = 0;
			while (text[end + quotes] === "'") quotes += 1;
			if (quotes > 5) throw new Error('too many quotes in multiline literal string');
			out += "'".repeat(quotes - 3);
			pos = end + quotes;
			return out;
		}
		pos = end + 1;
		return out;
	};

	const readKeyPart = () => {
		skipInlineWs();
		if (text[pos] === '"') return readBasicString(false);
		if (text[pos] === "'") return readLiteralString(false);
		const start = pos;
		while (pos < len && /[A-Za-z0-9_-]/.test(text[pos])) pos += 1;
		if (pos === start) throw new Error('expected key');
		return text.slice(start, pos);
	};

	const readKeyPath = () => {
		const parts = [readKeyPart()];
		for (;;) {
			skipInlineWs();
			if (text[pos] !== '.') break;
			pos += 1;
			parts.push(readKeyPart());
		}
		return parts;
	};

	const readValue = () => {
		skipWsAndComments();
		if (text.startsWith('"""', pos)) return readBasicString(true);
		if (text[pos] === '"') return readBasicString(false);
		if (text.startsWith("'''", pos)) return readLiteralString(true);
		if (text[pos] === "'") return readLiteralString(false);
		if (text[pos] === '[') {
			pos += 1;
			const items = [];
			for (;;) {
				skipWsAndComments();
				if (pos >= len) throw new Error('unterminated array');
				if (text[pos] === ']') {
					pos += 1;
					return items;
				}
				items.push(readValue());
				skipWsAndComments();
				if (text[pos] === ',') pos += 1;
				else if (text[pos] === ']') {
					pos += 1;
					return items;
				} else throw new Error('expected , or ]');
			}
		}
		if (text[pos] === '{') {
			pos += 1;
			const obj = {};
			for (;;) {
				skipWsAndComments();
				if (pos >= len) throw new Error('unterminated inline table');
				if (text[pos] === '}') {
					pos += 1;
					return obj;
				}
				const path = readKeyPath();
				skipWsAndComments();
				if (text[pos] !== '=') throw new Error('expected =');
				pos += 1;
				const val = readValue();
				if (path.length === 1) obj[path[0]] = val;
				skipWsAndComments();
				if (text[pos] === ',') pos += 1;
				else if (text[pos] === '}') {
					pos += 1;
					return obj;
				} else throw new Error('expected , or }');
			}
		}
		const start = pos;
		while (pos < len && !' \t\r\n#,]}'.includes(text[pos])) pos += 1;
		if (pos === start) throw new Error('expected value');
		const raw = text.slice(start, pos);
		// TOML 1.0 space-separated datetime (e.g. `2024-01-01 12:00:00Z`).
		if (/^\d{4}-\d{2}-\d{2}$/.test(raw) && text[pos] === ' ' && /\d/.test(text[pos + 1] ?? '')) {
			pos += 1;
			while (pos < len && !' \t\r\n#,]}'.includes(text[pos])) pos += 1;
			return null;
		}
		if (raw === 'true') return true;
		if (raw === 'false') return false;
		// Non-string/non-boolean bare scalars (numbers, dates) are returned as null so callers
		// expecting strings never confuse e.g. `target-dir = 123` with a string path.
		return null;
	};

	const data = {};
	let section = '';
	let currentIncludeEntry = null;
	const setBuildField = (field, value) => {
		if (field !== 'target-dir' && field !== 'build-dir') return;
		if (!data.build) data.build = {};
		data.build[field] = value;
	};

	while (pos < len) {
		skipWsAndComments();
		if (pos >= len) break;
		if (text[pos] === '[') {
			const arrayTable = text[pos + 1] === '[';
			pos += arrayTable ? 2 : 1;
			const path = readKeyPath();
			skipInlineWs();
			currentIncludeEntry = null;
			if (arrayTable) {
				if (!text.startsWith(']]', pos)) throw new Error('expected ]]');
				pos += 2;
				if (path.length === 1 && path[0] === 'include') {
					if (!Array.isArray(data.include)) data.include = [];
					currentIncludeEntry = {};
					data.include.push(currentIncludeEntry);
					section = '[[include]]';
				} else {
					section = null;
				}
			} else {
				if (text[pos] !== ']') throw new Error('expected ]');
				pos += 1;
				section = path.join('.');
			}
			skipInlineWs();
			if (pos < len && text[pos] !== '\n' && text[pos] !== '\r' && text[pos] !== '#')
				throw new Error('unexpected trailing tokens after table header');
			skipToLineEnd();
			continue;
		}
		const path = readKeyPath();
		skipInlineWs();
		if (text[pos] !== '=') throw new Error('expected =');
		pos += 1;
		const value = readValue();
		skipInlineWs();
		if (pos < len && text[pos] !== '\n' && text[pos] !== '\r' && text[pos] !== '#')
			throw new Error('unexpected trailing tokens after value');
		skipToLineEnd();

		if (section === '') {
			if (path.length === 1 && path[0] === 'include') data.include = value;
			else if (path.length === 1 && path[0] === 'build' && value && typeof value === 'object') {
				for (const field of ['target-dir', 'build-dir']) {
					if (field in value) setBuildField(field, value[field]);
				}
			} else if (path.length === 2 && path[0] === 'build') setBuildField(path[1], value);
		} else if (section === 'build' && path.length === 1) {
			setBuildField(path[0], value);
		} else if (section === '[[include]]' && currentIncludeEntry && path.length === 1) {
			currentIncludeEntry[path[0]] = value;
		}
	}
	return data;
}

/** Cargo's home directory: `$CARGO_HOME`, else `<home>/.cargo`, or null when no home is given. */
export function cargoHome(env = process.env, homeDir = defaultHomeDir(env)) {
	const explicit = env.CARGO_HOME?.trim();
	if (explicit) return resolve(explicit);
	return homeDir ? join(resolve(homeDir), '.cargo') : null;
}

/**
 * Default home directory for Cargo config lookup: `os.homedir()` for the live process environment,
 * or `env.HOME` / `env.USERPROFILE` when a caller passes a synthetic environment in tests so the
 * host's `~/.cargo/config.toml` does not leak into isolated fixtures.
 */
function defaultHomeDir(env) {
	if (env === process.env) return homedir();
	const explicit = env.HOME?.trim() || env.USERPROFILE?.trim();
	return explicit || null;
}

function configInFolder(cargoDir) {
	for (const name of CONFIG_NAMES) {
		const candidate = join(cargoDir, name);
		if (existsSync(candidate)) return candidate;
	}
	return null;
}

function normalizeIncludes(value) {
	const items = Array.isArray(value) ? value : value != null ? [value] : [];
	const found = [];
	for (const item of items) {
		if (typeof item === 'string') found.push({ path: item, optional: false });
		else if (item && typeof item === 'object' && typeof item.path === 'string') {
			found.push({ path: item.path, optional: Boolean(item.optional) });
		}
	}
	return found;
}

/**
 * Cargo resolves relative paths in a config file against the parent of the directory holding the
 * config file (`dirname(dirname(configPath))`), both for `.cargo/config.toml` and for
 * `$CARGO_HOME/config.toml` (matching Cargo's config-relative path rules and `botcore`'s cargo.py).
 */
function configBase(configPath) {
	return dirname(dirname(configPath));
}

function readConfigFile(filePath, seen, depth) {
	const key = resolve(filePath);
	if (seen.has(key) || depth > MAX_INCLUDE_DEPTH) return {};
	seen.add(key);
	let data;
	try {
		data = parseCargoConfigToml(readFileSync(key, 'utf8'));
	} catch {
		return {};
	}
	const merged = {};
	for (const include of normalizeIncludes(data.include)) {
		if (!include.path.endsWith('.toml')) continue;
		const included = resolve(dirname(key), include.path);
		if (!existsSync(included)) continue;
		Object.assign(merged, readConfigFile(included, seen, depth + 1));
	}
	const build = data.build;
	if (build && typeof build === 'object' && !Array.isArray(build)) {
		for (const field of ['target-dir', 'build-dir']) {
			const value = build[field];
			if (typeof value === 'string' && value.trim()) {
				merged[field] = { value: value.trim(), base: configBase(key), source: key };
			}
		}
	}
	return merged;
}

/**
 * Cargo reads every ancestor's `.cargo/`, then `$CARGO_HOME`. A `ceiling` (a test's scratch root)
 * is the last ancestor read, so a test under a home directory with its own `~/.cargo/config.toml`
 * reads only the configs it wrote (#2745). Cargo itself has no ceiling: callers outside tests
 * leave it unset.
 */
function configChain(startDir, env, homeDir, ceiling = null) {
	const files = [];
	const seen = new Set();
	const top = ceiling ? resolve(ceiling) : null;
	let current = resolve(startDir);
	for (;;) {
		const found = configInFolder(join(current, '.cargo'));
		if (found) {
			const key = resolve(found);
			if (!seen.has(key)) {
				seen.add(key);
				files.push(key);
			}
		}
		const parent = dirname(current);
		if (parent === current || current === top) break;
		current = parent;
	}
	const home = cargoHome(env, homeDir);
	if (home) {
		const found = configInFolder(home);
		if (found) {
			const key = resolve(found);
			if (!seen.has(key)) files.push(key);
		}
	}
	return files;
}

/**
 * Nearest `[build]` `target-dir` and `build-dir` from Cargo's config search chain starting at
 * `cwd` (defaulting to `workspaceDir`). Nearest file wins per key.
 */
export function readCargoBuildConfig(
	workspaceDir,
	{ cwd = workspaceDir, env = process.env, homeDir = defaultHomeDir(env), ceiling = null } = {}
) {
	const result = { targetDir: null, buildDir: null };
	for (const file of configChain(cwd, env, homeDir, ceiling)) {
		const parsed = readConfigFile(file, new Set(), 0);
		if (!result.targetDir && parsed['target-dir']) result.targetDir = parsed['target-dir'];
		if (!result.buildDir && parsed['build-dir']) result.buildDir = parsed['build-dir'];
		if (result.targetDir && result.buildDir) break;
	}
	return result;
}

function resolveTemplateDir(template, baseDir, workspaceDir, env, homeDir) {
	const home = cargoHome(env, homeDir) ?? join(resolve(workspaceDir), '.cargo');
	let text = template
		.replaceAll('{cargo-cache-home}', home)
		.replaceAll('{workspace-root}', resolve(workspaceDir));
	const hashIndex = text.indexOf('{workspace-path-hash}');
	let strippedHash = false;
	if (hashIndex !== -1) {
		text = text.slice(0, hashIndex);
		strippedHash = true;
	}
	if (!text) return resolve(baseDir);
	const resolved = isAbsolute(text) ? resolve(text) : resolve(baseDir, text);
	if (strippedHash && !text.endsWith('/') && !text.endsWith('\\')) return dirname(resolved);
	return resolved;
}

/**
 * Cargo's effective `target-dir` for `workspaceDir` invoked from `cwd`:
 * `CARGO_TARGET_DIR`, then `CARGO_BUILD_TARGET_DIR` (resolved against `cwd`), then
 * `.cargo/config[.toml]` `[build].target-dir`, then `<workspaceDir>/target`.
 */
export function resolveCargoTargetDir(
	workspaceDir,
	{ cwd = workspaceDir, env = process.env, homeDir = defaultHomeDir(env), ceiling = null } = {}
) {
	const ws = resolve(workspaceDir);
	const runDir = resolve(cwd);
	const fromEnv = env.CARGO_TARGET_DIR?.trim() || env.CARGO_BUILD_TARGET_DIR?.trim();
	if (fromEnv) return resolve(runDir, fromEnv);
	const { targetDir } = readCargoBuildConfig(ws, { cwd: runDir, env, homeDir, ceiling });
	if (targetDir) {
		return isAbsolute(targetDir.value)
			? resolve(targetDir.value)
			: resolve(targetDir.base, targetDir.value);
	}
	return join(ws, 'target');
}

/**
 * Cargo's configured `build-dir` root for `workspaceDir` invoked from `cwd`, or `null` when unset.
 * Template placeholders (`{workspace-root}`, `{cargo-cache-home}`, `{workspace-path-hash}`) are
 * expanded to the enclosing directory on disk.
 */
export function resolveCargoBuildDir(
	workspaceDir,
	{ cwd = workspaceDir, env = process.env, homeDir = defaultHomeDir(env), ceiling = null } = {}
) {
	const ws = resolve(workspaceDir);
	const runDir = resolve(cwd);
	const fromEnv = env.CARGO_BUILD_BUILD_DIR?.trim();
	if (fromEnv) return resolveTemplateDir(fromEnv, runDir, ws, env, homeDir);
	const { buildDir } = readCargoBuildConfig(ws, { cwd: runDir, env, homeDir, ceiling });
	if (buildDir) return resolveTemplateDir(buildDir.value, buildDir.base, ws, env, homeDir);
	return null;
}

/** Deduplicated output directories Cargo writes into for `workspaceDir` (`target-dir` and optional `build-dir`). */
export function cargoOutputDirs(workspaceDir, options = {}) {
	const dirs = [resolveCargoTargetDir(workspaceDir, options)];
	const buildDir = resolveCargoBuildDir(workspaceDir, options);
	if (buildDir && !dirs.includes(buildDir)) dirs.push(buildDir);
	return dirs;
}

/**
 * Target directory `endpoints/loam/packages/web/scripts/build-umbel.mjs` explicitly passes via
 * `CARGO_TARGET_DIR`: `$LOAM_UMBEL_TARGET_DIR || $CARGO_TARGET_DIR || 'target'` (resolved in
 * `endpoints/umbel`), overriding `CARGO_BUILD_TARGET_DIR` and `.cargo/config.toml` `target-dir`.
 */
export function loamUmbelTargetDir(umbelDir, env = process.env) {
	const target = env.LOAM_UMBEL_TARGET_DIR || env.CARGO_TARGET_DIR || 'target';
	return resolve(umbelDir, target);
}

/** Nearest existing ancestor directory of `path` (or `path` itself when it exists). */
export function existingAncestor(path) {
	let current = resolve(path);
	for (;;) {
		if (existsSync(current)) return current;
		const parent = dirname(current);
		if (parent === current) return current;
		current = parent;
	}
}

/** Parses `AFD_VERIFY_MIN_DISK_GB` (or explicit `minGb`), defaulting to `DEFAULT_VERIFY_MIN_DISK_GB`. */
export function resolveVerifyMinDiskGb(env = process.env, minGb = undefined) {
	if (minGb !== undefined) {
		if (!Number.isFinite(minGb) || minGb < 0)
			throw new Error(`invalid disk floor ${minGb}: expected a non-negative number of GiB`);
		return minGb;
	}
	const raw = env.AFD_VERIFY_MIN_DISK_GB?.trim();
	if (!raw) return DEFAULT_VERIFY_MIN_DISK_GB;
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed < 0) {
		throw new Error(
			`AFD_VERIFY_MIN_DISK_GB=${JSON.stringify(raw)} is not a non-negative number of GiB`
		);
	}
	return parsed;
}

function addPinnedTargetAndBuildDir(dirs, workspaceDir, options) {
	dirs.add(join(resolve(workspaceDir), 'target'));
	const buildDir = resolveCargoBuildDir(workspaceDir, options);
	if (buildDir) dirs.add(buildDir);
}

/**
 * Output directories (`target-dir` and `build-dir`) that a verify plan's Cargo-invoking steps
 * will actually write into. Pure TypeScript/Node steps that merely sit in a suite declaring
 * `cargo` at the suite level (such as `loam.yml`'s `typecheck:hosted`) contribute no directories.
 */
export function rustOutputDirsForPlan(plan, { root, env = process.env, homeDir, ceiling } = {}) {
	const dirs = new Set();
	const options = homeDir !== undefined ? { env, homeDir, ceiling } : { env, ceiling };
	const addWorkspace = (workspaceDir, cwd = workspaceDir) => {
		for (const dir of cargoOutputDirs(workspaceDir, { ...options, cwd })) dirs.add(dir);
	};

	for (const { suite, step } of plan) {
		const tools = step.tools ?? suite.tools ?? [];
		if (!tools.includes('cargo')) continue;

		if (suite.workflow === 'loam.yml') {
			if (/\btest:mounted\b/.test(step.run)) {
				const umbel = join(root, 'endpoints/umbel');
				dirs.add(loamUmbelTargetDir(umbel, env));
				const buildDir = resolveCargoBuildDir(umbel, options);
				if (buildDir) dirs.add(buildDir);
			}
			if (/\btest:browser\b/.test(step.run)) {
				// loam-web's test:browser runs specimen build:host (--target-dir target, #1659).
				addPinnedTargetAndBuildDir(dirs, join(root, 'foundations/specimen/host'), options);
			}
			continue;
		}

		if (/\b(?:test:stories|test:specimen|build:host)\b/.test(step.run)) {
			// Specimen's build:host pins --target-dir target, while Cargo still writes intermediates to build-dir.
			addPinnedTargetAndBuildDir(dirs, join(root, 'foundations/specimen/host'), options);
		}

		if (/\btest:conformance:umbel(?:-mounted)?\b/.test(step.run)) {
			addWorkspace(join(root, 'endpoints/umbel'));
			if (/\btest:conformance:umbel-mounted\b/.test(step.run)) {
				// Invoked from packages/examples/todo with --manifest-path backends/rust/Cargo.toml.
				addWorkspace(
					join(root, 'packages/examples/todo/backends/rust'),
					join(root, 'packages/examples/todo')
				);
			}
			continue;
		}

		if (/\btest:conformance:rs\b/.test(step.run)) {
			// Invoked from packages/examples/todo with --manifest-path backends/rust/Cargo.toml.
			addWorkspace(
				join(root, 'packages/examples/todo/backends/rust'),
				join(root, 'packages/examples/todo')
			);
			continue;
		}

		if (/\bcargo\b/.test(step.run)) {
			addWorkspace(join(root, step.cwd ?? '.'));
		}
	}
	return [...dirs];
}

/**
 * Checks that every volume holding a planned Rust step's target or build directory has at least
 * `floorGb` GiB free. Fails closed when a required volume cannot be queried via `statfs`
 * (`AFD_VERIFY_MIN_DISK_GB=0` is the explicit bypass).
 */
export function checkRustDiskFloor(
	plan,
	{ root, env = process.env, homeDir, ceiling, statfs = statfsSync, minGb } = {}
) {
	const floorGb = resolveVerifyMinDiskGb(env, minGb);
	if (floorGb === 0) return { ok: true, floorGb, checked: [], low: [], unreadable: [] };
	const dirs = rustOutputDirsForPlan(plan, { root, env, homeDir, ceiling });
	if (dirs.length === 0) return { ok: true, floorGb, checked: [], low: [], unreadable: [] };
	const checked = [];
	const low = [];
	const unreadable = [];
	for (const dir of dirs) {
		const ancestor = existingAncestor(dir);
		let stats;
		try {
			stats = statfs(ancestor);
		} catch (error) {
			unreadable.push({ dir, ancestor, reason: error.message });
			continue;
		}
		const freeBytes = Number(stats.bavail) * Number(stats.bsize);
		if (!Number.isFinite(freeBytes)) {
			unreadable.push({ dir, ancestor, reason: 'unusable statfs reading' });
			continue;
		}
		const freeGb = freeBytes / GIB;
		const entry = { dir, ancestor, freeGb };
		checked.push(entry);
		if (freeGb < floorGb) low.push(entry);
	}
	return { ok: low.length === 0 && unreadable.length === 0, floorGb, checked, low, unreadable };
}

export function formatRustDiskFloorError({ floorGb, low = [], unreadable = [] }) {
	const lines = [
		...low.map(
			({ dir, freeGb }) => `  ${dir}: ${freeGb.toFixed(1)} GiB free (floor ${floorGb} GiB)`
		),
		...unreadable.map(
			({ dir, ancestor, reason }) =>
				`  ${dir}: could not verify free space via ${ancestor} (${reason})`
		),
	];
	return [
		`refusing to start Rust verify steps: target volume below ${floorGb} GiB free floor or unreadable:`,
		...lines,
		'Free space with `botcore disk-reclaim --apply --pressure`, move Cargo output with CARGO_TARGET_DIR or `[build] build-dir` on another drive, or bypass explicitly with AFD_VERIFY_MIN_DISK_GB=0.',
	].join('\n');
}
