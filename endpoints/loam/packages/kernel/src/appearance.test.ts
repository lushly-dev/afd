import { describe, expect, it } from 'vitest';
import {
	APPEARANCE_QUERIES,
	createDefaultAppearance,
	resolveTheme,
	validateAppearancePatch,
} from './appearance.js';
import { createFixedEnvironment } from './testing.js';

describe('resolveTheme', () => {
	it.each([
		[[], 'light'],
		[[APPEARANCE_QUERIES.dark], 'dark'],
		[[APPEARANCE_QUERIES.moreContrast], 'high-contrast'],
		[[APPEARANCE_QUERIES.forcedColors, APPEARANCE_QUERIES.dark], 'high-contrast'],
		[[APPEARANCE_QUERIES.moreContrast, APPEARANCE_QUERIES.dark], 'high-contrast'],
	])('resolves system under %j to %s', (matching, resolved) => {
		expect(resolveTheme('system', createFixedEnvironment(matching))).toBe(resolved);
	});

	it('keeps an explicit theme whatever the environment', () => {
		const environment = createFixedEnvironment([APPEARANCE_QUERIES.forcedColors]);
		expect(resolveTheme('dark', environment)).toBe('dark');
		expect(resolveTheme('light', environment)).toBe('light');
	});
});

describe('validateAppearancePatch', () => {
	const state = createDefaultAppearance();

	it('applies a partial appearance', () => {
		expect(validateAppearancePatch(state, { density: 'compact' })).toEqual({
			valid: true,
			state: { theme: 'system', density: 'compact' },
		});
		expect(state).toEqual({ theme: 'system', density: 'comfortable' });
	});

	it.each([
		[null, ''],
		[[], ''],
		[{ theme: 'sepia' }, 'theme'],
		[{ density: 3 }, 'density'],
		[{ font: 'serif' }, 'font'],
	])('refuses %j naming %j', (patch, field) => {
		const result = validateAppearancePatch(state, patch);
		expect(result.valid ? undefined : result.error).toMatchObject({
			code: 'VALIDATION_ERROR',
			details: { field },
		});
	});

	it('needs every field for a complete appearance', () => {
		expect(validateAppearancePatch(state, { theme: 'dark' }, true).valid).toBe(false);
		expect(validateAppearancePatch(state, { theme: 'dark', density: 'compact' }, true).valid).toBe(
			true
		);
	});
});
