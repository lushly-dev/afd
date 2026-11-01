# Patterns

CSS for the recurring pieces of Loam's chrome and kit, written as the `css`
tagged templates of FAST-AF elements. Each passes `loam-lint-tokens`. The
rules behind them are in `endpoints/loam/docs/design.md`; step 7 of the
phase 0 specification owns the chrome's exact grid and markup.

## A part

```css
:host {
	display: block;
	background: var(--color-surface-card);
	color: var(--color-text-primary);
	padding: var(--space-layout-sm);
	font-size: var(--type-body-md-size);
	line-height: var(--type-body-md-line);
	font-weight: var(--type-body-md-weight);
	border-inline-end: 1px solid var(--color-border-subtle);
}
```

- Bars (title bar, rail, tab bar, status bar) take `--color-surface-subtle`
  and `--color-text-secondary`; main takes `--color-surface-page` and
  `--space-layout-md`.
- Parts take no `box-shadow` and no `border-radius`.

## The shell's tracks

Only `loam-shell` reads the state properties, which the controller sets
through CSSOM:

```css
:host {
	display: grid;
	grid-template-columns:
		var(--shell-size-rail) var(--_sidebar-width)
		minmax(var(--shell-size-main-min), 1fr) var(--_inspector-width);
	grid-template-rows:
		var(--shell-size-titlebar) 1fr var(--_panel-height)
		var(--shell-size-statusbar);
}
```

The state properties are listed in the chrome's `package.json` under
`loamLintTokens.stateProperties`.

## A type step

Read the three parts of one step together:

```css
.label {
	font-size: var(--type-label-sm-size);
	line-height: var(--type-label-sm-line);
	font-weight: var(--type-label-sm-weight);
}
```

## Focus

```css
:host(:focus-visible) {
	outline: var(--shell-size-focus) solid var(--color-focus-ring);
	outline-offset: var(--size-space-xs);
}

@media (forced-colors: active) {
	:host(:focus-visible) {
		outline-color: Highlight;
	}
}
```

`--shell-size-focus` is 3px in high contrast. Only the chrome may read it.

## A neutral item in its states

A rail entry, list row or status item:

```css
.item {
	position: relative;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	min-inline-size: var(--size-target-comfortable);
	min-block-size: var(--size-target-comfortable);
	border-radius: var(--radius-md);
	color: var(--color-text-secondary);
	background: transparent;
	transition: background-color var(--duration-fast) var(--easing-standard);
}

.item:hover {
	background: var(--color-action-secondary-hover);
}

.item:active {
	background: var(--color-action-secondary-pressed);
}

.item[aria-current='page'] {
	background: var(--color-control-selected-background);
	color: var(--color-control-selected-foreground);
}

/* Selection is not color alone: a start-edge bar. */
.item[aria-current='page']::before {
	content: '';
	position: absolute;
	inset-block: var(--size-space-sm);
	inset-inline-start: 0;
	inline-size: var(--size-space-xs);
	background: var(--color-control-selected-foreground);
}

:host([disabled]) .item {
	opacity: 0.55;
	cursor: not-allowed;
	background: transparent;
}

@media (forced-colors: active) {
	.item[aria-current='page']::before {
		forced-color-adjust: none;
		background: Highlight;
	}

	:host([disabled]) .item {
		color: GrayText;
	}
}
```

- On a part (not a subtle bar) the hover background is
  `--color-surface-subtle`.
- Targets: `--size-target-natural` in the title bar, `--size-target-compact`
  in the status bar.

## A resize handle

```css
:host {
	position: relative;
	inline-size: var(--shell-size-handle);
	background: var(--shell-color-handle-rest);
	cursor: col-resize;
	touch-action: none;
}

/* The 24px hit area, centered on the 4px bar. */
:host::before {
	content: '';
	position: absolute;
	inset-block: 0;
	inset-inline: calc((var(--size-target-compact) - var(--shell-size-handle)) / -2);
}

:host(:hover) {
	background: var(--shell-color-handle-hover);
}

:host(:focus-visible),
:host([data-dragging]) {
	background: var(--shell-color-handle-active);
}

:host(:focus-visible) {
	outline: var(--shell-size-focus) solid var(--color-focus-ring);
	outline-offset: var(--size-space-xs);
}

@media (forced-colors: active) {
	:host {
		background: CanvasText;
	}

	:host(:focus-visible),
	:host([data-dragging]) {
		background: Highlight;
	}

	:host(:focus-visible) {
		outline-color: Highlight;
	}
}
```

The panel's handle is the same with `block-size` and `row-resize`. The
handle has role `separator`, `aria-orientation`, and `aria-valuenow`,
`aria-valuemin` and `aria-valuemax`.

## An overlay that enters

```css
.drawer {
	background: var(--color-surface-floating);
	box-shadow: var(--shadow-floating);
	padding: var(--space-layout-sm);
	opacity: 0;
	transition: opacity var(--duration-fast) var(--easing-standard);
}

.drawer[open] {
	opacity: 1;
	transition: opacity var(--duration-base) var(--easing-emphasized);
}

/* A dialog has no previous style when it opens, so give it one. */
@starting-style {
	.drawer[open] {
		opacity: 0;
	}
}

@media (prefers-reduced-motion: reduce) {
	.drawer,
	.drawer[open] {
		transition: opacity var(--duration-fast) var(--easing-standard);
	}
}

@media (forced-colors: active) {
	.drawer {
		border: 1px solid CanvasText;
	}
}
```

Forced colors removes `box-shadow`, so the floating layer needs the border.
No `transform`: it would make the drawer the containing block of its
`position: fixed` popups (why `violet-dialog` is opacity-only). Grid tracks,
widths and heights never transition.

## A field boundary

Until the field-border follow-up lands, the shared fields draw their resting
border from `color.border.subtle`. A Loam field reads the field ids:

```css
.frame {
	border: 1px solid var(--color-field-border);
	border-radius: var(--radius-md);
	background: var(--color-field-background);
	color: var(--color-field-text);
}

.frame:hover {
	border-color: var(--color-field-border-hover);
}

.frame:focus-within {
	border-color: var(--color-field-border-focus);
	outline: var(--shell-size-focus) solid var(--color-focus-ring);
	outline-offset: var(--size-space-xs);
}

:host([invalid]) .frame {
	border-color: var(--color-field-border-invalid);
}
```

Invalid also sets `aria-invalid="true"` and shows supporting text in
`--color-state-danger-text`.

## Icons

```ts
import '@lushly-dev/violet-elements/dist/icon/violet-icon.js';
import { registerSystemSearchIcon } from '@lushly-dev/violet-elements/dist/icon/generated/icons/system-search.js';

registerSystemSearchIcon();
```

Importing `violet-icon` registers no icon; without the call, `system/search`
renders the fallback glyph.

```html
<button type="button" class="item" aria-label="Search commands" title="Search commands">
	<violet-icon icon="system/search" decorative></violet-icon>
</button>
```

```css
.item violet-icon {
	--violet-icon-size: var(--size-line-sm);
}
```

- `size.line.sm` (16px) in the title bar and status bar; `size.line.md`
  (20px) in the rail, the tab bar and part headers. Beside text, leave the
  default 1em.
- Import `violet-icon` from `@lushly-dev/violet-elements/dist/<component>/…`,
  never the package root.

## A layout class rule

```css
:host([data-layout-class='compact']) .rail,
:host([data-layout-class='compact']) .statusbar {
	display: none;
}
```

Read `data-layout-class`, not a media query, for the class itself; the chrome
sets it from `matchMedia` at 640px and 1024px. Breakpoint lengths are allowed
only in `@media` and `@container` conditions.
