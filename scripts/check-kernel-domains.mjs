#!/usr/bin/env node
/**
 * Enforces domain boundaries inside `@lushly-dev/loam-kernel` (`endpoints/loam/packages/kernel/src/`, #1778).
 *
 * Each domain folder owns one area of the kernel and may import only from the domains listed in
 * `DOMAIN_RULES`. `late/` is the stage-B composition root: it may import any domain, and no domain
 * may import `late/`. Stage-A core files (root `*.ts`, excluding `/testing` and `/mounted` entries)
 * may not statically import lazy/stage-B domains (`apps`, `documents`, `identity`, `settings`,
 * `copilot`, `inbound`, `server`, `late`) at runtime.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from '@typescript/typescript6';

export const KERNEL_SRC = 'endpoints/loam/packages/kernel/src';

/**
 * Allowed internal dependencies per domain.
 * - `runtime`: domains that may be imported at runtime (value imports, dynamic imports, exports)
 * - `typeOnly`: additional domains that may be imported with `import type` / `export type` only
 */
export const DOMAIN_RULES = Object.freeze({
	scope: { runtime: ['core', 'scope'], typeOnly: ['copilot'] },
	overlays: { runtime: ['core', 'scope', 'overlays'], typeOnly: [] },
	apps: { runtime: ['core', 'scope', 'overlays', 'apps'], typeOnly: [] },
	documents: { runtime: ['core', 'scope', 'apps', 'documents'], typeOnly: ['overlays'] },
	identity: { runtime: ['core', 'scope', 'identity'], typeOnly: ['documents', 'overlays'] },
	settings: { runtime: ['core', 'scope', 'overlays', 'settings'], typeOnly: ['documents'] },
	copilot: { runtime: ['core', 'scope', 'copilot'], typeOnly: [] },
	inbound: { runtime: ['core', 'scope', 'inbound'], typeOnly: [] },
	server: { runtime: ['core', 'scope', 'server'], typeOnly: [] },
	late: {
		runtime: [
			'core',
			'scope',
			'overlays',
			'apps',
			'documents',
			'identity',
			'settings',
			'copilot',
			'server',
			'late',
		],
		typeOnly: [],
	},
});

/** Stage-B / lazy domains that stage-A core files must never statically import at runtime. */
const STAGE_B_DOMAINS = new Set([
	'apps',
	'documents',
	'identity',
	'settings',
	'copilot',
	'inbound',
	'server',
]);

/** Root files that are test-kit entries (`@lushly-dev/loam-kernel/testing`), outside the browser bundle. */
const TESTING_ENTRIES = new Set(['testing.ts', 'testing-documents.ts', 'testing-probe.ts']);

/** Package self-specifier forbidden inside `kernel/src/` (must use checked relative paths). */
const KERNEL_PACKAGE = '@lushly-dev/loam-kernel';

const slash = (p) => p.replaceAll('\\', '/');

function walkSourceFiles(rootDir, current = '') {
	const dir = join(rootDir, current);
	if (!existsSync(dir)) return [];
	const results = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const rel = current ? `${current}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			results.push(...walkSourceFiles(rootDir, rel));
		} else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
			results.push(rel);
		}
	}
	return results;
}

/** Classifies a path relative to `kernel/src/` into its domain folder or `'core'`. */
export function domainOf(relPath) {
	const clean = slash(relPath);
	const slashIndex = clean.indexOf('/');
	return slashIndex === -1 ? 'core' : clean.slice(0, slashIndex);
}

/**
 * Extracts every relative or package-self import/export/dynamic-import/import-type edge in a TS file,
 * tagging each as `typeOnly` and `dynamic`. Under `verbatimModuleSyntax: true`, only top-level
 * `import type` / `export type` and `import('...')` type nodes are erased at runtime; inline
 * `import { type X }` emits a runtime import and is therefore classified as `typeOnly: false`.
 */
function extractInternalEdges(filePath, text) {
	const source = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true);
	const edges = [];
	const isInternal = (spec) =>
		spec.startsWith('.') || spec === KERNEL_PACKAGE || spec.startsWith(`${KERNEL_PACKAGE}/`);
	function visit(node) {
		if (
			ts.isImportDeclaration(node) &&
			node.moduleSpecifier &&
			ts.isStringLiteralLike(node.moduleSpecifier)
		) {
			const spec = node.moduleSpecifier.text;
			if (isInternal(spec)) {
				const typeOnly = Boolean(node.importClause?.isTypeOnly);
				edges.push({ spec, typeOnly, dynamic: false });
			}
		} else if (
			ts.isExportDeclaration(node) &&
			node.moduleSpecifier &&
			ts.isStringLiteralLike(node.moduleSpecifier)
		) {
			const spec = node.moduleSpecifier.text;
			if (isInternal(spec)) {
				const typeOnly = Boolean(node.isTypeOnly);
				edges.push({ spec, typeOnly, dynamic: false });
			}
		} else if (
			ts.isImportTypeNode(node) &&
			ts.isLiteralTypeNode(node.argument) &&
			ts.isStringLiteralLike(node.argument.literal)
		) {
			const spec = node.argument.literal.text;
			if (isInternal(spec)) edges.push({ spec, typeOnly: true, dynamic: false });
		} else if (
			ts.isCallExpression(node) &&
			node.expression.kind === ts.SyntaxKind.ImportKeyword &&
			node.arguments[0] &&
			ts.isStringLiteralLike(node.arguments[0])
		) {
			const spec = node.arguments[0].text;
			if (isInternal(spec)) edges.push({ spec, typeOnly: false, dynamic: true });
		}
		ts.forEachChild(node, visit);
	}
	visit(source);
	return edges;
}

/**
 * Checks every non-test `.ts` file in `endpoints/loam/packages/kernel/src/` against `DOMAIN_RULES`
 * and verifies that domain runtime dependencies form a DAG (no cross-domain cycles).
 */
export function checkKernelDomains(repoRoot, srcSubpath = KERNEL_SRC) {
	const srcRoot = join(repoRoot, srcSubpath);
	const errors = [];
	if (!existsSync(srcRoot)) return { errors, checked: 0 };

	const files = walkSourceFiles(srcRoot);
	const knownDomains = new Set(['core', ...Object.keys(DOMAIN_RULES)]);
	const runtimeGraph = new Map([...knownDomains].map((d) => [d, new Set()]));

	for (const rel of files) {
		const fromDomain = domainOf(rel);
		if (!knownDomains.has(fromDomain)) {
			errors.push(`${srcSubpath}/${rel}: unknown kernel domain "${fromDomain}"`);
			continue;
		}
		const abs = join(srcRoot, rel);
		const edges = extractInternalEdges(abs, readFileSync(abs, 'utf8'));
		for (const edge of edges) {
			if (edge.spec === KERNEL_PACKAGE || edge.spec.startsWith(`${KERNEL_PACKAGE}/`)) {
				errors.push(
					`${srcSubpath}/${rel}: kernel files must use checked relative imports, not package self-import (${edge.spec})`
				);
				continue;
			}
			const targetRel = posix.normalize(posix.join(posix.dirname(rel), edge.spec));
			if (targetRel === '..' || targetRel.startsWith('../')) {
				errors.push(`${srcSubpath}/${rel}: relative import escapes kernel/src (${edge.spec})`);
				continue;
			}
			const toDomain = domainOf(targetRel);
			if (!knownDomains.has(toDomain)) {
				errors.push(
					`${srcSubpath}/${rel}: imports unknown kernel domain "${toDomain}" (${edge.spec})`
				);
				continue;
			}
			if (fromDomain === 'core') {
				if (TESTING_ENTRIES.has(rel)) continue;
				// `mounted.ts` is the separate `@lushly-dev/loam-kernel/mounted` subpath entry (not stage A);
				// enforce the `apps` domain rules on it.
				if (rel === 'mounted.ts') {
					const allowed = DOMAIN_RULES.apps.runtime.includes(toDomain);
					if (!edge.typeOnly && !allowed) {
						errors.push(
							`${srcSubpath}/${rel}: subpath entry "mounted.ts" may not import "${toDomain}" at runtime (${edge.spec})`
						);
					}
					continue;
				}
				if (!edge.typeOnly && !edge.dynamic && STAGE_B_DOMAINS.has(toDomain)) {
					errors.push(
						`${srcSubpath}/${rel}: stage-A core may not statically import stage-B domain "${toDomain}" (${edge.spec})`
					);
				}
				if (!edge.typeOnly && !edge.dynamic && toDomain === 'late') {
					errors.push(
						`${srcSubpath}/${rel}: core must load "late/" dynamically, not statically (${edge.spec})`
					);
				}
				continue;
			}
			const rule = DOMAIN_RULES[fromDomain];
			const allowedRuntime = rule.runtime.includes(toDomain);
			const allowedType = allowedRuntime || rule.typeOnly.includes(toDomain);
			if (edge.typeOnly) {
				if (!allowedType) {
					errors.push(
						`${srcSubpath}/${rel}: domain "${fromDomain}" may not import types from "${toDomain}" (${edge.spec})`
					);
				}
			} else if (!allowedRuntime) {
				const hint = rule.typeOnly.includes(toDomain) ? ' (only `import type` is allowed)' : '';
				errors.push(
					`${srcSubpath}/${rel}: domain "${fromDomain}" may not import "${toDomain}" at runtime${hint} (${edge.spec})`
				);
			}
			if (!edge.typeOnly && toDomain !== fromDomain && toDomain !== 'core') {
				runtimeGraph.get(fromDomain).add(toDomain);
			}
		}
	}

	// Verify domain-level runtime graph is acyclic (excluding core).
	const visiting = new Set();
	const visited = new Set();
	const stack = [];
	function dfs(node) {
		visiting.add(node);
		stack.push(node);
		for (const next of runtimeGraph.get(node) ?? []) {
			if (visiting.has(next)) {
				const cycle = [...stack.slice(stack.indexOf(next)), next].join(' -> ');
				errors.push(`Kernel domain runtime cycle: ${cycle}`);
			} else if (!visited.has(next)) {
				dfs(next);
			}
		}
		stack.pop();
		visiting.delete(node);
		visited.add(node);
	}
	for (const domain of Object.keys(DOMAIN_RULES)) {
		if (!visited.has(domain)) dfs(domain);
	}

	return { errors: [...new Set(errors)], checked: files.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	const { errors, checked } = checkKernelDomains(process.cwd());
	for (const error of errors) console.error(`✘ ${error}`);
	if (errors.length > 0) process.exitCode = 1;
	else
		console.log(
			`✓ Kernel domain boundaries: ${checked} source files checked across ${Object.keys(DOMAIN_RULES).length} domains`
		);
}
