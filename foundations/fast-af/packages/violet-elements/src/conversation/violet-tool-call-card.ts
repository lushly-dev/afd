import {
  attr,
  css,
  FASTElement,
  html,
  observable,
  type PartialFASTElementDefinition,
} from "@lushly-dev/fast-element";
import { registerSystemSettingsIcon } from "../icon/generated/icons/system-settings";
import { violetSurfaceTokenDefaults } from "../theme/violet-token-defaults";

const styles = css`
    ${violetSurfaceTokenDefaults}

    :host {
        display: block;
        --_tool-font-size: var(--violet-tool-font-size, var(--_caption-size));
        --_tool-line-height: var(--violet-tool-line-height, var(--_caption-line));
        --_tool-name-size: var(--violet-tool-name-size, var(--violet-type-label-size, 13px));
        --_tool-icon-size: var(--violet-tool-name-size, var(--_body-size));
        --_warning-bg: var(--violet-color-state-warning-background, #f3e8d2);
        --_warning-text: var(--violet-color-state-warning-text, #92400e);
        --_success-bg: var(--violet-color-state-success-background, #dfeae3);
        --_success-text: var(--violet-color-state-success-text, #2c5e4b);
        --_danger-bg: var(--violet-color-state-danger-background, #f7e4df);
        --_danger-text-local: var(--violet-color-state-danger-text, #c42a1a);
    }

    /* A command the agent ran is a band; its state is the badge, not an outline. */
    .frame {
        display: block;
        --violet-card-radius: var(--_radius-md);
        --violet-card-border-color: transparent;
        --violet-card-background: var(--_surface-subtle);
        --violet-card-shadow: none;
    }

    .frame::part(root) {
        overflow: hidden;
    }

    .approval-frame {
        display: block;
    }

    .header {
        display: flex;
        align-items: center;
        gap: var(--_space-sm);
        padding: var(--_space-sm) var(--_space-md);
        border-block-end: var(--_card-border-width, 1px) solid transparent;
    }

    .icon {
        flex-shrink: 0;
        display: inline-flex;
        --violet-icon-size: var(--_tool-icon-size);
    }

    /* The command's name, in the mono face. */
    .name {
        font-family: var(--violet-font-family-mono, "IBM Plex Mono", ui-monospace, Consolas, monospace);
        font-size: var(--_tool-name-size);
        font-weight: 500;
        color: var(--_text-primary);
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .badge {
        flex-shrink: 0;
        margin-inline-start: auto;
        padding: 0 var(--_space-sm);
        border-radius: var(--_radius-sm);
        font-size: var(--_tool-font-size);
        font-weight: 500;
        line-height: var(--_tool-line-height);
    }

    :host([state="pending"]) .badge,
    :host([state="executing"]) .badge {
        background: var(--_surface-subtle);
        color: var(--_text-secondary);
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
        background: var(--_surface-subtle);
        color: var(--_text-secondary);
    }

    .body {
        display: grid;
        gap: var(--_space-stack-2xs);
        padding: var(--_space-sm) var(--_space-md);
        font-size: var(--_tool-font-size);
        line-height: var(--_tool-line-height);
        color: var(--_text-secondary);
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
        font-family: var(--violet-font-family-mono, "IBM Plex Mono", ui-monospace, Consolas, monospace);
        font-size: var(--_tool-name-size);
        font-weight: 500;
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
        gap: var(--_space-stack-xs);
    }

    .shimmer-line {
        block-size: var(--_tool-line-height);
        border-radius: var(--_radius-sm);
        background: linear-gradient(90deg,
            var(--_surface-subtle) 25%,
            var(--_surface-hover) 50%,
            var(--_surface-subtle) 75%);
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
        border-block-start-color: var(--_text-secondary);
        border-radius: var(--_radius-round);
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

        .badge {
            border: var(--_card-border-width, 1px) solid currentColor;
            background: Canvas;
        }

        /* The card's root opts out of forced colours, so its clear rules are drawn here. */
        .header {
            border-block-end-color: ButtonText;
        }

        /* Inside the opted-out root the theme's text colours stay, so the text takes the system's. */
        .name,
        .badge,
        .body,
        .approval-tool-name {
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

const template = html<VioletToolCallCard>`
    ${(x) =>
      x.state === "approval-requested"
        ? html<VioletToolCallCard>`
            <violet-approval-card
                class="approval-frame"
                part="root"
                state="pending"
                @approve="${(x, c) => x.handleApprove(c.event)}"
                @deny="${(x, c) => x.handleDeny(c.event)}"
            >
                <div slot="summary" class="approval-summary">
                    <span class="approval-tool-name">${(x) => x.toolName}</span>
                    <slot name="summary" @slotchange="${(x) => x.updateHasBody()}"></slot>
                </div>
                <div slot="detail" class="approval-detail" ?hidden="${(x) => !x.hasDetailContent}">
                    <slot name="input" @slotchange="${(x) => x.updateHasBody()}"></slot>
                    <slot name="output" @slotchange="${(x) => x.updateHasBody()}"></slot>
                    <slot @slotchange="${(x) => x.updateHasBody()}"></slot>
                </div>
            </violet-approval-card>
        `
        : html<VioletToolCallCard>`
            <violet-card class="frame" part="root" appearance="outline" role="region" aria-label="${(x) => `Tool: ${x.toolName}`}">
                <div class="header" part="header">
                    <span class="icon" part="icon">
                        <slot name="icon"><violet-icon icon="system/settings" decorative></violet-icon></slot>
                    </span>
                    <span class="name" part="name">${(x) => x.toolName}</span>
                    <span class="badge" part="badge">${(x) => x.badgeText()}</span>
                </div>
                <div class="body" part="body" ?hidden="${(x) => x.state === "pending" || !x.hasBody}">
                    ${(x) => (x.state === "executing" ? html`<span class="spinner" role="status" aria-label="Running"></span>` : "")}
                    <slot name="summary" @slotchange="${(x) => x.updateHasBody()}"></slot>
                    <slot name="input" @slotchange="${(x) => x.updateHasBody()}"></slot>
                    <slot name="output" @slotchange="${(x) => x.updateHasBody()}"></slot>
                    <slot @slotchange="${(x) => x.updateHasBody()}"></slot>
                </div>
                ${(x) =>
                  x.state === "pending"
                    ? html`
                    <div class="body">
                        <div class="shimmer" role="status" aria-label="Loading">
                            <div class="shimmer-line"></div>
                            <div class="shimmer-line"></div>
                        </div>
                    </div>
                `
                    : ""}
                ${(x) =>
                  x.state === "executing" && !x.hasBody
                    ? html`
                    <div class="body">
                        <span class="spinner" role="status" aria-label="Running"></span>
                    </div>
                `
                    : ""}
            </violet-card>
        `}
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
    const summarySlot = this.shadowRoot?.querySelector(
      'slot[name="summary"]',
    ) as HTMLSlotElement | null;
    const detailSlots =
      this.shadowRoot?.querySelectorAll(
        'slot[name="input"], slot[name="output"], .body > slot:not([name]), .approval-detail > slot:not([name])',
      ) ?? [];

    const hasSummary = (summarySlot?.assignedNodes({ flatten: true }) ?? []).some((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        return Boolean(node.textContent?.trim());
      }
      return true;
    });

    let hasDetailContent = false;
    for (const slot of detailSlots) {
      const nodes = (slot as HTMLSlotElement).assignedNodes({ flatten: true });
      if (
        nodes.some((node) => node.nodeType !== Node.TEXT_NODE || Boolean(node.textContent?.trim()))
      ) {
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

/** The FAST definition of `<violet-tool-call-card>`; `defineVioletToolCallCard` in `./violet-tool-call-card.define` registers it. */
export const violetToolCallCardDefinition = {
  name: "violet-tool-call-card",
  template,
  styles,
} satisfies PartialFASTElementDefinition;
