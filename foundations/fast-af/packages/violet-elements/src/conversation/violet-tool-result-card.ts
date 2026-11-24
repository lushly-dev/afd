import { FASTElement, attr, css, html, observable, type PartialFASTElementDefinition } from "@lushly-dev/fast-element";

import { violetSurfaceTokenDefaults } from "../theme/violet-token-defaults";
import { registerSystemCheckmarkIcon } from "../icon/generated/icons/system-checkmark";
import { registerSystemDismissIcon } from "../icon/generated/icons/system-dismiss";
import { registerSystemChevronRightIcon } from "../icon/generated/icons/system-chevron-right";

const styles = css`
    ${violetSurfaceTokenDefaults}

    :host {
        display: block;
        --_result-font-size: var(--violet-result-font-size, var(--_caption-size));
        --_result-line-height: var(--violet-result-line-height, var(--_caption-line));
        --_success-text: var(--violet-color-state-success-text, #2c5e4b);
    }

    /* What came back is a line under the command; opened, its output sits in a well. */
    .frame {
        display: block;
        --violet-card-radius: var(--_radius-md);
        --violet-card-border-color: transparent;
        --violet-card-background: transparent;
        --violet-card-shadow: none;
    }

    /* Nothing is boxed, so the line's focus ring must not be clipped. */
    .frame::part(root) {
        overflow: visible;
    }

    .summary {
        display: flex;
        align-items: center;
        gap: var(--_space-sm);
        padding: 0;
        font-family: inherit;
        font-size: var(--_result-font-size);
        line-height: var(--_result-line-height);
        color: var(--_text-muted);
        cursor: pointer;
        border: none;
        border-radius: var(--_radius-sm);
        background: none;
        text-align: start;
    }

    .summary:hover {
        color: var(--_text-primary);
    }

    .summary:focus-visible {
        outline: none;
        box-shadow: 0 0 0 2px var(--_focus-ring);
    }

    .status-icon {
        flex-shrink: 0;
        display: inline-flex;
        --violet-icon-size: var(--_result-line-height);
    }

    :host([state="output-available"]) .status-icon {
        color: var(--_success-text);
    }

    :host([state="output-error"]) .status-icon {
        color: var(--violet-color-state-danger-text, #c42a1a);
    }

    .summary-text {
        flex: 1;
        min-inline-size: 0;
    }

    slot[name="summary"]::slotted(*) {
        margin: 0;
    }

    .chevron {
        flex-shrink: 0;
        display: inline-flex;
        transition: transform 0.2s ease;
        --violet-icon-size: var(--_result-line-height);
    }

    :host([expanded]) .chevron {
        transform: rotate(90deg);
    }

    .body {
        display: grid;
        gap: var(--_space-stack-2xs);
        margin-block-start: var(--_space-stack-xs);
        padding: var(--_space-sm) var(--_space-md);
        border-block-start: var(--_card-border-width, 1px) solid transparent;
        border-radius: var(--_radius-md);
        background: var(--_surface-subtle);
        font-size: var(--_result-font-size);
        line-height: var(--_result-line-height);
        color: var(--_text-primary);
        white-space: pre-wrap;
        word-break: break-word;
    }

    .body[hidden] {
        display: none;
    }

    .footer {
        display: grid;
        gap: var(--_space-stack-2xs);
        margin-block-start: var(--_space-stack-xs);
        padding: var(--_space-sm) var(--_space-md);
        border-block-start: var(--_card-border-width, 1px) solid transparent;
        border-radius: var(--_radius-md);
        background: var(--_surface-subtle);
        font-size: var(--_result-font-size);
        color: var(--_text-secondary);
    }

    .footer[hidden] {
        display: none;
    }

    .body slot::slotted(*),
    slot[name="footer"]::slotted(*) {
        margin: 0;
    }

    .spinner {
        display: inline-block;
        inline-size: var(--_result-line-height);
        block-size: var(--_result-line-height);
        border: calc(var(--_result-line-height) * 0.125) solid var(--_border-subtle);
        border-block-start-color: var(--_text-secondary);
        border-radius: var(--_radius-round);
        animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
        to { transform: rotate(360deg); }
    }

    @media (prefers-reduced-motion: reduce) {
        .spinner {
            animation-duration: 1.6s;
        }

        .chevron {
            transition: none;
        }
    }

    @media (forced-colors: active) {
        /*
         * The card's slots let what is slotted into a card take the system colours; what this
         * component puts in its card it paints itself, so it opts out again.
         */
        .frame > * {
            forced-color-adjust: none;
        }

        /* What is slotted into this component takes the system colours. */
        slot {
            forced-color-adjust: auto;
            color: CanvasText;
        }

        .frame::part(root) {
            forced-color-adjust: none;
            border-color: ButtonText;
            background: Canvas;
        }

        /* The card's root opts out of forced colours, so its clear rules are drawn here. */
        .body,
        .footer {
            border-block-start-color: ButtonText;
        }

        /* Inside the opted-out root the theme's text colours stay, so the text takes the system's. */
        .summary,
        .summary:hover,
        .status-icon,
        .body,
        .footer {
            color: CanvasText;
        }
        /* Nested controls and icons take the system's colours again. */
        violet-button,
        violet-icon,
        ::slotted(violet-button),
        ::slotted(violet-icon) {
            forced-color-adjust: auto;
        }
    }
`;

const template = html<VioletToolResultCard>`
    <violet-card class="frame" part="root" appearance="outline">
        <button
            class="summary"
            part="summary"
            type="button"
            aria-expanded="${x => String(x.expanded)}"
            @click="${x => x.toggleExpanded()}"
        >
            <span class="status-icon" part="status-icon">
                ${x => x.state === "output-error"
                    ? html`<violet-icon icon="system/dismiss" decorative></violet-icon>`
                    : x.state === "output-available"
                        ? html`<violet-icon icon="system/checkmark" decorative></violet-icon>`
                        : html`<span class="spinner" aria-label="In progress"></span>`
                }
            </span>
            <span class="summary-text">
                <slot name="summary">
                    ${x => {
                        if (x.state === "output-error") {
                            return "Tool failed";
                        }
                        if (x.state === "output-available") {
                            return "Tool completed";
                        }
                        if (x.state === "executing") {
                            return "Tool running";
                        }
                        return "Waiting for output";
                    }}
                </slot>
            </span>
            <span class="chevron">
                <violet-icon icon="system/chevron-right" decorative></violet-icon>
            </span>
        </button>
        <div class="body" part="body" ?hidden="${x => !x.expanded}">
            <slot></slot>
        </div>
        <div class="footer" part="footer" ?hidden="${x => !x.expanded || !x.hasFooter}">
            <slot name="footer" @slotchange="${x => x.handleFooterSlotChange()}"></slot>
        </div>
    </violet-card>
`;

/**
 * Violet tool result card.
 *
 * @summary Renders tool execution output with collapsible detail view.
 *          Maps to TanStack AI ToolResultPart.
 * @slot summary - Compact result summary line.
 * @slot - Result body content.
 * @slot footer - Optional metadata.
 * @csspart root - The outer container.
 * @csspart summary - The clickable summary row.
 * @csspart status-icon - The success/error icon.
 * @csspart body - The collapsible body.
 * @csspart footer - The metadata footer.
 */
export class VioletToolResultCard extends FASTElement {
    declare public state: string;
    declare public expanded: boolean;

    @observable
    declare public hasFooter: boolean;

    public constructor() {
        super();
        this.state = "pending";
        this.expanded = false;
        this.hasFooter = false;
    }

    public connectedCallback(): void {
        super.connectedCallback();
        registerSystemCheckmarkIcon();
        registerSystemDismissIcon();
        registerSystemChevronRightIcon();
    }

    public toggleExpanded(): void {
        this.expanded = !this.expanded;
    }

    public handleFooterSlotChange(): void {
        const slot = this.shadowRoot?.querySelector('slot[name="footer"]') as HTMLSlotElement | null;
        this.hasFooter = (slot?.assignedNodes({ flatten: true }) ?? []).some(node => {
            if (node.nodeType === Node.TEXT_NODE) {
                return Boolean(node.textContent?.trim());
            }
            return true;
        });
    }
}

export type VioletToolResultState =
    | "pending"
    | "executing"
    | "output-available"
    | "output-error";

attr(VioletToolResultCard.prototype, "state");
attr({ mode: "boolean" })(VioletToolResultCard.prototype, "expanded");

/** The FAST definition of `<violet-tool-result-card>`; `defineVioletToolResultCard` in `./violet-tool-result-card.define` registers it. */
export const violetToolResultCardDefinition = {
    name: "violet-tool-result-card",
    template,
    styles,
} satisfies PartialFASTElementDefinition;
