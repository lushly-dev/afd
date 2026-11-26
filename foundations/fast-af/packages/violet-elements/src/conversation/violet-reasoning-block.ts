import {
  attr,
  css,
  FASTElement,
  html,
  type PartialFASTElementDefinition,
} from "@lushly-dev/fast-element";
import { registerSystemChevronRightIcon } from "../icon/generated/icons/system-chevron-right";
import { violetSurfaceTokenDefaults } from "../theme/violet-token-defaults";

const styles = css`
    ${violetSurfaceTokenDefaults}

    :host {
        display: block;
        --_reasoning-bg: var(--violet-reasoning-bg, transparent);
        --_reasoning-border: var(--violet-reasoning-border, transparent);
        --_reasoning-font-size: var(--violet-reasoning-font-size, var(--_caption-size));
        --_reasoning-line-height: var(--violet-reasoning-line-height, var(--_caption-line));
        --_reasoning-toggle-size: var(--violet-reasoning-toggle-size, var(--_body-size));
    }

    /*
     * A line of muted text that opens, not a box. A host that wants the box sets the fill and the
     * edge; the edge is a ring, so it takes no room while it is clear.
     */
    .root {
        border-radius: var(--_radius-md);
        background: var(--_reasoning-bg);
        box-shadow: 0 0 0 var(--_card-border-width, 1px) var(--_reasoning-border);
    }

    .toggle {
        all: unset;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        gap: var(--_space-sm);
        border-radius: var(--_radius-sm);
        font-size: var(--_reasoning-toggle-size);
        color: var(--_text-muted);
        cursor: pointer;
    }

    .toggle:hover {
        color: var(--_text-primary);
    }

    .toggle:focus-visible {
        outline: none;
        box-shadow: 0 0 0 2px var(--_focus-ring);
    }

    .chevron {
        display: inline-flex;
        transition: transform 0.2s ease;
        --violet-icon-size: var(--_reasoning-line-height);
    }

    :host([expanded]) .chevron {
        transform: rotate(90deg);
    }

    .streaming-indicator {
        display: none;
        inline-size: var(--_reasoning-font-size);
        block-size: var(--_reasoning-font-size);
        border-radius: var(--_radius-round);
        background: currentColor;
        animation: pulse 1.4s ease-in-out infinite;
    }

    :host([state="streaming"]) .streaming-indicator {
        display: inline-block;
    }

    /* The text hangs under the label, clear of the chevron. */
    .content {
        padding-block-start: var(--_space-stack-xs);
        padding-inline-start: calc(var(--_reasoning-line-height) + var(--_space-sm));
        font-size: var(--_reasoning-font-size);
        line-height: var(--_reasoning-line-height);
        color: var(--_text-muted);
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
            background: Canvas;
            box-shadow: 0 0 0 var(--_card-border-width, 1px) ButtonText;
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
            aria-expanded="${(x) => String(x.expanded)}"
            aria-controls="reasoning-content"
            @click="${(x) => x.toggleExpanded()}"
        >
            <span class="chevron"><violet-icon icon="system/chevron-right" decorative></violet-icon></span>
            ${(x) => x.label}
            <span class="streaming-indicator" aria-hidden="true"></span>
        </button>
        <div
            class="content"
            part="content"
            id="reasoning-content"
            role="region"
            ?hidden="${(x) => !x.expanded}"
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

/** The FAST definition of `<violet-reasoning-block>`; `defineVioletReasoningBlock` in `./violet-reasoning-block.define` registers it. */
export const violetReasoningBlockDefinition = {
  name: "violet-reasoning-block",
  template,
  styles,
} satisfies PartialFASTElementDefinition;
