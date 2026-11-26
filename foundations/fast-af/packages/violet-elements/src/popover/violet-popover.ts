import {
  attr,
  css,
  FASTElement,
  html,
  type PartialFASTElementDefinition,
} from "@lushly-dev/fast-element";

import {
  bindOverlayAnchor,
  createAnchorName,
  LazyFallbackPositionController,
} from "../shared/overlay-anchor";
import { violetSurfaceTokenDefaults } from "../theme/violet-token-defaults";

let violetPopoverId = 0;

const styles = css`
    ${violetSurfaceTokenDefaults}

    :host {
        display: inline-block;
        position: relative;

        --_popover-padding: var(--violet-popover-padding, var(--_space-md));
        --_popover-min-inline: var(--violet-popover-min-inline-size, 16rem);
        --_popover-max-inline: var(--violet-popover-max-inline-size, min(24rem, calc(100vw - 24px)));
        --_popover-radius: var(--violet-popover-radius, var(--_radius-lg));
        --_popover-background: var(--violet-popover-background, var(--_surface-floating));
        --_popover-shadow: var(--violet-popover-shadow, var(--_shadow-floating));
        /* What floats is its surface and shadow. The edge is kept, clear, for forced colours. */
        --_popover-border: var(--violet-popover-border, transparent);
        --_popover-gap: var(--violet-popover-gap, var(--_space-sm));
    }

    .anchor {
        display: inline-block;
    }

    .surface {
        box-sizing: border-box;
        position: fixed;
        inset: unset;
        margin: 0;
        min-inline-size: var(--_popover-min-inline);
        max-inline-size: var(--_popover-max-inline);
        padding: var(--_popover-padding);
        border: 1px solid var(--_popover-border);
        border-radius: var(--_popover-radius);
        background: var(--_popover-background);
        box-shadow: var(--_popover-shadow);
        color: inherit;
        font-family: inherit;
        z-index: var(--_layer-popover);

        opacity: 0;
        transform: translateY(calc(var(--_space-sm) * -0.5)) scale(0.98);
        transition: opacity, transform, display allow-discrete, overlay allow-discrete;
        transition-duration: var(--_duration-fast);
        transition-timing-function: var(--_easing-standard);
    }

    .surface:popover-open {
        opacity: 1;
        transform: translateY(0) scale(1);

        @starting-style {
            opacity: 0;
            transform: translateY(calc(var(--_space-sm) * -0.5)) scale(0.98);
        }
    }

    @supports (anchor-name: --a) and (position-area: block-end center) and (position-try-fallbacks: flip-block) {
        .surface {
            position-area: block-end center;
            margin-block-start: var(--_popover-gap);
            position-try-fallbacks: flip-block;
        }

        :host([positioning="above"]) .surface {
            position-area: block-start center;
            margin-block: 0 var(--_popover-gap);
        }

        :host([positioning="before"]) .surface {
            position-area: center left;
            margin-block-start: 0;
            margin-inline-end: var(--_popover-gap);
            position-try-fallbacks: flip-inline;
        }

        :host([positioning="after"]) .surface {
            position-area: center right;
            margin-block-start: 0;
            margin-inline-start: var(--_popover-gap);
            position-try-fallbacks: flip-inline;
        }
    }

    .surface::backdrop {
        background: transparent;
    }

    @media (forced-colors: active) {
        .surface {
            forced-color-adjust: none;
            background: Canvas;
            color: CanvasText;
            border-color: ButtonText;
            box-shadow: none;
        }
    }
`;

const template = html<VioletPopover>`<span class="anchor" part="anchor"><slot name="trigger" @click="${(x) => x.handleTriggerClick()}"></slot></span><div class="surface" part="surface" id="${(x) => x.surfaceId}" popover="auto" @toggle="${(x, c) => x.handleToggle(c.event as ToggleEvent)}"><slot></slot></div>`;

/**
 * Generic anchored floating surface.
 *
 * @summary Token-driven popover surface built on the native HTML Popover API.
 * @fires open-change - Emitted when the popover opens or closes. Detail: `{ open: boolean }`.
 * @slot trigger - Optional trigger element that toggles the popover.
 * @slot - Popover body content.
 * @csspart anchor - The wrapper around the trigger slot used as the anchor.
 * @csspart surface - The floating surface container.
 */
export class VioletPopover extends FASTElement {
  declare public open: boolean;
  declare public positioning: string;
  declare public anchor: string;

  public readonly surfaceId: string;
  public readonly anchorName: string;

  #externalAnchor: HTMLElement | null = null;
  #fallbackPosition = new LazyFallbackPositionController();

  public constructor() {
    super();
    const id = violetPopoverId;
    violetPopoverId += 1;
    this.surfaceId = `violet-popover-${id}`;
    this.anchorName = createAnchorName("violet-popover", id);
    this.open = false;
    this.positioning = "below";
    this.anchor = "";
  }

  public connectedCallback(): void {
    super.connectedCallback();
    this.#resolveExternalAnchor();
    this.#syncAnchoring();

    if (this.open) {
      this.show();
    }
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#fallbackPosition.stop(this.#surface);
    this.#detachExternalAnchor();
  }

  public openChanged(): void {
    if (!this.$fastController.isConnected) {
      return;
    }

    if (this.open) {
      this.show();
    } else {
      this.hide();
    }
  }

  public positioningChanged(): void {
    if (this.open) {
      this.#fallbackPosition.update();
    }
  }

  public anchorChanged(): void {
    if (!this.$fastController.isConnected) {
      return;
    }

    this.#detachExternalAnchor();
    this.#resolveExternalAnchor();
    this.#syncAnchoring();
    if (this.open) {
      this.#startFallbackPosition();
    }
  }

  public show(): void {
    this.#surface?.showPopover();
  }

  public hide(): void {
    if (this.#surface?.matches(":popover-open")) {
      this.#surface.hidePopover();
    }
  }

  public toggle(): void {
    this.#surface?.togglePopover();
  }

  public handleTriggerClick(): void {
    this.toggle();
  }

  public handleToggle(event: ToggleEvent): void {
    const isOpen = event.newState === "open";
    this.open = isOpen;
    if (isOpen) {
      this.#syncAnchoring();
      this.#startFallbackPosition();
    } else {
      this.#fallbackPosition.stop(this.#surface);
    }
    this.$emit("open-change", { open: isOpen });
  }

  #startFallbackPosition(): void {
    this.#fallbackPosition.start(
      () => this.#externalAnchor ?? this.#el(".anchor"),
      () => this.#surface,
      () => [
        this.positioning,
        "below",
        "center",
        getComputedStyle(this).getPropertyValue("--_popover-gap"),
        this,
        8,
      ],
      // CSS anchor-name is tree-scoped, so an external light-DOM anchor cannot be
      // resolved by position-anchor inside this shadow root; use the geometry fallback.
      Boolean(this.#externalAnchor),
    );
  }

  #el(selector: string): HTMLElement | null {
    return this.shadowRoot?.querySelector(selector) ?? null;
  }

  get #surface(): HTMLElement | null {
    return this.#el(".surface");
  }

  #syncAnchoring(): void {
    bindOverlayAnchor(this.#el(".anchor"), this.#externalAnchor, this.#surface, this.anchorName);
  }

  #resolveExternalAnchor(): void {
    if (!this.anchor) {
      return;
    }

    const element = document.getElementById(this.anchor);
    if (!(element instanceof HTMLElement)) {
      return;
    }

    this.#externalAnchor = element;
    element.addEventListener("click", this.#onTriggerClick);
  }

  #detachExternalAnchor(): void {
    if (!this.#externalAnchor) {
      return;
    }

    this.#externalAnchor.removeEventListener("click", this.#onTriggerClick);
    this.#externalAnchor = null;
  }

  readonly #onTriggerClick = (): void => {
    this.toggle();
  };
}

attr({ mode: "boolean" })(VioletPopover.prototype, "open");
attr(VioletPopover.prototype, "positioning");
attr(VioletPopover.prototype, "anchor");

/** The FAST definition of `<violet-popover>`; `defineVioletPopover` in `./violet-popover.define` registers it. */
export const violetPopoverDefinition = {
  name: "violet-popover",
  template,
  styles,
} satisfies PartialFASTElementDefinition;
