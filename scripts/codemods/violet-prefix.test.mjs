import assert from 'node:assert/strict';
import test from 'node:test';
import { migrate, patternFor } from './violet-prefix.mjs';

const pattern = patternFor(['color.surface.page', 'color.surface', 'size.focus-ring.width']);
const run = (text) => migrate(text, pattern).text;

test('prefixes a whole old name wherever it is read or set', () => {
	assert.equal(
		run('a { color: var(--color-surface-page, #fff); }'),
		'a { color: var(--violet-color-surface-page, #fff); }'
	);
	assert.equal(run('--color-surface: red;'), '--violet-color-surface: red;');
	assert.equal(
		run("getPropertyValue('--size-focus-ring-width')"),
		"getPropertyValue('--violet-size-focus-ring-width')"
	);
	// The longest name wins over a shorter one it begins with.
	assert.equal(run('var(--color-surface-page)'), 'var(--violet-color-surface-page)');
});

test('treats a \\t or \\n escape in a string literal as a boundary', () => {
	assert.equal(run('"\\t--color-surface-page: 1"'), '"\\t--violet-color-surface-page: 1"');
	assert.equal(run('"\\n--color-surface: 1"'), '"\\n--violet-color-surface: 1"');
});

test('leaves prefixed names, private aliases, longer names and marked lines alone', () => {
	for (const text of [
		'var(--violet-color-surface-page)',
		'var(--_color-surface-page)',
		'var(--color-surface-page-extra)',
		'var(--my--color-surface-page)',
		'at--color-surface-page',
		'var(--color-surface-page) /* violet-prefix: keep */',
	])
		assert.equal(run(text), text);
});

test('counts what it renames and changes nothing on a second run', () => {
	const once = migrate('var(--color-surface) var(--color-surface-page)', pattern);
	assert.equal(once.count, 2);
	assert.deepEqual(migrate(once.text, pattern), { text: once.text, count: 0 });
});
