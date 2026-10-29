import { FASTElement, attr, css, html, observable } from "@lushly-dev/fast-element";

import "../icon/violet-icon";
import "../icon-button/violet-icon-button";
import { registerSystemCloseIcon } from "../icon/generated";
import { violetSurfaceTokenDefaults } from "../theme/violet-token-defaults";

registerSystemCloseIcon();

let violetDialogId = 0;

const styles = css`
    ${violetSurfaceTokenDefaults}

    :host {
        --_dialog-border-width: var(--violet-dialog-border-width, var(--_card-border-width, 1px));
        --_dialog-padding: var(--violet-dialog-padding, var(--_space-md));
        --_dialog-width: var(--violet-dialog-width, 35rem);
        --_dialog-margin: var(--violet-dialog-margin, 2rem);
        --_dialog-max-height: var(--violet-dialog-max-height, 85vh);
        --_dialog-radius: var(--violet-dialog-radius, var(--_radius-lg));
        --_dialog-background: var(--violet-dialog-background, var(--_surface-card));
        --_dialog-shadow: var(--violet-dialog-shadow, var(--_shadow-floating));
        --_dialog-backdrop: var(--violet-dialog-backdrop, rgba(0, 0, 0, 0.4));
        --_dialog-backdrop-off: transparent;
    }

    :host([no-backdrop]) {
        --_dialog-backdrop: transparent;
    }

    :host([padding="none"]) {
        --_dialog-padding: var(--violet-dialog-padding, 0);
    }

    :host([padding="small"]) {
        --_dialog-padding: var(--violet-dialog-padding, var(--_space-sm));
    }

    :host([padding="large"]) {
        --_dialog-padding: var(--violet-dialog-padding, var(--_space-lg));
    }

    dialog {
        box-sizing: border-box;
        flex-direction: column;
        inline-size: var(--_dialog-width);
        max-inline-size: calc(100vw - var(--_dialog-margin));
        max-block-size: min(var(--_dialog-max-height), calc(100vh - var(--_dialog-margin)));
        margin: auto;
        padding: 0;
        border: var(--_dialog-border-width) solid var(--_border-subtle);
        border-radius: var(--_dialog-radius);
        background: var(--_dialog-background);
        box-shadow: var(--_dialog-shadow);
        color: inherit;
        font-family: inherit;
        overflow: hidden;

        opacity: 0;
        transform: translateY(var(--_space-sm)) scale(0.97);
        transition:
            opacity var(--_duration-base) var(--_easing-standard),
            transform var(--_duration-base) var(--_easing-standard),
            display var(--_duration-base) var(--_easing-standard) allow-discrete,
            overlay var(--_duration-base) var(--_easing-standard) allow-discrete;
    }

    /*
     * Only lay the dialog out while it is open. A base \`display\` would override the UA's
     * \`dialog:not([open]) { display: none }\`, leaving a closed dialog rendered (just
     * transparent) with its controls still in the tab order. The \`display ... allow-discrete\`
     * transition above keeps the fade-out.
     */
    dialog[open] {
        display: flex;
        opacity: 1;
        transform: translateY(0) scale(1);

        @starting-style {
            opacity: 0;
            transform: translateY(var(--_space-sm)) scale(0.97);
        }
    }

    dialog::backdrop {
        background: var(--_dialog-backdrop-off);
        transition:
            background var(--_duration-base) var(--_easing-standard),
            display var(--_duration-base) var(--_easing-standard) allow-discrete,
            overlay var(--_duration-base) var(--_easing-standard) allow-discrete;
    }

    dialog[open]::backdrop {
        background: var(--_dialog-backdrop);

        @starting-style {
            background: var(--_dialog-backdrop-off);
        }
    }

    .header {
        display: flex;
        align-items: center;
        gap: var(--_space-sm);
        padding: var(--_dialog-padding);
        border-block-end: var(--_dialog-border-width) solid var(--_border-subtle);
    }

    .header[hidden] {
        display: none;
    }

    .title {
        flex: 1;
        font-weight: 600;
        min-inline-size: 0;
    }

    .close-button {
        flex-shrink: 0;
    }

    .close-button[hidden] {
        display: none;
    }

    .body {
        flex: 1;
        padding: var(--_dialog-padding);
        overflow-y: auto;
    }

    .footer {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: var(--_space-sm);
        padding: var(--_dialog-padding);
        border-block-start: var(--_dialog-border-width) solid var(--_border-subtle);
    }

    .footer[hidden] {
        display: none;
    }

    @media (forced-colors: active) {
        dialog {
            forced-color-adjust: none;
            border: var(--_dialog-border-width) solid ButtonText;
            background: Canvas;
            box-shadow: none;
        }

        dialog::backdrop {
            background: var(--_dialog-backdrop);
        }

        .header {
            border-block-end-color: ButtonText;
        }

        .footer {
            border-block-start-color: ButtonText;
        }

    }
`;

const template = html<VioletDialog>`
    <dialog
        part="dialog"
        id="${x => x.dialogId}"
        aria-labelledby="${x => x.hasTitle ? x.titleId : undefined}"
        aria-label="${x => x.hasTitle ? undefined : "Dialog"}"
        @close="${(x, c) => x.handleClose(c.event)}"
        @cancel="${(x, c) => x.handleCancel(c.event)}"
    >
        <div class="header" part="header" ?hidden="${x => !x.hasTitle && x.noCloseButton}">
            <span class="title" part="title" id="${x => x.titleId}">
                <slot name="title" @slotchange="${x => x.handleTitleSlotChange()}"></slot>
            </span>
            <violet-icon-button
                class="close-button"
                part="close-button"
                ?hidden="${x => x.noCloseButton}"
                appearance="quiet"
                label="Close"
                @click="${x => x.requestClose("close-button")}"
            >
                <violet-icon icon="system/close" decorative></violet-icon>
            </violet-icon-button>
        </div>
        <div class="body" part="body" id="${x => x.bodyId}" tabindex="${x => x.bodyScrollable ? "0" : null}">
            <slot @slotchange="${x => x.handleBodySlotChange()}"></slot>
        </div>
        <div class="footer" part="footer" ?hidden="${x => !x.hasFooter}">
            <slot name="footer" @slotchange="${x => x.handleFooterSlotChange()}"></slot>
        </div>
    </dialog>
`;

/**
 * The focused element, descending through open shadow roots, so focus can be restored to a
 * trigger that lives inside another component's shadow tree.
 */
function deepActiveElement(): Element | null {
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) {
        active = active.shadowRoot.activeElement;
    }
    return active;
}

/**
 * Violet reusable dialog surface.
 *
 * @summary Token-driven dialog built on the native <dialog> element with modal/non-modal/alert types,
 *          CSS open/close animations, header/footer slots, and adjustable padding.
 * @fires open-change - Emitted after the dialog opens or closes.
 * @fires request-close - Emitted before close. Call preventDefault() to cancel.
 * @slot title - Dialog title text, auto-wired to aria-labelledby.
 * @slot - Dialog body content.
 * @slot footer - Action buttons area.
 * @csspart dialog - The native dialog element.
 * @csspart header - Header section wrapper.
 * @csspart title - Title text wrapper.
 * @csspart close-button - The X close button.
 * @csspart body - Body section wrapper.
 * @csspart footer - Footer section wrapper.
 */
export class VioletDialog extends FASTElement {
    @observable
    declare public hasTitle: boolean;

    @observable
    declare public hasFooter: boolean;

    /**
     * True while the body overflows and therefore needs to be a keyboard tab stop.
     */
    declare public bodyScrollable: boolean;

    declare public open: boolean;
    declare public type: string;
    declare public padding: string;
    declare public noCloseButton: boolean;
    declare public noBackdrop: boolean;

    public readonly dialogId: string;
    public readonly titleId: string;
    public readonly bodyId: string;

    #triggerElement: Element | null = null;
    #closingProgrammatically = false;
    #bodyObserver: ResizeObserver | null = null;

    public constructor() {
        super();
        this.hasTitle = false;
        this.hasFooter = false;
        this.bodyScrollable = false;
        this.open = false;
        this.type = "modal";
        this.padding = "medium";
        this.noCloseButton = false;
        this.noBackdrop = false;

        const id = violetDialogId;
        violetDialogId += 1;
        this.dialogId = `violet-dialog-${id}`;
        this.titleId = `violet-dialog-title-${id}`;
        this.bodyId = `violet-dialog-body-${id}`;
    }

    public get returnValue(): string {
        return this.#dialogElement?.returnValue ?? "";
    }

    public set returnValue(value: string) {
        const dialog = this.#dialogElement;
        if (dialog) {
            dialog.returnValue = value;
        }
    }

    get #dialogElement(): HTMLDialogElement | null {
        return this.shadowRoot?.querySelector("dialog") ?? null;
    }

    public show(): void {
        this.open = true;
    }

    public hide(returnValue?: string): void {
        const dialog = this.#dialogElement;
        if (dialog && returnValue !== undefined) {
            dialog.returnValue = returnValue;
        }
        this.open = false;
    }

    public openChanged(): void {
        if (!this.$fastController.isConnected) {
            return;
        }

        if (this.open) {
            this.#openDialog();
        } else {
            this.#closeDialog();
        }
    }

    public typeChanged(): void {
        this.#syncDialogAttributes();
    }

    public connectedCallback(): void {
        super.connectedCallback();

        if (this.open) {
            this.#openDialog();
        }
    }

    public disconnectedCallback(): void {
        this.#bodyObserver?.disconnect();
        this.#bodyObserver = null;
        super.disconnectedCallback();
    }

    public handleClose(_event: Event): void {
        this.#closingProgrammatically = true;
        this.open = false;
        this.#closingProgrammatically = false;
        this.#bodyObserver?.disconnect();
        this.bodyScrollable = false;

        this.$emit("open-change", { open: false });

        const trigger = this.#triggerElement;
        if (trigger instanceof HTMLElement && trigger.isConnected) {
            trigger.focus();
        }
        this.#triggerElement = null;
    }

    public handleBodySlotChange(): void {
        if (this.open) {
            this.#observeBody();
        }
    }

    public handleCancel(event: Event): void {
        event.preventDefault();
        this.requestClose("keyboard");
    }

    public requestClose(source: "close-button" | "keyboard" | "overlay"): void {
        const event = new CustomEvent("request-close", {
            bubbles: true,
            composed: true,
            cancelable: true,
            detail: { source },
        });

        this.dispatchEvent(event);

        if (!event.defaultPrevented) {
            this.hide();
        }
    }

    public handleTitleSlotChange(): void {
        const slot = this.shadowRoot?.querySelector('slot[name="title"]') as HTMLSlotElement | null;
        this.hasTitle = (slot?.assignedNodes({ flatten: true }) ?? []).some(node => {
            if (node.nodeType === Node.TEXT_NODE) {
                return Boolean(node.textContent?.trim());
            }
            return true;
        });
    }

    public handleFooterSlotChange(): void {
        const slot = this.shadowRoot?.querySelector('slot[name="footer"]') as HTMLSlotElement | null;
        this.hasFooter = (slot?.assignedNodes({ flatten: true }) ?? []).some(node => {
            if (node.nodeType === Node.TEXT_NODE) {
                return Boolean(node.textContent?.trim());
            }
            return true;
        });
    }

    #openDialog(): void {
        const dialog = this.#dialogElement;
        if (!dialog || dialog.open) {
            return;
        }

        this.#triggerElement = deepActiveElement();
        this.#syncDialogAttributes();

        if (this.type === "non-modal") {
            dialog.show();
        } else {
            dialog.showModal();
        }

        this.#observeBody();

        this.$emit("open-change", { open: true });
    }

    #closeDialog(): void {
        const dialog = this.#dialogElement;
        if (!dialog || !dialog.open) {
            return;
        }

        if (!this.#closingProgrammatically) {
            dialog.close();
        }
    }

    /**
     * Makes the body a tab stop only while it actually overflows, so scrollable content stays
     * keyboard reachable without adding a permanent empty stop.
     */
    #observeBody(): void {
        const body = this.shadowRoot?.querySelector(".body") as HTMLElement | null;
        if (!body) {
            return;
        }

        this.#bodyObserver ??= new ResizeObserver(() => this.#syncBodyScrollable());
        this.#bodyObserver.disconnect();
        this.#bodyObserver.observe(body);

        const slot = body.querySelector("slot") as HTMLSlotElement | null;
        for (const element of slot?.assignedElements({ flatten: true }) ?? []) {
            this.#bodyObserver.observe(element);
        }

        this.#syncBodyScrollable();
    }

    #syncBodyScrollable(): void {
        const body = this.shadowRoot?.querySelector(".body") as HTMLElement | null;
        this.bodyScrollable = Boolean(body && body.scrollHeight > body.clientHeight);
    }

    #syncDialogAttributes(): void {
        const dialog = this.#dialogElement;
        if (!dialog) {
            return;
        }

        if (this.type === "alert") {
            dialog.setAttribute("role", "alertdialog");
            dialog.setAttribute("aria-describedby", this.bodyId);
            dialog.setAttribute("closedby", "none");
        } else if (this.type === "non-modal") {
            dialog.removeAttribute("role");
            dialog.removeAttribute("aria-describedby");
            dialog.setAttribute("closedby", "any");
        } else {
            dialog.removeAttribute("role");
            dialog.removeAttribute("aria-describedby");
            dialog.setAttribute("closedby", "closerequest");
        }
    }
}

export type VioletDialogType = "modal" | "non-modal" | "alert";

observable(VioletDialog.prototype, "bodyScrollable");
attr({ mode: "boolean" })(VioletDialog.prototype, "open");
attr(VioletDialog.prototype, "type");
attr(VioletDialog.prototype, "padding");
attr({ attribute: "no-close-button", mode: "boolean" })(VioletDialog.prototype, "noCloseButton");
attr({ attribute: "no-backdrop", mode: "boolean" })(VioletDialog.prototype, "noBackdrop");

if (!customElements.get("violet-dialog")) {
    await FASTElement.define(VioletDialog, {
        name: "violet-dialog",
        template,
        styles,
    });
}
