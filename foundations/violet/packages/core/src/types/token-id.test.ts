import { describe, expect, it } from 'vitest';
import { validateTokenId } from './token-id.js';

describe('validateTokenId (#1957)', () => {
	it.each([
		'color.brand.primary',
		'color.gray.500',
		'spacing.2xl',
		'size.focus_width',
		'color.constructor-blue',
		'accent',
	])('accepts valid token id %j', (id) => {
		expect(validateTokenId(id)).toBeNull();
	});

	it.each(['__proto__.polluted', 'color.__proto__', 'constructor.prototype.x', 'a.prototype'])(
		'rejects reserved path segments in %j',
		(id) => {
			expect(validateTokenId(id)).toContain('reserved path segment');
		},
	);

	it.each([
		'a;}body{background:red}x{--b',
		'color.bg;color:red',
		'color bg',
		'color/primary',
		'color.$value',
		'color.bg:hover',
		'color.{alias}',
		'color.bg\nfoo',
		'',
		'.color',
		'color.',
		'color..primary',
	])('rejects unsafe or non-CSS token id %j', (id) => {
		const error = validateTokenId(id);
		expect(error).not.toBeNull();
		expect(error).toContain('CSS name');
	});
});
