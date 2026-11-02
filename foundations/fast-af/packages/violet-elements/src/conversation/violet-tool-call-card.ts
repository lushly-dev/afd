import { FASTElement, attr, css, html, observable } from "@lushly-dev/fast-element";

import { violetSurfaceTokenDefaults } from "../theme/violet-token-defaults";
import { registerSystemSettingsIcon } from "../icon/generated/icons/system-settings";
import "../icon/violet-icon";
import "../card/violet-card";
import "./violet-approval-card";

const styles = css`
    ${violetSurfaceTokenDefaults}

    :host {
        display: block;
        --_tool-font-size: var(--violet-tool-font-size, var(--_caption-size, 12px));
        --_tool-line-height: var(--violet-tool-line-height, var(--_caption-line, 16px));
        --_tool-name-size: var(--violet-tool-name-size, var(--_body-size, 14px));
        --_warning-bg: var(--color-state-warning-background, #fdebcc);
        --_warning-text: var(--color-state-warning-text, #92400e);
        --_warning-border: var(--color-state-warning-border, rgba(245, 158, 11, 0.34));
        --_success-bg: var(--color-state-success-background, #e3f1e7);
        --_success-text: var(--color-state-success-text, #166534);
        --_success-border: var(--color-state-success-border, rgba(22, 101, 52, 0.28));
        --_danger-bg: var(--color-state-danger-background, #fbe2e2);
        --_danger-text-local: var(--color-state-danger-text, #b42318);
        --_danger-border: var(--color-state-danger-border, rgba(220, 38, 38, 0.34));
    }

    .frame {
        display: block;
        --violet-card-border-color: var(--_border-subtle);
        --violet-card-background: var(--_surface-card);
        --violet-card-shadow: none;
    }

    .frame::part(root) {
        overflow: hidden;
    }

    :host([state="approval-requested"]) .frame {
        --violet-card-border-color: var(--_warning-border);
    }

    :host([state="output-available"]) .frame {
        --violet-card-border-color: var(--_success-border);
    }

    :host([state="output-error"]) .frame {
        --violet-card-border-color: var(--_danger-border);
    }

    .approval-frame {
        display: block;
    }

    .header {
        display: flex;
        align-items: center;
        gap: var(--_space-sm);
        padding: var(--_space-sm) var(--_space-md);
        border-block-end: var(--_card-border-width, 1px) solid var(--_border-subtle);
        background: var(--_surface-subtle, rgba(28, 26, 13, 0.04));
    }

    .icon {
        flex-shrink: 0;
        display: inline-flex;
        --violet-icon-size: var(--_tool-name-size);
    }

    .name {
        font-size: var(--_tool-name-size);
        font-weight: 600;
        color: var(--_text-primary, #1c1a0d);
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .badge {
        flex-shrink: 0;
        margin-inline-start: auto;
        padding: var(--_space-xs, 4px) var(--_space-sm);
        border-radius: var(--_radius-sm);
        font-size: var(--_tool-font-size);
        font-weight: 600;
        line-height: var(--_tool-line-height);
    }

    :host([state="pending"]) .badge,
    :host([state="executing"]) .badge {
        background: var(--_surface-subtle, rgba(28, 26, 13, 0.04));
        color: var(--_text-secondary, #414651);
    }

    :host([state="approval-requested"]) .badge {
        background: var(--_warning-bg);
        color: var(--_warning-text);
    }

    :host([state="output-available"]) .badge {
        background: var(--_success-bg);
        color: var(--_success-text);
    }

    :host([state="output-error"]) .badge {
        background: var(--_danger-bg);
        color: var(--_danger-text-local);
    }

    :host([state="cancelled"]) .badge {
        background: var(--_surface-subtle, rgba(28, 26, 13, 0.04));
        color: var(--_text-secondary, #414651);
    }

    .body {
        display: grid;
        gap: var(--_space-stack-2xs);
        padding: var(--_space-sm) var(--_space-md);
        font-size: var(--_tool-font-size);
        line-height: var(--_tool-line-height);
        color: var(--_text-secondary, #414651);
    }

    .body:empty,
    .body[hidden] {
        display: none;
    }

    slot[name="summary"]::slotted(*),
    slot[name="input"]::slotted(*),
    slot[name="output"]::slotted(*),
    .body slot::slotted(*) {
        margin: 0;
    }

    .approval-summary {
        display: grid;
        gap: var(--_space-stack-2xs);
    }

    .approval-tool-name {
        font-size: var(--_tool-name-size);
        font-weight: 600;
        line-height: var(--_body-line);
        color: var(--_text-primary);
    }

    .approval-detail {
        display: grid;
        gap: var(--_space-stack-2xs);
    }

    .shimmer {
        display: flex;
        flex-direction: column;
        gap: var(--_space-xs, 4px);
    }

    .shimmer-line {
        block-size: var(--_tool-line-height);
        border-radius: var(--_radius-sm);
        background: linear-gradient(90deg,
            var(--_surface-subtle, rgba(28, 26, 13, 0.04)) 25%,
            var(--_surface-hover, rgba(28, 26, 13, 0.06)) 50%,
            var(--_surface-subtle, rgba(28, 26, 13, 0.04)) 75%);
        background-size: 200% 100%;
        animation: shimmer 1.5s ease-in-out infinite;
    }

    .shimmer-line:last-child {
        inline-size: 60%;
    }

    .spinner {
        display: inline-block;
        inline-size: var(--_tool-line-height);
        block-size: var(--_tool-line-height);
        border: calc(var(--_tool-line-height) * 0.125) solid var(--_border-subtle);
        border-block-start-color: var(--_text-secondary, #414651);
        border-radius: var(--_radius-round, 9999px);
        animation: spin 0.8s linear infinite;
    }

    @keyframes shimmer {
        0% { background-position: -200% 0; }
        100% { background-position: 200% 0; }
    }

    @keyframes spin {
        to { transform: rotate(360deg); }
    }

    @media (prefers-reduced-motion: reduce) {
        .shimmer-line {
            animation: none;
        }

        .spinner {
            animation-duration: 1.6s;
        }
    }

    @media (forced-colors: active) {
        .frame::part(root) {
            forced-color-adjust: none;
            border-color: ButtonText;
            background: Canvas;
        }

        .badge {
            border: var(--_card-border-width, 1px) solid currentColor;
            background: Canvas;
        }
    }
`;

const template = html<VioletToolCallCard>`
    ${x => x.state === "approval-requested"
        ? html<VioletToolCallCard>`
            <violet-approval-card
                class="approval-frame"
                part="root"
                state="pending"
                @approve="${(x, c) => x.handleApprove(c.event)}"
                @deny="${(x, c) => x.handleDeny(c.event)}"
            >
                <div slot="summary" class="approval-summary">
                    <span class="approval-tool-name">${x => x.toolName}</span>
                    <slot name="summary" @slotchange="${x => x.updateHasBody()}"></slot>
                </div>
                <div slot="detail" class="approval-detail" ?hidden="${x => !x.hasDetailContent}">
                    <slot name="input" @slotchange="${x => x.updateHasBody()}"></slot>
                    <slot name="output" @slotchange="${x => x.updateHasBody()}"></slot>
                    <slot @slotchange="${x => x.updateHasBody()}"></slot>
                </div>
            </violet-approval-card>
        `
        : html<VioletToolCallCard>`
            <violet-card class="frame" part="root" appearance="outline" role="region" aria-label="${x => `Tool: ${x.toolName}`}">
                <div class="header" part="header">
                    <span class="icon" part="icon">
                        <slot name="icon"><violet-icon icon="system/settings" decorative></violet-icon></slot>
                    </span>
                    <span class="name" part="name">${x => x.toolName}</span>
                    <span class="badge" part="badge">${x => x.badgeText()}</span>
                </div>
                <div class="body" part="body" ?hidden="${x => x.state === "pending" || !x.hasBody}">
                    ${x => x.state === "executing" ? html`<span class="spinner" role="status" aria-label="Running"></span>` : ""}
                    <slot name="summary" @slotchange="${x => x.updateHasBody()}"></slot>
                    <slot name="input" @slotchange="${x => x.updateHasBody()}"></slot>
                    <slot name="output" @slotchange="${x => x.updateHasBody()}"></slot>
                    <slot @slotchange="${x => x.updateHasBody()}"></slot>
                </div>
                ${x => x.state === "pending" ? html`
                    <div class="body">
                        <div class="shimmer" role="status" aria-label="Loading">
                            <div class="shimmer-line"></div>
                            <div class="shimmer-line"></div>
                        </div>
                    </div>
                ` : ""}
                ${x => x.state === "executing" && !x.hasBody ? html`
                    <div class="body">
                        <span class="spinner" role="status" aria-label="Running"></span>
                    </div>
                ` : ""}
            </violet-card>
        `
    }
`;

/**
 * Violet tool call card.
 *
 * @summary Renders a tool invocation through its TanStack AI lifecycle states.
 *          Maps to TanStack AI ToolCallPart / AI SDK ToolUIPart.
 * @slot icon - Custom icon for the tool (defaults to system/settings icon).
 * @slot summary - Concise description of the tool's purpose.
 * @slot input - Tool arguments display.
 * @slot output - Tool result display.
 * @slot - Additional content.
 * @csspart root - The outer container.
 * @csspart header - The header bar with name and badge.
 * @csspart icon - The tool icon.
 * @csspart name - The tool name.
 * @csspart badge - The state badge.
 * @csspart body - The body content area.
 * @fires approve - Emitted when the delegated approval card is approved. Detail: { toolCallId }.
 * @fires deny - Emitted when the delegated approval card is denied. Detail: { toolCallId }.
 */
export class VioletToolCallCard extends FASTElement {
    declare public toolName: string;
    declare public toolCallId: string;
    declare public state: string;

    @observable
    declare public hasBody: boolean;

    @observable
    declare public hasDetailContent: boolean;

    public constructor() {
        super();
        this.toolName = "";
        this.toolCallId = "";
        this.state = "pending";
        this.hasBody = false;
        this.hasDetailContent = false;
    }

    public connectedCallback(): void {
        super.connectedCallback();
        registerSystemSettingsIcon();
        this.updateHasBody();
    }

    public updateHasBody(): void {
        const summarySlot = this.shadowRoot?.querySelector('slot[name="summary"]') as HTMLSlotElement | null;
        const detailSlots = this.shadowRoot?.querySelectorAll('slot[name="input"], slot[name="output"], .body > slot:not([name]), .approval-detail > slot:not([name])') ?? [];

        const hasSummary = (summarySlot?.assignedNodes({ flatten: true }) ?? []).some(node => {
            if (node.nodeType === Node.TEXT_NODE) {
                return Boolean(node.textContent?.trim());
            }
            return true;
        });

        let hasDetailContent = false;
        for (const slot of detailSlots) {
            const nodes = (slot as HTMLSlotElement).assignedNodes({ flatten: true });
            if (nodes.some(node => node.nodeType !== Node.TEXT_NODE || Boolean(node.textContent?.trim()))) {
                hasDetailContent = true;
                break;
            }
        }

        this.hasBody = hasSummary || hasDetailContent;
        this.hasDetailContent = hasDetailContent;
    }

    public badgeText(): string {
        switch (this.state) {
            case "pending":
                return "Preparing\u2026";
            case "executing":
                return "Running\u2026";
            case "approval-requested":
                return "Needs approval";
            case "output-available":
                return "Complete";
            case "output-error":
                return "Error";
            case "cancelled":
                return "Cancelled";
            default:
                return "";
        }
    }

    public handleApprove(innerEvent?: Event): void {
        innerEvent?.stopPropagation();
        this.$emit("approve", { toolCallId: this.toolCallId });
    }

    public handleDeny(innerEvent?: Event): void {
        innerEvent?.stopPropagation();
        this.$emit("deny", { toolCallId: this.toolCallId });
    }
}

export type VioletToolCallState =
    | "pending"
    | "approval-requested"
    | "executing"
    | "output-available"
    | "output-error"
    | "cancelled";

attr({ attribute: "tool-name" })(VioletToolCallCard.prototype, "toolName");
attr({ attribute: "tool-call-id" })(VioletToolCallCard.prototype, "toolCallId");
attr(VioletToolCallCard.prototype, "state");

if (!customElements.get("violet-tool-call-card")) {
    await FASTElement.define(VioletToolCallCard, {
        name: "violet-tool-call-card",
        template,
        styles,
    });
}
