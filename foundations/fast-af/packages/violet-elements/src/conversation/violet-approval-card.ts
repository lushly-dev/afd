import { FASTElement, attr, css, html, observable } from "@lushly-dev/fast-element";

import { violetSurfaceTokenDefaults } from "../theme/violet-token-defaults";
import { registerSystemCheckmarkIcon } from "../icon/generated/icons/system-checkmark";
import { registerSystemDismissIcon } from "../icon/generated/icons/system-dismiss";
import { registerSystemWarningIcon } from "../icon/generated/icons/system-warning";
import "../icon/violet-icon";
import "../button/violet-button";
import "../card/violet-card";

const styles = css`
    ${violetSurfaceTokenDefaults}

    :host {
        display: block;
        --_approval-font-size: var(--violet-approval-font-size, var(--_body-size, 14px));
        --_approval-line-height: var(--violet-approval-line-height, var(--_body-line, 20px));
        --_approval-caption-size: var(--violet-approval-caption-size, var(--_caption-size, 12px));
        --_approval-border-color: var(--color-state-warning-border, rgba(245, 158, 11, 0.34));
        --_warning-bg-subtle: var(--color-state-warning-background, #fdebcc);
        --_warning-text: var(--color-state-warning-text, #92400e);
        --_success-bg-subtle: var(--color-state-success-background, #e3f1e7);
        --_success-text: var(--color-state-success-text, #166534);
        --_danger-bg-subtle: var(--color-state-danger-background, #fbe2e2);
        --_danger-text: var(--color-state-danger-text, #b42318);
    }

    .frame {
        display: block;
        --violet-card-border-color: var(--_approval-border-color);
        --violet-card-background: var(--_surface-card);
        --violet-card-shadow: none;
    }

    .frame::part(root) {
        overflow: hidden;
    }

    :host([state="approved"]) .frame {
        --violet-card-border-color: var(--color-state-success-border, rgba(22, 101, 52, 0.28));
    }

    :host([state="denied"]) .frame {
        --violet-card-border-color: var(--color-state-danger-border, rgba(220, 38, 38, 0.34));
    }

    .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--_space-sm);
        padding: var(--_space-sm) var(--_space-md);
        background: var(--_warning-bg-subtle);
        font-size: var(--_approval-caption-size);
        font-weight: 600;
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
        inline-size: calc(var(--_approval-line-height) + var(--_space-sm));
        block-size: calc(var(--_approval-line-height) + var(--_space-sm));
        border-radius: var(--_radius-round);
        background: color-mix(in srgb, currentColor 12%, transparent);
        --violet-icon-size: var(--_approval-line-height);
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
        padding: 2px var(--_space-sm);
        border: 1px solid color-mix(in srgb, currentColor 24%, transparent);
        border-radius: var(--_radius-round);
        background: color-mix(in srgb, currentColor 10%, transparent);
        font-size: var(--_approval-caption-size);
        line-height: var(--_approval-line-height);
        color: inherit;
    }

    .summary {
        display: grid;
        gap: var(--_space-stack-2xs);
        font-size: var(--_approval-font-size);
        line-height: var(--_approval-line-height);
        color: var(--_text-primary, #1c1a0d);
    }

    .detail {
        display: grid;
        gap: var(--_space-stack-2xs);
        margin-block-start: var(--_space-sm);
        font-size: var(--_approval-caption-size);
        line-height: var(--_approval-line-height);
        color: var(--_text-secondary, #414651);
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
        .frame::part(root) {
            forced-color-adjust: none;
            border-color: ButtonText;
            background: Canvas;
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

if (!customElements.get("violet-approval-card")) {
    await FASTElement.define(VioletApprovalCard, {
        name: "violet-approval-card",
        template,
        styles,
    });
}
