import { FASTElement, Updates, attr, css, html, observable, type PartialFASTElementDefinition } from "@lushly-dev/fast-element";

import { violetActionTokenDefaults } from "../theme/violet-token-defaults";

export type VioletButtonAppearance = "primary" | "secondary" | "quiet" | "transparent" | "danger";

const styles = css`
    ${violetActionTokenDefaults}

    :host {
        display: inline-flex;
        vertical-align: middle;
        --_space-inline-sm: var(--violet-space-inline-sm, 4px);
        --_space-stack-sm: var(--violet-space-stack-sm, 8px);
    }

    .control {
        box-sizing: border-box;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        /* The target size is a floor: wrapped or text-zoomed labels grow the control. */
        align-self: flex-start;
        inline-size: 100%;
        min-block-size: var(--_target-size);
        min-inline-size: var(--_target-size);
        padding-inline: max(var(--_space-inline-md), calc(var(--_target-size) * 0.375));
        /* A one-line label fills the target exactly; extra lines keep this inset. */
        padding-block: max(0px, calc((var(--_target-size) - var(--_type-body-line)) / 2 - 1px));
        border: thin solid transparent;
        border-radius: var(--_radius-md);
        background: transparent;
        color: inherit;
        box-shadow: none;
        cursor: pointer;
        font-family: inherit;
        font-size: var(--_control-type-size);
        line-height: var(--_type-body-line);
        font-weight: 500;
        transition:
            background-color var(--_duration-fast) var(--_easing-standard),
            color var(--_duration-fast) var(--_easing-standard),
            border-color var(--_duration-fast) var(--_easing-standard),
            box-shadow var(--_duration-base) var(--_easing-standard);
    }

    .control:focus-visible {
        outline: 2px solid var(--_focus-ring);
        outline-offset: calc(var(--_space-inline-sm) / 2);
    }

    /* The filled actions are keys: they sit one step up and go flat when pressed. */
    .control[data-appearance="primary"] {
        background: var(--_action-primary-background);
        color: var(--_action-primary-text);
        box-shadow: var(--_shadow-control);
    }

    .control[data-appearance="primary"]:hover {
        background: var(--_action-primary-hover);
    }

    .control[data-appearance="primary"]:active {
        background: var(--_action-primary-pressed);
        box-shadow: none;
    }

    .control[data-appearance="secondary"] {
        background: var(--_action-secondary-background);
        color: var(--_action-secondary-text);
        border-color: var(--_action-secondary-border);
    }

    .control[data-appearance="secondary"]:hover {
        background: var(--_action-secondary-hover);
    }

    .control[data-appearance="secondary"]:active {
        background: var(--_action-secondary-pressed);
    }

    /* Quiet is text until the pointer is on it. */
    .control[data-appearance="quiet"] {
        color: var(--_text-secondary);
        background: transparent;
    }

    .control[data-appearance="quiet"]:hover {
        background: var(--_action-secondary-background);
    }

    .control[data-appearance="quiet"]:active {
        background: var(--_action-secondary-pressed);
    }

    .control[data-appearance="danger"] {
        background: var(--_action-danger-background);
        color: var(--_action-danger-text);
        box-shadow: var(--_shadow-control);
    }

    .control[data-appearance="danger"]:hover {
        background: var(--_action-danger-hover);
    }

    .control[data-appearance="danger"]:active {
        background: var(--_action-danger-pressed);
        box-shadow: none;
    }

    .control[disabled] {
        opacity: 0.5;
        cursor: not-allowed;
        box-shadow: none;
    }

    .label {
        display: inline-flex;
        align-items: center;
        text-align: center;
    }

    slot[name="before"],
    slot[name="after"] {
        display: inline-flex;
        align-items: center;
        flex: 0 0 auto;
    }

    ::slotted([slot="before"]) {
        margin-inline-end: var(--_space-inline-sm);
    }

    ::slotted([slot="after"]) {
        margin-inline-start: var(--_space-inline-sm);
    }

    .control[data-appearance="transparent"] {
        color: var(--_text-secondary);
        background: transparent;
    }

    .control[data-appearance="transparent"]:hover {
        background: var(--_action-secondary-background);
    }

    .control[data-appearance="transparent"]:active {
        background: var(--_action-secondary-pressed);
    }
`;

const template = html<VioletButton>`
    <button
        class="control"
        part="control"
        type="${x => x.type}"
        data-appearance="${x => x.appearance}"
        ?disabled="${x => x.disabled}"
        aria-label="${x => x.ariaLabel || null}"
        aria-description="${x => x.ariaDescription || null}"
        aria-expanded="${x => x.ariaExpanded}"
        aria-haspopup="${x => x.ariaHasPopup}"
        aria-keyshortcuts="${x => x.ariaKeyShortcuts}"
        aria-pressed="${x => x.ariaPressed}"
    >
        <slot name="before" part="before"></slot>
        <span class="label" part="label"><slot></slot></span>
        <slot name="after" part="after"></slot>
    </button>
`;

/** The id-list attributes the button forwards, and the inner button's element-reference property for each. */
const REFERENCES = {
    "aria-labelledby": "ariaLabelledby",
    "aria-describedby": "ariaDescribedby",
    "aria-errormessage": "ariaErrormessage",
    "aria-controls": "ariaControls",
} as const;
const REFERENCE_DOM_PROPERTIES = {
    "aria-labelledby": "ariaLabelledByElements",
    "aria-describedby": "ariaDescribedByElements",
    "aria-errormessage": "ariaErrorMessageElements",
    "aria-controls": "ariaControlsElements",
} as const;
type ReferenceAttribute = keyof typeof REFERENCES;
type ElementReferences = Record<(typeof REFERENCE_DOM_PROPERTIES)[ReferenceAttribute], Element[] | null>;

/**
 * Violet reusable button primitive.
 *
 * @summary Token-driven action button for primary, secondary, quiet, transparent, and danger actions.
 * @slot before - Leading inline content such as an icon.
 * @slot - Button label content.
 * @slot after - Trailing inline content such as a status glyph.
 * @csspart control - Native button control element.
 * @csspart before - Leading slot wrapper.
 * @csspart label - Inline label wrapper.
 * @csspart after - Trailing slot wrapper.
 */
export class VioletButton extends FASTElement {
    /**
     * Visual emphasis variant for the button. `quiet` and `transparent` render the same, as text
     * until the pointer is on it; `transparent` is kept for existing markup.
     */
    declare public appearance: VioletButtonAppearance;

    /**
     * Native button type forwarded to the internal control.
     */
    declare public type: "button" | "submit" | "reset";

    /**
     * Disables the button.
     */
    declare public disabled: boolean;

    /**
     * Optional accessible name override forwarded to the inner button.
     */
    declare public ariaLabel: string;

    /**
     * Ids of the elements that label the button, in the host's tree. The inner button gets them as
     * element references, because ids do not resolve across a shadow root.
     */
    declare public ariaLabelledby: string | null;

    /**
     * Ids of the elements that describe the button, in the host's tree, forwarded as element references.
     */
    declare public ariaDescribedby: string | null;

    /**
     * Id of the element holding the button's error message, in the host's tree, forwarded as an
     * element reference.
     */
    declare public ariaErrormessage: string | null;

    /**
     * Ids of the elements the button controls, in the host's tree, forwarded as element references.
     */
    declare public ariaControls: string | null;

    /**
     * Plain-text description forwarded to the inner button.
     */
    declare public ariaDescription: string | null;

    /**
     * Optional expanded state forwarded to the inner button.
     */
    declare public ariaExpanded: string | null;

    /**
     * Optional popup type forwarded to the inner button.
     */
    declare public ariaHasPopup: string | null;

    /**
     * Optional keyboard shortcut description forwarded to the inner button.
     */
    declare public ariaKeyShortcuts: string | null;

    /**
     * Optional pressed state ("true", "false" or "mixed") forwarded to the inner button for toggle buttons.
     */
    declare public ariaPressed: string | null;

    public constructor() {
        super();
        this.appearance = "primary";
        this.type = "button";
        this.disabled = false;
        this.ariaLabel = "";
    }

    public connectedCallback(): void {
        super.connectedCallback();
        this.#forwardReference("aria-labelledby", this.ariaLabelledby);
        this.#forwardReference("aria-describedby", this.ariaDescribedby);
        this.#forwardReference("aria-errormessage", this.ariaErrormessage);
        this.#forwardReference("aria-controls", this.ariaControls);
    }

    private ariaLabelledbyChanged(_previous: string | null, next: string | null): void {
        this.#forwardReference("aria-labelledby", next);
    }

    private ariaDescribedbyChanged(_previous: string | null, next: string | null): void {
        this.#forwardReference("aria-describedby", next);
    }

    private ariaErrormessageChanged(_previous: string | null, next: string | null): void {
        this.#forwardReference("aria-errormessage", next);
    }

    private ariaControlsChanged(_previous: string | null, next: string | null): void {
        this.#forwardReference("aria-controls", next);
    }

    private ariaExpandedChanged(_previous: string | null, next: string | null): void {
        this.#forwardAriaAttribute("aria-expanded", next);
    }

    private ariaHasPopupChanged(_previous: string | null, next: string | null): void {
        this.#forwardAriaAttribute("aria-haspopup", next);
    }

    private ariaKeyShortcutsChanged(_previous: string | null, next: string | null): void {
        this.#forwardAriaAttribute("aria-keyshortcuts", next);
    }

    private ariaPressedChanged(_previous: string | null, next: string | null): void {
        this.#forwardAriaAttribute("aria-pressed", next);
    }

    /**
     * Sets an id-list attribute's elements on the inner button as element references, found by id
     * in the tree that holds the host. When a referenced sibling mounts later in the same FAST
     * render batch, retry once on the next Updates tick.
     */
    #forwardReference(name: ReferenceAttribute, value: string | null | undefined, retried = false): void {
        const control = this.shadowRoot?.querySelector("button");
        if (!control) {
            return;
        }

        const root = this.getRootNode();
        const ids = (value ?? "").split(/\s+/).filter(Boolean);
        const elements =
            root instanceof Document || root instanceof ShadowRoot
                ? ids.map(id => root.getElementById(id)).filter(element => element !== null)
                : [];
        (control as unknown as ElementReferences)[REFERENCE_DOM_PROPERTIES[name]] = elements.length > 0 ? elements : null;

        if (!retried && elements.length < ids.length) {
            Updates.enqueue(() => {
                if (this[REFERENCES[name]] === value) {
                    this.#forwardReference(name, value, true);
                }
            });
        }
    }

    #forwardAriaAttribute(name: string, value: string | null | undefined): void {
        const control = this.shadowRoot?.querySelector("button");
        if (!control) {
            return;
        }

        if (value == null) {
            control.removeAttribute(name);
        } else {
            control.setAttribute(name, value);
        }
    }
}

attr(VioletButton.prototype, "appearance");
attr(VioletButton.prototype, "type");
attr({ mode: "boolean" })(VioletButton.prototype, "disabled");
observable(VioletButton.prototype, "ariaLabel");
attr({ attribute: "aria-labelledby" })(VioletButton.prototype, "ariaLabelledby");
attr({ attribute: "aria-describedby" })(VioletButton.prototype, "ariaDescribedby");
attr({ attribute: "aria-errormessage" })(VioletButton.prototype, "ariaErrormessage");
attr({ attribute: "aria-controls" })(VioletButton.prototype, "ariaControls");
attr({ attribute: "aria-description" })(VioletButton.prototype, "ariaDescription");
attr({ attribute: "aria-expanded" })(VioletButton.prototype, "ariaExpanded");
attr({ attribute: "aria-haspopup" })(VioletButton.prototype, "ariaHasPopup");
attr({ attribute: "aria-keyshortcuts" })(VioletButton.prototype, "ariaKeyShortcuts");
attr({ attribute: "aria-pressed" })(VioletButton.prototype, "ariaPressed");

/** The FAST definition of `<violet-button>`; `defineVioletButton` in `./violet-button.define` registers it. */
export const violetButtonDefinition = {
    name: "violet-button",
    template,
    styles,
    shadowOptions: {
        delegatesFocus: true,
    },
} satisfies PartialFASTElementDefinition;
