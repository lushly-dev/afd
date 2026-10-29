import { FASTElement, attr, css, html } from "@lushly-dev/fast-element";

import { violetSurfaceTokenDefaults } from "../theme/violet-token-defaults";

const styles = css`
    ${violetSurfaceTokenDefaults}

    :host {
        display: block;
        --_status-font-size: var(--violet-status-font-size, var(--_caption-size, 12px));
        --_status-line-height: var(--violet-status-line-height, var(--_caption-line, 16px));
        --_status-indicator-size: var(--violet-status-indicator-size, var(--_caption-line, 16px));
        --_status-dot-size: calc(var(--_status-indicator-size) * 0.375);
        --_status-streaming-dot-size: calc(var(--_status-indicator-size) * 0.25);
        --_status-streaming-gap: calc(var(--_status-streaming-dot-size) * 0.75);
    }

    .root {
        display: flex;
        align-items: center;
        gap: var(--_space-sm);
        padding: var(--_space-sm) 0;
        font-size: var(--_status-font-size);
        line-height: var(--_status-line-height);
        color: var(--_text-secondary, #414651);
    }

    .indicator {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        inline-size: var(--_status-indicator-size);
        block-size: var(--_status-indicator-size);
    }

    .dot {
        inline-size: var(--_status-dot-size);
        block-size: var(--_status-dot-size);
        border-radius: var(--_radius-round, 9999px);
        background: currentColor;
    }

    :host([status="submitted"]) .dot {
        animation: pulse 1.4s ease-in-out infinite;
    }

    :host([status="streaming"]) .indicator,
    :host([status="retrying"]) .indicator {
        display: inline-flex;
        gap: var(--_status-streaming-gap);
    }

    .streaming-dot {
        inline-size: var(--_status-streaming-dot-size);
        block-size: var(--_status-streaming-dot-size);
        border-radius: var(--_radius-round, 9999px);
        background: currentColor;
        animation: bounce 1.2s ease-in-out infinite;
    }

    .streaming-dot:nth-child(2) {
        animation-delay: 0.15s;
    }

    .streaming-dot:nth-child(3) {
        animation-delay: 0.3s;
    }

    :host([status="error"]) .root {
        color: var(--_danger-text, #dc2626);
    }

    :host([status="error"]) .dot {
        background: var(--_danger-text, #dc2626);
    }


    .text {
        min-inline-size: 0;
    }

    @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.3; }
    }

    @keyframes bounce {
        0%, 60%, 100% { transform: translateY(0); }
        30% { transform: translateY(-4px); }
    }


    @media (prefers-reduced-motion: reduce) {
        :host([status="submitted"]) .dot,
        .streaming-dot {
            animation: none;
        }
    }

    @media (forced-colors: active) {
        .root {
            color: ButtonText;
        }

        :host([status="error"]) .root {
            color: LinkText;
        }
    }
`;

const template = html<VioletMessageStatus>`
    <div class="root" part="root" role="status" aria-live="polite">
        <span class="indicator" part="indicator">
            ${x => {
                if (x.status === "streaming" || x.status === "retrying") {
                    return html`
                        <span class="streaming-dot" aria-hidden="true"></span>
                        <span class="streaming-dot" aria-hidden="true"></span>
                        <span class="streaming-dot" aria-hidden="true"></span>
                    `;
                }
                return html`<span class="dot" aria-hidden="true"></span>`;
            }}
        </span>
        <span class="text" part="text">
            <slot>${x => x.defaultText()}</slot>
        </span>
    </div>
`;

/**
 * Violet message status indicator.
 *
 * @summary Compact status row for showing chat state between messages.
 *          Maps to TanStack AI / AI SDK streaming status values.
 * @slot - Custom status text (overrides default).
 * @csspart root - The status row.
 * @csspart indicator - The animated indicator icon.
 * @csspart text - The status text.
 */
export class VioletMessageStatus extends FASTElement {
    declare public status: string;

    public constructor() {
        super();
        this.status = "streaming";
    }

    public defaultText(): string {
        switch (this.status) {
            case "submitted":
                return "Thinking\u2026";
            case "streaming":
                return "Responding\u2026";
            case "error":
                return "Something went wrong";
            case "cancelled":
                return "Stopped";
            case "retrying":
                return "Retrying\u2026";
            default:
                return "";
        }
    }
}

export type VioletMessageStatusType = "submitted" | "streaming" | "error" | "cancelled" | "retrying";

attr(VioletMessageStatus.prototype, "status");

if (!customElements.get("violet-message-status")) {
    await FASTElement.define(VioletMessageStatus, {
        name: "violet-message-status",
        template,
        styles,
    });
}
