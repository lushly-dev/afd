import { describe, expect, it } from 'vitest';

import * as runtime from '../index.js';
import { VIOLET_CSS_PREFIX, tokenCustomProperty } from '../property.js';

describe('tokenCustomProperty', () => {
	it('kebabs the id under the prefix', () => {
		expect(tokenCustomProperty('color.surface.page', VIOLET_CSS_PREFIX)).toBe(
			'--violet-color-surface-page',
		);
		expect(tokenCustomProperty('size.focus-ring.width', 'violet')).toBe(
			'--violet-size-focus-ring-width',
		);
		expect(tokenCustomProperty('z-index.modal', 'loam')).toBe('--loam-z-index-modal');
	});

	it('writes no prefix and no extra dash when the prefix is empty', () => {
		expect(tokenCustomProperty('color.surface.page')).toBe('--color-surface-page');
		expect(tokenCustomProperty('color.surface.page', '')).toBe('--color-surface-page');
	});

	it('is the one the package root exports', () => {
		expect(runtime.tokenCustomProperty).toBe(tokenCustomProperty);
		expect(runtime.VIOLET_CSS_PREFIX).toBe('violet');
	});
});
