import {
  attr,
  css,
  FASTElement,
  html,
  type PartialFASTElementDefinition,
} from "@lushly-dev/fast-element";

import { violetSurfaceTokenDefaults } from "../theme/violet-token-defaults";

let violetAccordionItemId = 0;

const styles = css`
    ${violetSurfaceTokenDefaults}

    :host {
        display: block;

        --_target-size-natural: var(--violet-size-target-natural, 32px);
        --_target-size-comfortable: var(--violet-size-target-comfortable, 44px);
        --_auto-target-size: var(--_target-size-natural);
        --_target-size: var(--violet-target-size, var(--_auto-target-size));
        --_control-body-size: var(--violet-control-body-size, var(--_body-size));
        --_accordion-item-border-width: var(--violet-accordion-item-border-width, 1px);
        --_accordion-item-border-color: var(--violet-accordion-item-border-color, var(--_border-subtle));
        --_accordion-item-background: var(--violet-accordion-item-background, transparent);
        --_accordion-item-background-hover: var(--violet-accordion-item-background-hover, var(--_surface-subtle));
        --_accordion-item-background-expanded: var(--violet-accordion-item-background-expanded, transparent);
        --_accordion-item-padding-inline: var(--violet-accordion-item-padding-inline, var(--_space-md));
        /* A one-line heading makes a row one target and one small space tall. */
        --_accordion-item-padding-block: var(
            --violet-accordion-item-padding-block,
            calc((var(--_target-size) + var(--_space-sm) - var(--_body-line)) / 2)
        );
        --_accordion-item-gap: var(--violet-accordion-item-gap, var(--_space-sm));
    }

    /* The accordion is the panel; an item is a section of it, ruled off from the one above. */
    .item {
        border-block-start: var(--_accordion-item-border-width) solid var(--_accordion-item-border-color);
        background: var(--_accordion-item-background);
        overflow: clip;
    }

    :host(:first-of-type) .item {
        border-block-start-width: 0;
    }

    .heading {
        margin: 0;
    }

    .trigger {
        box-sizing: border-box;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--_accordion-item-gap);
        inline-size: 100%;
        min-block-size: var(--_target-size);
        padding: var(--_accordion-item-padding-block) var(--_accordion-item-padding-inline);
        border: 0;
        background: transparent;
        color: inherit;
        cursor: pointer;
        font: inherit;
        text-align: start;
        transition:
            background-color var(--_duration-fast) var(--_easing-standard),
            box-shadow var(--_duration-fast) var(--_easing-standard);
    }

    .trigger:hover {
        background: var(--_accordion-item-background-hover);
    }

    .trigger:focus-visible {
        outline: none;
        box-shadow: inset 0 0 0 2px var(--_focus-ring);
    }

    :host([expanded]) .trigger {
        background: var(--_accordion-item-background-expanded);
    }

    :host([disabled]) .trigger {
        color: var(--_text-muted);
        cursor: not-allowed;
        opacity: 0.7;
    }

    .heading-content {
        min-inline-size: 0;
        font-size: var(--_control-body-size);
        font-weight: var(--_type-label-weight);
        line-height: var(--_body-line);
    }

    .indicator {
        inline-size: 0.4375rem;
        block-size: 0.4375rem;
        flex: 0 0 auto;
        margin-inline-end: 2px;
        /* Physical edges: rotated, they draw a vertical chevron, which must not mirror in right-to-left. */
        border-right: 1.5px solid currentColor;
        border-bottom: 1.5px solid currentColor;
        color: var(--_text-muted);
        transform: rotate(45deg);
        transition: transform var(--_duration-fast) var(--_easing-standard);
    }

    :host([expanded]) .indicator {
        transform: rotate(225deg);
    }

    .panel {
        background: var(--_accordion-item-background-expanded);
    }

    .panel[hidden] {
        display: none;
    }

    .panel-content {
        padding: 0 var(--_accordion-item-padding-inline) var(--_space-md);
        color: var(--_text-secondary);
        font-size: var(--_control-body-size);
        line-height: var(--_body-line);
    }

    @media (any-pointer: coarse) {
        :host {
            --_auto-target-size: var(--_target-size-comfortable);
        }
    }

    @media (forced-colors: active) {
        .item {
            forced-color-adjust: none;
            border-color: ButtonText;
            background: Canvas;
            color: ButtonText;
        }

        .trigger:focus-visible {
            box-shadow: inset 0 0 0 2px Highlight;
        }
    }
`;

const template = html<VioletAccordionItem>`
    <div class="item" part="item">
        <div class="heading" part="heading" role="heading" aria-level="${(x) => x.headingLevel}">
            <button
                class="trigger"
                part="trigger"
                id="${(x) => x.buttonId}"
                type="button"
                ?disabled="${(x) => x.disabled}"
                aria-expanded="${(x) => String(x.expanded)}"
                aria-controls="${(x) => x.panelId}"
                @click="${(x) => x.handleTriggerClick()}"
            >
                <span class="heading-content" part="heading-content">
                    <slot name="heading"></slot>
                </span>
                <span class="indicator" part="indicator" aria-hidden="true"></span>
            </button>
        </div>
        <div
            class="panel"
            part="panel"
            id="${(x) => x.panelId}"
            role="region"
            aria-labelledby="${(x) => x.buttonId}"
            ?hidden="${(x) => !x.expanded}"
        >
            <div class="panel-content" part="panel-content">
                <slot></slot>
            </div>
        </div>
    </div>
`;

/**
 * Violet accordion item.
 *
 * @summary Expandable accordion section with a slotted heading button and panel body.
 * @fires toggle-request - Emitted when the heading button requests a change to the expanded state.
 * @slot heading - Heading content rendered inside the accordion trigger button.
 * @slot - Panel body content.
 * @csspart item - Outer item surface.
 * @csspart heading - Heading wrapper with heading semantics.
 * @csspart trigger - Interactive heading button.
 * @csspart heading-content - Wrapper around the heading slot.
 * @csspart indicator - Chevron indicator.
 * @csspart panel - Expandable panel region.
 * @csspart panel-content - Inner panel body wrapper.
 */
export class VioletAccordionItem extends FASTElement {
  declare public expanded: boolean;
  declare public disabled: boolean;
  declare public headingLevel: number;

  public readonly panelId: string;
  public readonly buttonId: string;

  public constructor() {
    super();
    const id = violetAccordionItemId;
    violetAccordionItemId += 1;

    this.expanded = false;
    this.disabled = false;
    this.headingLevel = 3;

    this.panelId = `violet-accordion-panel-${id}`;
    this.buttonId = `violet-accordion-button-${id}`;
  }

  public focusTrigger(): void {
    this.triggerElement?.focus();
  }

  public handleTriggerClick(): void {
    if (this.disabled) {
      return;
    }

    this.$emit("toggle-request", { expanded: !this.expanded });
  }

  private get triggerElement(): HTMLButtonElement | null {
    return this.shadowRoot?.querySelector(".trigger") ?? null;
  }
}

attr({ mode: "boolean" })(VioletAccordionItem.prototype, "expanded");
attr({ mode: "boolean" })(VioletAccordionItem.prototype, "disabled");
attr({
  attribute: "heading-level",
  converter: {
    fromView: (value: string) => {
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) && parsed >= 1 && parsed <= 6 ? parsed : 3;
    },
    toView: (value: number) => String(value),
  },
})(VioletAccordionItem.prototype, "headingLevel");

/** The FAST definition of `<violet-accordion-item>`; `defineVioletAccordionItem` in `./violet-accordion-item.define` registers it. */
export const violetAccordionItemDefinition = {
  name: "violet-accordion-item",
  template,
  styles,
  shadowOptions: {
    delegatesFocus: true,
  },
} satisfies PartialFASTElementDefinition;
