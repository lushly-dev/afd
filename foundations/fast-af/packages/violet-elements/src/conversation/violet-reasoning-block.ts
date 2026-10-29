import { FASTElement, attr, css, html } from "@lushly-dev/fast-element";

import { violetSurfaceTokenDefaults } from "../theme/violet-token-defaults";
import { registerSystemChevronRightIcon } from "../icon/generated/icons/system-chevron-right";
import "../icon/violet-icon";

const styles = css`
    ${violetSurfaceTokenDefaults}

    :host {
        display: block;
        --_reasoning-bg: var(--violet-reasoning-bg, var(--_surface-subtle, rgba(28, 26, 13, 0.04)));
        --_reasoning-border: var(--violet-reasoning-border, var(--_border-subtle));
        --_reasoning-font-size: var(--violet-reasoning-font-size, var(--_caption-size, 12px));
        --_reasoning-line-height: var(--violet-reasoning-line-height, var(--_caption-line, 16px));
        --_reasoning-toggle-size: var(--violet-reasoning-toggle-size, var(--_body-size, 14px));
    }

    .root {
        border-radius: var(--_radius-md);
        border: var(--_card-border-width, 1px) solid var(--_reasoning-border);
        background: var(--_reasoning-bg);
        overflow: hidden;
    }

    .toggle {
        all: unset;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        gap: var(--_space-sm);
        inline-size: 100%;
        padding: var(--_space-sm) var(--_space-md);
        font-size: var(--_reasoning-toggle-size);
        color: var(--_text-secondary, #414651);
        cursor: pointer;
    }

    .toggle:hover {
        background: var(--_surface-hover, rgba(28, 26, 13, 0.06));
    }

    .toggle:focus-visible {
        outline: none;
        box-shadow: inset 0 0 0 2px var(--_focus-ring);
    }

    .chevron {
        display: inline-flex;
        transition: transform 0.2s ease;
        --violet-icon-size: var(--_reasoning-toggle-size);
    }

    :host([expanded]) .chevron {
        transform: rotate(90deg);
    }

    .streaming-indicator {
        display: none;
        inline-size: var(--_reasoning-font-size);
        block-size: var(--_reasoning-font-size);
        border-radius: var(--_radius-round, 9999px);
        background: currentColor;
        animation: pulse 1.4s ease-in-out infinite;
    }

    :host([state="streaming"]) .streaming-indicator {
        display: inline-block;
    }

    .content {
        padding: 0 var(--_space-md) var(--_space-sm);
        font-size: var(--_reasoning-font-size);
        line-height: var(--_reasoning-line-height);
        color: var(--_text-secondary, #414651);
        white-space: pre-wrap;
        word-break: break-word;
    }

    .content[hidden] {
        display: none;
    }

    @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.3; }
    }

    @media (prefers-reduced-motion: reduce) {
        .streaming-indicator {
            animation: none;
        }

        .chevron {
            transition: none;
        }
    }

    @media (forced-colors: active) {
        .root {
            forced-color-adjust: none;
            border-color: ButtonText;
            background: Canvas;
        }

        .toggle:hover {
            background: Highlight;
            color: HighlightText;
        }
    }
`;

const template = html<VioletReasoningBlock>`
    <div class="root" part="root">
        <button
            class="toggle"
            part="toggle"
            type="button"
            aria-expanded="${x => String(x.expanded)}"
            aria-controls="reasoning-content"
            @click="${x => x.toggleExpanded()}"
        >
            <span class="chevron"><violet-icon icon="system/chevron-right" decorative></violet-icon></span>
            ${x => x.label}
            <span class="streaming-indicator" aria-hidden="true"></span>
        </button>
        <div
            class="content"
            part="content"
            id="reasoning-content"
            role="region"
            ?hidden="${x => !x.expanded}"
        >
            <slot></slot>
        </div>
    </div>
`;

/**
 * Violet reasoning block.
 *
 * @summary Collapsible thinking/reasoning region for displaying model
 *          chain-of-thought content. Maps to TanStack AI ThinkingPart /
 *          AI SDK ReasoningUIPart.
 * @slot - Reasoning text content.
 * @csspart root - The outer container.
 * @csspart toggle - The expand/collapse button.
 * @csspart content - The collapsible content region.
 */
export class VioletReasoningBlock extends FASTElement {
    declare public expanded: boolean;
    declare public state: string;
    declare public label: string;

    public constructor() {
        super();
        this.expanded = false;
        this.state = "done";
        this.label = "Thinking";
    }

    public connectedCallback(): void {
        super.connectedCallback();
        registerSystemChevronRightIcon();
    }

    public toggleExpanded(): void {
        this.expanded = !this.expanded;
    }
}

export type VioletReasoningState = "streaming" | "done";

attr({ mode: "boolean" })(VioletReasoningBlock.prototype, "expanded");
attr(VioletReasoningBlock.prototype, "state");
attr(VioletReasoningBlock.prototype, "label");

if (!customElements.get("violet-reasoning-block")) {
    await FASTElement.define(VioletReasoningBlock, {
        name: "violet-reasoning-block",
        template,
        styles,
    });
}
