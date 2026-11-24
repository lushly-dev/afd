import { FASTElement, attr, css, html, observable, type PartialFASTElementDefinition } from "@lushly-dev/fast-element";

import { violetSurfaceTokenDefaults } from "../theme/violet-token-defaults";
import { registerSystemCheckmarkIcon } from "../icon/generated/icons/system-checkmark";
import { registerSystemDismissIcon } from "../icon/generated/icons/system-dismiss";
import { registerSystemWarningIcon } from "../icon/generated/icons/system-warning";

const styles = css`
    ${violetSurfaceTokenDefaults}

    :host {
        display: block;
        --_approval-font-size: var(--violet-approval-font-size, var(--_body-size));
        --_approval-line-height: var(--violet-approval-line-height, var(--_body-line));
        --_approval-caption-size: var(--violet-approval-caption-size, var(--_caption-size));
        --_warning-bg-subtle: var(--violet-color-state-warning-background, #f3e8d2);
        --_warning-text: var(--violet-color-state-warning-text, #92400e);
        --_success-bg-subtle: var(--violet-color-state-success-background, #dfeae3);
        --_success-text: var(--violet-color-state-success-text, #2c5e4b);
        --_danger-bg-subtle: var(--violet-color-state-danger-background, #f7e4df);
        --_danger-text: var(--violet-color-state-danger-text, #c42a1a);
    }

    /* The one raised card in a thread: a toned band, the request, and the actions on a band. */
    .frame {
        display: block;
        --violet-card-border-color: transparent;
        --violet-card-background: var(--_surface-card);
        --violet-card-shadow: var(--_shadow-card);
    }

    .frame::part(root) {
        overflow: hidden;
    }

    /* The toned band is the card's header, edge to edge and straight on to the request. */
    .frame::part(header) {
        padding: 0;
    }

    .frame::part(body) {
        border-block-start-color: transparent;
    }

    /* Once it is answered there are no actions to hold. */
    :host(:not([state="pending"])) .frame::part(footer) {
        display: none;
    }

    .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--_space-sm);
        padding: var(--_space-sm) var(--_space-md);
        background: var(--_warning-bg-subtle);
        font-size: var(--violet-type-label-sm-size, 13px);
        line-height: var(--_approval-line-height);
        font-weight: 500;
        color: var(--_warning-text);
    }

    :host([state="approved"]) .header {
        background: var(--_success-bg-subtle);
        color: var(--_success-text);
    }

    :host([state="denied"]) .header {
        background: var(--_danger-bg-subtle);
        color: var(--_danger-text);
    }

    .header-leading {
        display: flex;
        align-items: center;
        gap: var(--_space-sm);
        min-inline-size: 0;
    }

    .header-icon {
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        --violet-icon-size: 1rem;
    }

    .header-title {
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .status-chip {
        flex-shrink: 0;
        margin-inline-start: auto;
        padding: var(--_space-stack-2xs) var(--_space-sm);
        /* The edge is clear; it shows only in forced colours. */
        border: 1px solid transparent;
        border-radius: calc(var(--_radius-md) - 2px);
        background: color-mix(in srgb, currentColor 12%, transparent);
        font-size: var(--_approval-caption-size);
        font-weight: 500;
        line-height: var(--_caption-line);
        color: inherit;
    }

    /* On the danger band any tint takes the label under 4.5:1 in the default theme (the band is
       already the danger background), so the denied chip is drawn by a faint edge instead. */
    :host([state="denied"]) .status-chip {
        background: transparent;
        border-color: color-mix(in srgb, currentColor 40%, transparent);
    }

    .summary {
        display: grid;
        gap: var(--_space-stack-2xs);
        font-size: var(--_approval-font-size);
        line-height: var(--_approval-line-height);
        color: var(--_text-primary);
    }

    .detail {
        display: grid;
        gap: var(--_space-stack-2xs);
        margin-block-start: var(--_space-stack-xs);
        font-size: var(--_approval-caption-size);
        line-height: var(--_caption-line);
        color: var(--_text-muted);
    }

    slot[name="summary"]::slotted(*),
    slot[name="detail"]::slotted(*) {
        margin: 0;
    }

    .detail[hidden] {
        display: none;
    }

    .actions {
        display: flex;
        align-items: center;
        gap: var(--_space-sm);
        padding: 0;
    }

    .actions[hidden] {
        display: none;
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

        .status-chip {
            border-color: currentColor;
        }

        .frame::part(body) {
            border-block-start-color: ButtonText;
        }

        /* Inside the opted-out root the theme's text colours stay, so the text takes the system's. */
        .header,
        :host([state]) .header,
        .summary,
        .detail {
            background: Canvas;
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

const template = html<VioletApprovalCard>`
    <violet-card class="frame" part="root" appearance="outline" padding="medium" aria-label="Action requires approval">
        <div class="header" part="header" slot="header">
            <span class="header-leading">
                <span class="header-icon">
                    ${x => {
                        if (x.state === "approved") {
                            return html`<violet-icon icon="system/checkmark" decorative></violet-icon>`;
                        }
                        if (x.state === "denied") {
                            return html`<violet-icon icon="system/dismiss" decorative></violet-icon>`;
                        }
                        return html`<violet-icon icon="system/warning" decorative></violet-icon>`;
                    }}
                </span>
                <span class="header-title">
                    ${x => {
                        if (x.state === "approved") { return "Approved"; }
                        if (x.state === "denied") { return "Denied"; }
                        return "Approval required";
                    }}
                </span>
            </span>
            <span class="status-chip" part="status-chip">
                ${x => {
                    if (x.state === "approved") { return "Confirmed"; }
                    if (x.state === "denied") { return "Blocked"; }
                    return "Pending";
                }}
            </span>
        </div>
        <div class="summary" part="summary" ?hidden="${x => !x.hasSummary}">
            <slot name="summary" @slotchange="${x => x.handleSummarySlotChange()}"></slot>
        </div>
        <div class="detail" part="detail" ?hidden="${x => !x.hasDetail}">
            <slot name="detail" @slotchange="${x => x.handleDetailSlotChange()}"></slot>
        </div>
        <div class="actions" part="actions" slot="footer" ?hidden="${x => x.state !== "pending"}">
            <slot name="actions">
                <violet-button
                    appearance="primary"
                    part="approve-button"
                    @click="${x => x.handleApprove()}"
                >Approve</violet-button>
                <violet-button
                    appearance="secondary"
                    part="deny-button"
                    @click="${x => x.handleDeny()}"
                >Deny</violet-button>
            </slot>
        </div>
    </violet-card>
`;

/**
 * Violet approval card.
 *
 * @summary Human-in-the-loop approval surface for sensitive tool actions.
 *          Maps to TanStack AI approval-requested / AI SDK approval flow.
 * @slot summary - What action needs approval.
 * @slot detail - Expanded explanation or consequences.
 * @slot actions - Custom action buttons (approve/deny provided by default).
 * @csspart root - The outer container.
 * @csspart header - The status header bar.
 * @csspart summary - The action summary.
 * @csspart detail - The detail section.
 * @csspart actions - The action button row.
 * @csspart approve-button - The default approve button.
 * @csspart deny-button - The default deny button.
 * @fires approve - When the user approves the action.
 * @fires deny - When the user denies the action.
 */
export class VioletApprovalCard extends FASTElement {
    declare public state: string;

    @observable
    declare public hasSummary: boolean;

    @observable
    declare public hasDetail: boolean;

    public constructor() {
        super();
        this.state = "pending";
        this.hasSummary = false;
        this.hasDetail = false;
    }

    public connectedCallback(): void {
        super.connectedCallback();
        registerSystemCheckmarkIcon();
        registerSystemDismissIcon();
        registerSystemWarningIcon();
        this.handleSummarySlotChange();
        this.handleDetailSlotChange();
    }

    public handleApprove(): void {
        this.$emit("approve");
    }

    public handleDeny(): void {
        this.$emit("deny");
    }

    public handleSummarySlotChange(): void {
        const slot = this.shadowRoot?.querySelector('slot[name="summary"]') as HTMLSlotElement | null;
        this.hasSummary = (slot?.assignedNodes({ flatten: true }) ?? []).some(node => {
            if (node.nodeType === Node.TEXT_NODE) {
                return Boolean(node.textContent?.trim());
            }
            return true;
        });
    }

    public handleDetailSlotChange(): void {
        const slot = this.shadowRoot?.querySelector('slot[name="detail"]') as HTMLSlotElement | null;
        this.hasDetail = (slot?.assignedNodes({ flatten: true }) ?? []).some(node => {
            if (node.nodeType === Node.TEXT_NODE) {
                return Boolean(node.textContent?.trim());
            }
            return true;
        });
    }
}

export type VioletApprovalState = "pending" | "approved" | "denied";

attr(VioletApprovalCard.prototype, "state");

/** The FAST definition of `<violet-approval-card>`; `defineVioletApprovalCard` in `./violet-approval-card.define` registers it. */
export const violetApprovalCardDefinition = {
    name: "violet-approval-card",
    template,
    styles,
} satisfies PartialFASTElementDefinition;
