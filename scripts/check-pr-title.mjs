#!/usr/bin/env node
/**
 * Lints a pull request title as a conventional commit subject using `commitlint.config.js` (#1799).
 *
 * Runs without `pnpm install` so the pull-request title check in `ci.yml` finishes in seconds
 * and enforces the exact `type-enum`, `scope-enum`, `subject-max-length`, `subject-full-stop`
 * and `subject-case` rules from `commitlint.config.js`.
 *
 * Usage:
 *   PR_TITLE="feat(core): add foo" node scripts/check-pr-title.mjs
 *   node scripts/check-pr-title.mjs "feat(core): add foo"
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import commitlintConfig from '../commitlint.config.js';

const HEADER_PATTERN = /^([a-z]+)(?:\(([^)]+)\))?(!)?:\s+(.+)$/;

/** Check forbidden subject cases matching commitlint's sentence/start/pascal/upper rules. */
function forbiddenSubjectCase(subject, forbidden) {
	const words = subject.trim().split(/\s+/).filter(Boolean);
	const first = words[0] ?? '';
	const isUpper = (value) => /[A-Z]/.test(value) && value === value.toUpperCase();
	const isCapitalized = (value) => /^[A-Z]/.test(value);

	if (forbidden.includes('upper-case') && isUpper(subject)) return 'upper-case';
	if (
		forbidden.includes('start-case') &&
		words.length > 0 &&
		words.every((word) => isCapitalized(word))
	)
		return 'start-case';
	if (forbidden.includes('pascal-case') && words.length === 1 && /^[A-Z][A-Za-z0-9]*$/.test(first))
		return 'pascal-case';
	if (
		forbidden.includes('sentence-case') &&
		isCapitalized(first) &&
		// Allow an all-caps acronym at the start (e.g., "MCP server..." or "AFD core...")
		!/^[A-Z]{2,}\b/.test(first)
	)
		return 'sentence-case';
	return null;
}

export function lintPrTitle(title, { config = commitlintConfig, author = '' } = {}) {
	const errors = [];
	const trimmed = (title ?? '').trim();
	if (!trimmed) {
		return ['Pull request title is empty'];
	}
	if (trimmed.includes('\n')) {
		errors.push('Pull request title must be a single line');
	}

	const match = HEADER_PATTERN.exec(trimmed);
	if (!match) {
		errors.push(
			'Pull request title must match "<type>: <subject>" or "<type>(<scope>): <subject>" (commitlint.config.js)'
		);
		return errors;
	}

	const [, type, scope, , subject] = match;
	const rules = config.rules ?? {};
	const types = rules['type-enum']?.[2] ?? [];
	const scopes = rules['scope-enum']?.[2] ?? [];
	const maxSubject = rules['subject-max-length']?.[2] ?? 72;
	const forbiddenStop = rules['subject-full-stop']?.[2];
	const forbiddenCases = rules['subject-case']?.[2] ?? [];

	if (types.length > 0 && !types.includes(type)) {
		errors.push(`Type "${type}" is not allowed; expected one of: ${types.join(', ')}`);
	}
	if (scope && scopes.length > 0) {
		const parts = scope.split(/[,/\\]/).map((part) => part.trim());
		for (const part of parts) {
			if (!part || !scopes.includes(part)) {
				errors.push(
					`Scope "${part || scope}" is not allowed; expected one of: ${scopes.join(', ')}`
				);
			}
		}
	}
	if (forbiddenStop && subject.endsWith(forbiddenStop)) {
		errors.push(`Subject must not end with "${forbiddenStop}"`);
	}

	// Dependabot generates titles like "chore(deps): Bump X from 1 to 2 in /path in group ...".
	// Keep enforcing valid type/scope on Dependabot PRs while allowing its generated case/length.
	const isDependabot = author === 'dependabot[bot]' || author === 'app/dependabot';
	if (!isDependabot) {
		if (subject.length > maxSubject) {
			errors.push(
				`Subject is ${subject.length} characters, over the ${maxSubject}-character limit`
			);
		}
		const badCase = forbiddenSubjectCase(subject, forbiddenCases);
		if (badCase) {
			errors.push(`Subject must not be ${badCase}`);
		}
	}

	return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	const title = process.argv[2] ?? process.env.PR_TITLE ?? '';
	const author = process.env.PR_AUTHOR ?? '';
	const errors = lintPrTitle(title, { author });
	if (errors.length > 0) {
		console.error(`Invalid pull request title: ${JSON.stringify(title)}`);
		for (const error of errors) console.error(`  ✘ ${error}`);
		process.exitCode = 1;
	} else {
		console.log(`✓ Pull request title valid: ${title}`);
	}
}
