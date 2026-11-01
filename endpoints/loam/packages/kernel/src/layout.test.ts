import { describe, expect, it } from 'vitest';
import {
	createDefaultLayout,
	LAYOUT_DEFAULTS_V0,
	layoutAsPatch,
	layoutUndoPatch,
	validateLayoutPatch,
	validateLayoutState,
} from './layout.js';

describe('layout state version 0', () => {
	it('has the specified defaults and bounds', () => {
		expect(LAYOUT_DEFAULTS_V0).toEqual({
			sidebar: { default: 260, min: 200, max: 480 },
			inspector: { default: 300, min: 240, max: 520 },
			panel: { default: 240, min: 120 },
			mainMin: 360,
		});
		expect(createDefaultLayout()).toEqual({
			version: 0,
			sidebar: { open: true, width: 260 },
			inspector: { open: false, width: 300 },
			panel: { open: false, height: 240, maximized: false },
			compact: { drawer: null, sheet: false },
		});
		expect(createDefaultLayout()).not.toBe(createDefaultLayout());
	});
});

describe('validateLayoutPatch', () => {
	const state = createDefaultLayout();

	it('applies a deep partial without changing the given state', () => {
		const result = validateLayoutPatch(state, {
			sidebar: { width: 480 },
			inspector: { open: true, width: 240 },
			panel: { height: 10000, maximized: true },
			compact: { drawer: 'inspector', sheet: true },
			version: 0,
		});
		expect(result).toEqual({
			valid: true,
			state: {
				version: 0,
				sidebar: { open: true, width: 480 },
				inspector: { open: true, width: 240 },
				panel: { open: false, height: 10000, maximized: true },
				compact: { drawer: 'inspector', sheet: true },
			},
		});
		expect(state).toEqual(createDefaultLayout());
	});

	it.each([
		[{ sidebar: { width: 199 } }, 'sidebar.width', 'from 200 to 480'],
		[{ sidebar: { width: 481 } }, 'sidebar.width', 'from 200 to 480'],
		[{ sidebar: { width: 300.5 } }, 'sidebar.width', 'integer'],
		[{ inspector: { width: 239 } }, 'inspector.width', 'from 240 to 520'],
		[{ inspector: { width: 521 } }, 'inspector.width', 'from 240 to 520'],
		[{ panel: { height: 119 } }, 'panel.height', '120 or more'],
		[{ panel: { height: '200' } }, 'panel.height', 'integer'],
		[{ sidebar: { open: 'yes' } }, 'sidebar.open', 'true or false'],
		[{ panel: { maximized: 1 } }, 'panel.maximized', 'true or false'],
		[{ compact: { drawer: 'panel' } }, 'compact.drawer', '"sidebar", "inspector" or null'],
		[{ compact: { sheet: null } }, 'compact.sheet', 'true or false'],
		[{ sidebar: { colour: 'red' } }, 'sidebar.colour', 'Unknown layout field'],
		[{ toolbar: {} }, 'toolbar', 'Unknown layout field'],
		[{ sidebar: true }, 'sidebar', 'must be an object'],
		[{ version: 1 }, 'version', 'version must be 0'],
	])('refuses %j naming %s', (patch, field, text) => {
		const result = validateLayoutPatch(state, patch);
		expect(result.valid).toBe(false);
		if (result.valid) return;
		expect(result.error.code).toBe('VALIDATION_ERROR');
		expect(result.error.details?.field).toBe(field);
		expect(result.error.message).toContain(text);
		expect(result.error.suggestion).toBeTruthy();
	});

	it('names the range and an example in the suggestion', () => {
		const result = validateLayoutPatch(state, { inspector: { width: 1 } });
		expect(result).toMatchObject({
			valid: false,
			error: {
				suggestion: 'Use a whole number from 240 to 520, e.g. 300',
				details: { field: 'inspector.width', min: 240, max: 520, value: 1 },
			},
		});
	});

	it.each([null, [], 'sidebar', 3])('refuses a patch that is not an object: %j', (patch) => {
		expect(validateLayoutPatch(state, patch).valid).toBe(false);
	});

	it('shortens long values in messages', () => {
		const result = validateLayoutPatch(state, { sidebar: { open: 'x'.repeat(100) } });
		expect(result.valid ? '' : result.error.message).toContain('...');
	});
});

describe('validateLayoutState', () => {
	it('accepts a complete state', () => {
		expect(validateLayoutState(createDefaultLayout())).toEqual({
			valid: true,
			state: createDefaultLayout(),
		});
	});

	it.each([
		[null, ''],
		[{ ...createDefaultLayout(), version: undefined }, 'version'],
		[{ version: 0 }, 'sidebar.open'],
		[{ ...createDefaultLayout(), panel: { open: true, height: 200 } }, 'panel.maximized'],
		[{ ...createDefaultLayout(), sidebar: { open: true, width: 10 } }, 'sidebar.width'],
	])('refuses %j naming %j', (value, field) => {
		const result = validateLayoutState(value);
		expect(result.valid ? undefined : result.error.details?.field).toBe(field);
	});
});

describe('undo patches', () => {
	it('takes the previous values of the fields given', () => {
		const state = createDefaultLayout();
		expect(
			layoutUndoPatch(state, { sidebar: { width: 300 }, compact: { drawer: 'sidebar' } })
		).toEqual({ sidebar: { width: 260 }, compact: { drawer: null } });
		expect(layoutUndoPatch(state, {})).toEqual({});
	});

	it('turns a state into a patch without version', () => {
		const patch = layoutAsPatch(createDefaultLayout());
		expect(patch).not.toHaveProperty('version');
		expect(validateLayoutPatch(createDefaultLayout(), patch)).toEqual({
			valid: true,
			state: createDefaultLayout(),
		});
	});
});
