/**
 * @fileoverview `loam-shell`'s stylesheet: the grid that places the parts, and how each layout class
 * moves them (phase 0 specification, sections 5 and 7). Pixel sizes from state arrive only as the
 * shell's state properties.
 */

import { css } from '@lushly-dev/fast-element';

export const styles = css`
	:host {
		display: grid;
		box-sizing: border-box;
		inline-size: 100%;
		block-size: 100dvh;
		overflow: hidden;
		background: var(--color-surface-page);
		color: var(--color-text-primary);
		font-family: 'Montserrat', 'Segoe UI', sans-serif;
		font-size: var(--type-body-md-size);
		line-height: var(--type-body-md-line);
		font-weight: var(--type-body-md-weight);
		grid-template-columns: auto auto minmax(0, 1fr) auto;
		grid-template-rows: auto minmax(0, 1fr) auto auto auto;
	}
	:host([data-panel='inline']) {
		grid-template-rows:
			auto minmax(var(--shell-size-panel-min), 1fr) minmax(0, var(--_panel-height))
			auto auto;
	}
	:host([data-panel='maximized']) {
		grid-template-rows: auto 0 minmax(0, 1fr) auto auto;
	}
	loam-titlebar {
		grid-column: 1 / -1;
		grid-row: 1;
	}
	loam-rail {
		grid-column: 1;
		grid-row: 2 / 4;
	}
	loam-sidebar {
		grid-column: 2;
		grid-row: 2 / 4;
		inline-size: var(--_sidebar-width);
	}
	loam-main {
		grid-column: 3;
		grid-row: 2;
	}
	:host([data-panel='maximized']) loam-main {
		overflow: hidden;
		padding-block: 0;
	}
	loam-panel {
		grid-column: 3;
		grid-row: 3;
	}
	loam-inspector {
		grid-column: 4;
		grid-row: 2 / 4;
		inline-size: var(--_inspector-width);
	}
	loam-statusbar {
		grid-column: 1 / -1;
		grid-row: 4;
	}
	loam-tabbar {
		grid-column: 1 / -1;
		grid-row: 5;
	}
	:host([data-sidebar='overlay']) loam-sidebar {
		grid-column: 3;
		justify-self: start;
		inline-size: min(var(--_sidebar-width), 85vw);
	}
	:host([data-inspector='overlay']) loam-inspector {
		grid-column: 3;
		justify-self: end;
		inline-size: min(var(--_inspector-width), 85vw);
	}
	:host([data-panel='sheet']) loam-panel {
		grid-column: 1 / -1;
		grid-row: 2;
		align-self: end;
		block-size: clamp(40dvh, var(--_panel-height), 80dvh);
	}
	/* Heard, not seen: the live region of a change of scope (phase 2 specification, 7.8). */
	.announce {
		position: absolute;
		clip-path: inset(50%);
	}
	/* The status bar's project item, a button to the project's home (7.4). */
	.project-home {
		padding: 0;
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		text-decoration: underline;
		cursor: pointer;
	}
	.project-home:focus-visible {
		outline: var(--shell-size-focus) solid var(--color-focus-ring);
	}
	@media (forced-colors: active) {
		:host {
			background: Canvas;
			color: CanvasText;
		}
	}
`;
