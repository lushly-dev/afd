/**
 * @fileoverview Layout classes and how each part renders in them (phase 0 specification, 5.3).
 * A layout class changes how parts render, never the layout state.
 */

import type { LayoutStateV0 } from '@lushly-dev/loam-kernel';
import { LAYOUT_DEFAULTS_V0 } from '@lushly-dev/loam-kernel';

export type LayoutClass = 'compact' | 'medium' | 'expanded';

/** The media queries that choose the class: compact below 640px, expanded from 1024px. */
export const LAYOUT_CLASS_QUERIES = Object.freeze({
	compact: '(max-width: 639.98px)',
	expanded: '(min-width: 1024px)',
});

export function layoutClassFor(matches: (query: string) => boolean): LayoutClass {
	if (matches(LAYOUT_CLASS_QUERIES.compact)) return 'compact';
	if (matches(LAYOUT_CLASS_QUERIES.expanded)) return 'expanded';
	return 'medium';
}

/** How a side part renders: in its track, as a non-modal overlay drawer, or as a modal drawer. */
export type SideMode = 'inline' | 'overlay' | 'drawer' | 'closed';
/** How the panel renders: in its track, filling main's area, or as the compact class's sheet. */
export type PanelMode = 'inline' | 'maximized' | 'sheet' | 'closed';

export interface PresentationV0 {
	layoutClass: LayoutClass;
	sidebar: SideMode;
	inspector: SideMode;
	panel: PanelMode;
}

export interface PresentOptions {
	/** The shell's inline size, in CSS pixels. */
	width: number;
	/** What the rail takes from it, in CSS pixels. A side part's boundary is inside its width. */
	rail: number;
}

/**
 * Where each part renders for a layout state in a class. In the expanded class, when the inline
 * parts would leave main narrower than `mainMin`, the inspector becomes an overlay drawer, then
 * the sidebar, without changing the state.
 */
export function presentLayout(
	layout: LayoutStateV0,
	layoutClass: LayoutClass,
	options: PresentOptions
): PresentationV0 {
	if (layoutClass === 'compact') {
		return {
			layoutClass,
			sidebar: layout.compact.drawer === 'sidebar' ? 'drawer' : 'closed',
			inspector: layout.compact.drawer === 'inspector' ? 'drawer' : 'closed',
			panel: layout.compact.sheet ? 'sheet' : 'closed',
		};
	}
	const panel: PanelMode = layout.panel.open
		? layout.panel.maximized
			? 'maximized'
			: 'inline'
		: 'closed';
	let sidebar: SideMode = layout.sidebar.open ? 'inline' : 'closed';
	let inspector: SideMode = layout.inspector.open
		? layoutClass === 'medium'
			? 'overlay'
			: 'inline'
		: 'closed';
	if (layoutClass === 'expanded') {
		const main = () =>
			options.width -
			options.rail -
			(sidebar === 'inline' ? layout.sidebar.width : 0) -
			(inspector === 'inline' ? layout.inspector.width : 0);
		if (inspector === 'inline' && main() < LAYOUT_DEFAULTS_V0.mainMin) inspector = 'overlay';
		if (sidebar === 'inline' && main() < LAYOUT_DEFAULTS_V0.mainMin) sidebar = 'overlay';
	}
	return { layoutClass, sidebar, inspector, panel };
}
