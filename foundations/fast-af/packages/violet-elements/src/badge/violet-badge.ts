import { FASTElement, attr, css, html, when, type PartialFASTElementDefinition } from "@lushly-dev/fast-element";

import { violetSurfaceTokenDefaults } from "../theme/violet-token-defaults";

export type VioletBadgeAppearance = "filled" | "outline" | "subtle";
export type VioletBadgeColor = "neutral" | "accent" | "success" | "warning" | "danger";
export type VioletBadgeSize = "sm" | "md" | "lg";

const styles = css`
    ${violetSurfaceTokenDefaults}

    :host {
        display: inline-flex;
        /* The tone is the fill and the words. A neutral badge is a wash of the text colour. */
        --_badge-bg: color-mix(in srgb, var(--_text-primary) 8%, transparent);
        --_badge-text: var(--_text-secondary);
        --_badge-padding-inline: var(--_space-md);
        --_badge-min-block: 1.25rem;
        --_badge-font-size: var(--_caption-size);
        --_badge-line-height: var(--_caption-line);
    }

    :host([size="sm"]) {
        --_badge-padding-inline: var(--_space-sm);
        --_badge-min-block: 1.125rem;
    }

    :host([size="md"]) {
        --_badge-padding-inline: var(--_space-md);
        --_badge-min-block: 1.25rem;
    }

    :host([size="lg"]) {
        --_badge-padding-inline: var(--_space-lg);
        --_badge-min-block: 1.5rem;
        --_badge-font-size: var(--_body-size);
        --_badge-line-height: var(--_body-line);
    }

    :host([color="accent"]) {
        --_badge-bg: var(--violet-color-accent-background, #dfecf4);
        --_badge-text: var(--violet-color-accent-text, #1b5f80);
    }

    :host([color="success"]) {
        --_badge-bg: var(--violet-color-state-success-background, #dfeae3);
        --_badge-text: var(--violet-color-state-success-text, #2c5e4b);
    }

    :host([color="warning"]) {
        --_badge-bg: var(--violet-color-state-warning-background, #f3e8d2);
        --_badge-text: var(--violet-color-state-warning-text, #92400E);
    }

    :host([color="danger"]) {
        --_badge-bg: var(--violet-color-state-danger-background, #f7e4df);
        --_badge-text: var(--violet-color-state-danger-text, #c42a1a);
    }

    .badge {
        box-sizing: border-box;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: var(--_space-sm);
        min-block-size: var(--_badge-min-block);
        min-inline-size: var(--_badge-min-block);
        padding-inline: var(--_badge-padding-inline);
        border: 1px solid transparent;
        border-radius: calc(var(--_radius-md) - 2px);
        background: var(--_badge-bg);
        color: var(--_badge-text);
        font-size: var(--_badge-font-size);
        font-weight: var(--_type-label-weight);
        line-height: var(--_badge-line-height);
        white-space: nowrap;
    }

    /* An outline badge is the one place the outline is the point. */
    :host([appearance="outline"]) .badge {
        background: transparent;
        border-color: color-mix(in srgb, currentColor 45%, transparent);
    }

    :host([appearance="subtle"]) .badge {
        background: color-mix(in srgb, var(--_badge-bg) 65%, transparent);
    }

    .content {
        display: inline-flex;
        align-items: center;
    }

    .content::slotted(*) {
        margin: 0;
    }

    violet-icon {
        --violet-icon-size: 0.9em;
    }

    /* The second selector matches the appearance rules' specificity, so the system colours win for each. */
    @media (forced-colors: active) {
        .badge,
        :host([appearance]) .badge {
            forced-color-adjust: none;
            background: Canvas;
            color: CanvasText;
            border-color: ButtonText;
        }
    }
`;

const template = html<VioletBadge>`
    <span class="badge" part="badge" aria-hidden="${x => (x.decorative ? "true" : "false")}">
        ${when(
            x => Boolean(x.icon),
            html<VioletBadge>`
                <violet-icon icon="${x => x.icon}" decorative="true" part="icon"></violet-icon>
            `
        )}
        <span class="content" part="content">
            <slot></slot>
        </span>
    </span>
`;

/**
 * Compact semantic badge for status, category, and count-like labeling.
 *
 * @summary Token-driven inline badge with semantic color and emphasis variants.
 * @slot - Badge text or short inline content.
 * @csspart badge - The outer pill surface.
 * @csspart icon - Optional leading icon.
 * @csspart content - Wrapper around slotted badge content.
 */
export class VioletBadge extends FASTElement {
    declare public appearance: VioletBadgeAppearance;
    declare public color: VioletBadgeColor;
    declare public size: VioletBadgeSize;
    declare public decorative: boolean;
    declare public icon: string;
    declare public label: string;

    public constructor() {
        super();
        this.label = "";
        this.appearance = "filled";
        this.color = "neutral";
        this.size = "md";
        this.decorative = false;
        this.icon = "";
    }

    public connectedCallback(): void {
        super.connectedCallback();
        this.syncAccessibilityState();
    }

    public decorativeChanged(): void {
        this.syncAccessibilityState();
    }

    public labelChanged(): void {
        this.syncAccessibilityState();
    }

    private syncAccessibilityState(): void {
        if (this.decorative) {
            this.setAttribute("aria-hidden", "true");
            this.removeAttribute("aria-label");
            this.removeAttribute("role");
            return;
        }

        this.removeAttribute("aria-hidden");

        const label = (this.label ?? "").trim();

        if (label) {
            this.setAttribute("role", "img");
            this.setAttribute("aria-label", label);
            return;
        }

        this.removeAttribute("role");
        this.removeAttribute("aria-label");
    }
}

attr(VioletBadge.prototype, "appearance");
attr(VioletBadge.prototype, "color");
attr(VioletBadge.prototype, "size");
attr({ mode: "boolean" })(VioletBadge.prototype, "decorative");
attr(VioletBadge.prototype, "icon");
attr(VioletBadge.prototype, "label");

/** The FAST definition of `<violet-badge>`; `defineVioletBadge` in `./violet-badge.define` registers it. */
export const violetBadgeDefinition = {
    name: "violet-badge",
    template,
    styles,
} satisfies PartialFASTElementDefinition;
