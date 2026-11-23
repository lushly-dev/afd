import assert from 'node:assert/strict';
import test from 'node:test';
import { lintPrTitle } from './check-pr-title.mjs';

test('accepts valid conventional PR titles with and without allowed scopes', () => {
	for (const title of [
		'feat: add scheduled failure reporting',
		'ci(deps): pin action SHAs',
		'fix(core): preserve null step data',
		'fix(core,server): handle empty input',
		'refactor(client/cli): share error formatting',
		'chore: release packages',
		'docs(violet): write the Loam plugin specification',
		'feat!: drop legacy format',
	]) {
		assert.deepEqual(lintPrTitle(title), [], title);
	}
});

test('rejects invalid types, unknown scopes, trailing periods, bad case and overly long subjects', () => {
	assert.match(lintPrTitle('update readme').join('\n'), /must match/);
	assert.match(lintPrTitle('wip: quick hack').join('\n'), /Type "wip" is not allowed/);
	assert.match(lintPrTitle('fix(unknown): something').join('\n'), /Scope "unknown" is not allowed/);
	assert.match(
		lintPrTitle('fix(core,unknown): something').join('\n'),
		/Scope "unknown" is not allowed/
	);
	assert.match(lintPrTitle('fix(core,): something').join('\n'), /is not allowed/);
	assert.match(lintPrTitle('fix(core): trailing period.').join('\n'), /must not end with "\."/);
	assert.match(lintPrTitle('fix(core): Capitalized subject').join('\n'), /sentence-case/);
	assert.match(lintPrTitle('fix(core): ALL CAPS').join('\n'), /upper-case/);
	assert.match(lintPrTitle(`fix: ${'a'.repeat(73)}`).join('\n'), /over the 72-character limit/);
});

test('allows Dependabot generated case and length while still enforcing valid type and scope', () => {
	const title =
		'chore(deps): Bump psl from 2.1.257 to 2.1.258 in /endpoints/loam/plugins/mail/engine in the cargo-minor-patch group';
	assert.deepEqual(lintPrTitle(title, { author: 'dependabot[bot]' }), []);
	assert.match(
		lintPrTitle('Bump psl from 1 to 2', { author: 'dependabot[bot]' }).join('\n'),
		/must match/
	);
});
