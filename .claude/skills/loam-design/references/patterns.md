# Patterns

CSS for the recurring pieces of Loam's chrome and kit, written as the `css`
tagged templates of FAST-AF elements. Each passes `loam-lint-tokens`. The
rules behind them are in `endpoints/loam/docs/design.md`; step 7 of the
phase 0 specification owns the chrome's exact grid and markup.

## A part

```css
:host {
	display: block;
	background: var(--violet-color-surface-card);
	color: var(--violet-color-text-primary);
	padding: var(--violet-space-layout-panel);
	font-size: var(--violet-type-body-size);
	line-height: var(--violet-type-body-line);
	font-weight: var(--violet-type-body-weight);
	border-inline-end: 1px solid var(--violet-color-border-subtle);
}
```

- Bars (title bar, rail, tab bar, status bar) take `--violet-color-surface-subtle`
  and `--violet-color-text-secondary`; main takes `--violet-color-surface-page` and
  `--violet-space-layout-page`.
- Parts take no `box-shadow` and no `border-radius`.

## The shell's tracks

Only `loam-shell` reads the state properties, which the controller sets
through CSSOM:

```css
:host {
	display: grid;
	grid-template-columns:
		var(--violet-shell-size-rail) var(--_sidebar-width)
		minmax(var(--violet-shell-size-main-min), 1fr) var(--_inspector-width);
	grid-template-rows:
		var(--violet-shell-size-titlebar) 1fr var(--_panel-height)
		var(--violet-shell-size-statusbar);
}
```

The state properties are listed in the chrome's `package.json` under
`loamLintTokens.stateProperties`.

## A type role

Read the three parts of one role together:

```css
.label {
	font-size: var(--violet-type-label-size);
	line-height: var(--violet-type-label-line);
	font-weight: var(--violet-type-label-weight);
}
```

## Focus

```css
:host(:focus-visible) {
	outline: var(--violet-shell-size-focus) solid var(--violet-color-focus-ring);
	outline-offset: var(--violet-space-inline-hairline);
}

@media (forced-colors: active) {
	:host(:focus-visible) {
		outline-color: Highlight;
	}
}
```

`--violet-shell-size-focus` is 3px in high contrast. Only the chrome may read it.

## A neutral item in its states

A rail entry, list row or status item:

```css
.item {
	position: relative;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	min-inline-size: var(--violet-size-target-comfortable);
	min-block-size: var(--violet-size-target-comfortable);
	border-radius: var(--violet-radius-control);
	color: var(--violet-color-text-secondary);
	background: transparent;
	transition: background-color var(--violet-duration-fast) var(--violet-easing-standard);
}

.item:hover {
	background: var(--violet-color-action-secondary-hover);
}

.item:active {
	background: var(--violet-color-action-secondary-pressed);
}

.item[aria-current='page'] {
	background: var(--violet-color-control-selected-background);
	color: var(--violet-color-control-selected-foreground);
}

/* Selection is not color alone: a start-edge bar. */
.item[aria-current='page']::before {
	content: '';
	position: absolute;
	inset-block: var(--violet-space-stack-tight);
	inset-inline-start: 0;
	inline-size: var(--violet-space-inline-hairline);
	background: var(--violet-color-control-selected-foreground);
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
  `--violet-color-surface-subtle`.
- Targets: `--violet-size-target-natural` in the title bar, `--violet-size-target-compact`
  in the status bar.

## A resize handle

```css
:host {
	position: relative;
	inline-size: var(--violet-shell-size-handle);
	background: var(--violet-shell-color-handle-rest);
	cursor: col-resize;
	touch-action: none;
}

/* The 24px hit area, centered on the 4px bar. */
:host::before {
	content: '';
	position: absolute;
	inset-block: 0;
	inset-inline: calc((var(--violet-size-target-compact) - var(--violet-shell-size-handle)) / -2);
}

:host(:hover) {
	background: var(--violet-shell-color-handle-hover);
}

:host(:focus-visible),
:host([data-dragging]) {
	background: var(--violet-shell-color-handle-active);
}

:host(:focus-visible) {
	outline: var(--violet-shell-size-focus) solid var(--violet-color-focus-ring);
	outline-offset: var(--violet-space-inline-hairline);
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
	background: var(--violet-color-surface-floating);
	box-shadow: var(--violet-shadow-floating);
	padding: var(--violet-space-layout-panel);
	opacity: 0;
	transition: opacity var(--violet-duration-fast) var(--violet-easing-standard);
}

.drawer[open] {
	opacity: 1;
	transition: opacity var(--violet-duration-base) var(--violet-easing-emphasized);
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
		transition: opacity var(--violet-duration-fast) var(--violet-easing-standard);
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

The shared fields draw their resting, hover and invalid borders from the field
ids; a Loam field reads all of them:

```css
.frame {
	border: 1px solid var(--violet-color-field-border);
	border-radius: var(--violet-radius-control);
	background: var(--violet-color-field-background);
	color: var(--violet-color-field-text);
}

.frame:hover {
	border-color: var(--violet-color-field-border-hover);
}

.frame:focus-within {
	border-color: var(--violet-color-field-border-focus);
	outline: var(--violet-shell-size-focus) solid var(--violet-color-focus-ring);
	outline-offset: var(--violet-space-inline-hairline);
}

:host([invalid]) .frame {
	border-color: var(--violet-color-field-border-invalid);
}
```

Invalid also sets `aria-invalid="true"` and shows `error-text` in
`part="error-message"` using `--violet-color-state-danger-text` (replacing supporting
text while invalid).

## Icons

```ts
import '@lushly-dev/violet-elements/icon/define';
import { registerSystemSearchIcon } from '@lushly-dev/violet-elements/icons/system-search';

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
	--violet-icon-size: var(--violet-type-caption-line);
}
```

- `type.caption.line` (16px) in the title bar and status bar; `type.body.line`
  (20px) in the rail, the tab bar and part headers. Beside text, leave the
  default 1em.
- Register an element through its subpath, `@lushly-dev/violet-elements/<name>/define`
  (its class alone is `@lushly-dev/violet-elements/<name>`), never the package root,
  which registers every element.

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
