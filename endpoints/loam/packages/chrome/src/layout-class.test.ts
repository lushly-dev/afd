import { createDefaultLayout, type LayoutStateV0 } from '@lushly-dev/loam-kernel';
import { describe, expect, it } from 'vitest';
import { LAYOUT_CLASS_QUERIES, layoutClassFor, presentLayout } from './layout-class.js';

const layout = (patch: Partial<LayoutStateV0> = {}): LayoutStateV0 => ({
	...createDefaultLayout(),
	...patch,
});

describe('layout classes', () => {
	it('chooses compact below 640, expanded from 1024 and medium between', () => {
		const at = (width: number) =>
			layoutClassFor((query) =>
				query === LAYOUT_CLASS_QUERIES.compact ? width < 640 : width >= 1024
			);
		expect([at(390), at(639), at(640), at(800), at(1023), at(1024), at(1280)]).toEqual([
			'compact',
			'compact',
			'medium',
			'medium',
			'medium',
			'expanded',
			'expanded',
		]);
	});

	it('renders compact drawers and the sheet from compact state only', () => {
		const state = layout({
			sidebar: { open: true, width: 260 },
			compact: { drawer: 'inspector', sheet: true },
		});
		expect(presentLayout(state, 'compact', { width: 390, rail: 48 })).toEqual({
			layoutClass: 'compact',
			sidebar: 'closed',
			inspector: 'drawer',
			panel: 'sheet',
		});
	});

	it('keeps the sidebar and panel inline in medium and floats the inspector', () => {
		const state = layout({
			inspector: { open: true, width: 300 },
			panel: { open: true, height: 240, maximized: false },
		});
		expect(presentLayout(state, 'medium', { width: 800, rail: 48 })).toMatchObject({
			sidebar: 'inline',
			inspector: 'overlay',
			panel: 'inline',
		});
	});

	it('falls back to overlays in expanded when main would be narrower than mainMin', () => {
		const wide = layout({
			sidebar: { open: true, width: 480 },
			inspector: { open: true, width: 520 },
		});
		expect(presentLayout(wide, 'expanded', { width: 1024, rail: 48 })).toMatchObject({
			sidebar: 'inline',
			inspector: 'overlay',
		});
		expect(presentLayout(wide, 'expanded', { width: 1600, rail: 48 })).toMatchObject({
			sidebar: 'inline',
			inspector: 'inline',
		});
		const sidebarOnly = layout({ sidebar: { open: true, width: 480 } });
		expect(presentLayout(sidebarOnly, 'expanded', { width: 800, rail: 48 }).sidebar).toBe(
			'overlay'
		);
	});

	it('maximizes the panel outside compact', () => {
		const state = layout({ panel: { open: true, height: 240, maximized: true } });
		expect(presentLayout(state, 'expanded', { width: 1280, rail: 48 }).panel).toBe('maximized');
	});
});
