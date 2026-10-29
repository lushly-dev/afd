import { FASTElement, attr, css, html, observable } from "@lushly-dev/fast-element";

import { violetSurfaceTokenDefaults } from "../theme/violet-token-defaults";
import { registerSystemCheckmarkIcon } from "../icon/generated/icons/system-checkmark";
import { registerSystemCloseIcon } from "../icon/generated/icons/system-close";
import { registerSystemDismissIcon } from "../icon/generated/icons/system-dismiss";
import { registerSystemWarningIcon } from "../icon/generated/icons/system-warning";
import "../button/violet-button";
import "../card/violet-card";
import "../icon/violet-icon";
import "../icon-button/violet-icon-button";

const styles = css`
    ${violetSurfaceTokenDefaults}

    :host {
        position: fixed;
        inset-block-end: var(--violet-toast-inset-block-end, var(--_space-lg));
        inset-inline-end: var(--violet-toast-inset-inline-end, var(--_space-lg));
        z-index: var(--_layer-toast);
        inline-size: min(var(--violet-toast-inline-size, 24rem), calc(100vw - (var(--_space-lg) * 2)));
        max-inline-size: calc(100vw - (var(--_space-lg) * 2));
        color: var(--_text-primary);
        --_toast-padding: var(--violet-toast-padding, var(--_space-md));
        --_toast-gap: var(--violet-toast-gap, var(--_space-md));
        --_toast-radius: var(--violet-toast-radius, calc(var(--_radius-lg) * 1.33));
        --_toast-surface: var(--violet-toast-surface, var(--_surface-card));
        --_toast-border: var(--violet-toast-border, var(--_border-subtle));
        --_toast-shadow: var(--violet-toast-shadow, var(--_shadow-floating));
        --_toast-emphasis: var(--violet-toast-emphasis, var(--_text-secondary));
        --_toast-icon-size: var(--violet-toast-icon-size, 1rem);
        --_toast-title-size: var(--violet-toast-title-size, var(--_body-size));
        --_toast-title-line: var(--violet-toast-title-line, var(--_body-line));
        --_toast-body-size: var(--violet-toast-body-size, var(--_body-size));
        --_toast-body-line: var(--violet-toast-body-line, var(--_body-line));
    }

    :host(:not([open])) {
        display: none;
    }

    :host([tone="info"]) {
        --_toast-surface: var(--_surface-floating);
        --_toast-border: color-mix(in srgb, var(--_border-subtle) 70%, var(--_focus-ring));
    }

    :host([tone="success"]) {
        --_toast-surface: color-mix(in srgb, var(--color-state-success-background) 78%, var(--_surface-card));
        --_toast-border: var(--color-state-success-border);
        --_toast-emphasis: var(--color-state-success-text);
    }

    :host([tone="warning"]) {
        --_toast-surface: color-mix(in srgb, var(--color-state-warning-background) 82%, var(--_surface-card));
        --_toast-border: var(--color-state-warning-border);
        --_toast-emphasis: var(--color-state-warning-text);
    }

    :host([tone="danger"]) {
        --_toast-surface: color-mix(in srgb, var(--color-state-danger-background) 82%, var(--_surface-card));
        --_toast-border: var(--color-state-danger-border);
        --_toast-emphasis: var(--color-state-danger-text);
    }

    .frame {
        --violet-card-radius: var(--_toast-radius);
        --violet-card-padding: var(--_toast-padding);
        --violet-card-background: var(--_toast-surface);
        --violet-card-border-color: var(--_toast-border);
        --violet-card-shadow: var(--_toast-shadow);
    }

    .layout {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        gap: var(--_toast-gap);
        align-items: start;
    }

    .leading {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        inline-size: calc(var(--_toast-icon-size) + var(--_space-md));
        block-size: calc(var(--_toast-icon-size) + var(--_space-md));
        border-radius: var(--_radius-round);
        background: color-mix(in srgb, var(--_toast-emphasis) 12%, transparent);
        color: var(--_toast-emphasis);
        flex: 0 0 auto;
    }

    .leading[hidden] {
        display: none;
    }

    .icon-slot {
        display: contents;
    }

    .leading ::slotted(violet-icon) {
        --violet-icon-size: var(--_toast-icon-size);
        color: currentColor;
    }

    .body {
        display: grid;
        gap: var(--_space-stack-2xs);
        min-inline-size: 0;
        font-size: var(--_toast-body-size);
        line-height: var(--_toast-body-line);
    }

    .copy {
        display: grid;
        gap: var(--_space-stack-2xs);
        min-inline-size: 0;
    }

    .title {
        margin: 0;
        color: var(--_toast-emphasis);
        font-size: var(--_toast-title-size);
        line-height: var(--_toast-title-line);
        font-weight: 600;
    }

    .title[hidden] {
        display: none;
    }

    .content {
        display: grid;
        gap: var(--_space-stack-2xs);
    }

    .content slot::slotted(*) {
        margin: 0;
    }

    .actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--_space-sm);
        margin-block-start: var(--_space-stack-xs);
    }

    .actions[hidden] {
        display: none;
    }

    .actions slot::slotted(*) {
        margin: 0;
    }

    .dismiss {
        color: var(--_toast-emphasis);
    }

    .dismiss[hidden] {
        display: none;
    }

    @media (forced-colors: active) {
        .frame::part(root) {
            forced-color-adjust: none;
            border-color: ButtonText;
            background: Canvas;
            color: CanvasText;
            box-shadow: none;
        }

        .leading {
            background: Canvas;
            color: ButtonText;
            outline: 1px solid ButtonText;
        }
    }
`;

const template = html<VioletToast>`
    <violet-card class="frame" part="root" appearance="outline" padding="medium">
        <div class="layout" part="layout">
            <span class="leading" part="icon" ?hidden="${x => !x.showLeading}">
                <slot class="icon-slot" name="icon" @slotchange="${x => x.handleIconSlotChange()}"></slot>
                ${x => (x.hasIcon ? html`` : x.defaultIconTemplate)}
            </span>

            <div class="body" part="body">
                <div
                    class="copy"
                    part="copy"
                    role="${x => x.liveRegionRole || null}"
                    aria-live="${x => x.liveRegionPoliteness || null}"
                >
                    <p class="title" part="title" ?hidden="${x => !x.hasTitle}">
                        <slot name="title" @slotchange="${x => x.handleTitleSlotChange()}"></slot>
                    </p>
                    <div class="content" part="content">
                        <slot></slot>
                    </div>
                </div>
                <div class="actions" part="actions" ?hidden="${x => !x.hasActions}">
                    <slot name="actions" @slotchange="${x => x.handleActionsSlotChange()}"></slot>
                </div>
            </div>

            <violet-icon-button
                class="dismiss"
                part="dismiss-button"
                appearance="transparent"
                label="Dismiss notification"
                ?hidden="${x => !x.dismissible}"
                @click="${x => x.dismiss("dismiss-button")}"
            >
                <violet-icon icon="system/close" decorative></violet-icon>
            </violet-icon-button>
        </div>
    </violet-card>
`;

/**
 * Floating transient notification surface.
 *
 * @summary Token-driven toast surface with optional title, actions, auto-dismiss timeout, and explicit announcement behavior.
 * @fires dismiss - Emitted when the toast closes because of timeout or the dismiss button. Detail: `{ reason: "timeout" | "dismiss-button" }`.
 * @fires open-change - Emitted when the open state changes. Detail: `{ open: boolean }`.
 * @slot icon - Optional leading icon that overrides the default tone icon.
 * @slot title - Optional toast heading.
 * @slot - Toast body content.
 * @slot actions - Optional action controls. Presence of actions disables auto-dismiss.
 * @csspart root - The outer card surface.
 * @csspart layout - Internal layout wrapper.
 * @csspart icon - Leading icon container.
 * @csspart body - Text and actions wrapper.
 * @csspart title - Heading text wrapper.
 * @csspart content - Body content wrapper.
 * @csspart actions - Action row wrapper.
 * @csspart dismiss-button - Optional dismiss button.
 */
export class VioletToast extends FASTElement {
    @observable
    declare public hasTitle: boolean;

    @observable
    declare public hasActions: boolean;

    @observable
    declare public hasIcon: boolean;

    declare public open: boolean;
    declare public tone: string;
    declare public announcement: string;
    declare public dismissible: boolean;
    declare public timeout: string;

    #timeoutHandle: number | null = null;

    public constructor() {
        super();
        this.hasTitle = false;
        this.hasActions = false;
        this.hasIcon = false;
        this.open = false;
        this.tone = "default";
        this.announcement = "polite";
        this.dismissible = true;
        this.timeout = "5000";
    }

    public connectedCallback(): void {
        super.connectedCallback();
        registerSystemCheckmarkIcon();
        registerSystemCloseIcon();
        registerSystemDismissIcon();
        registerSystemWarningIcon();
        this.handleTitleSlotChange();
        this.handleActionsSlotChange();
        this.handleIconSlotChange();
        this.#syncTimeout();
    }

    public disconnectedCallback(): void {
        super.disconnectedCallback();
        this.#clearTimeout();
    }

    public openChanged(previous: boolean | undefined, next: boolean): void {
        if (!this.$fastController.isConnected || previous === next) {
            return;
        }

        this.#syncTimeout();
        this.$emit("open-change", { open: next });
    }

    public timeoutChanged(): void {
        if (this.$fastController.isConnected) {
            this.#syncTimeout();
        }
    }

    public handleTitleSlotChange(): void {
        this.hasTitle = this.#slotHasContent('slot[name="title"]');
    }

    public handleActionsSlotChange(): void {
        this.hasActions = this.#slotHasContent('slot[name="actions"]');
        const actions = this.shadowRoot?.querySelector(".actions") as HTMLElement | null;
        if (actions) {
            actions.hidden = !this.hasActions;
        }
        if (this.$fastController.isConnected) {
            this.#syncTimeout();
        }
    }

    public handleIconSlotChange(): void {
        this.hasIcon = this.#slotHasContent('slot[name="icon"]');
    }

    public dismiss(reason: "timeout" | "dismiss-button"): void {
        if (!this.open) {
            return;
        }

        this.#clearTimeout();
        this.open = false;
        this.$emit("dismiss", { reason });
    }

    public get showLeading(): boolean {
        return this.hasIcon || this.tone === "success" || this.tone === "warning" || this.tone === "danger";
    }

    public get liveRegionRole(): "alert" | "status" | null {
        if (this.announcement === "assertive") {
            return "alert";
        }

        if (this.announcement === "polite") {
            return "status";
        }

        return null;
    }

    public get liveRegionPoliteness(): "assertive" | "polite" | null {
        if (this.announcement === "assertive") {
            return "assertive";
        }

        if (this.announcement === "polite") {
            return "polite";
        }

        return null;
    }

    public get defaultIconTemplate() {
        if (this.tone === "success") {
            return html`<violet-icon icon="system/checkmark" decorative></violet-icon>`;
        }

        if (this.tone === "danger") {
            return html`<violet-icon icon="system/dismiss" decorative></violet-icon>`;
        }

        if (this.tone === "warning") {
            return html`<violet-icon icon="system/warning" decorative></violet-icon>`;
        }

        return html``;
    }

    #syncTimeout(): void {
        this.#clearTimeout();

        const timeout = Number.parseInt(this.timeout, 10);
        if (!this.open || this.hasActions || this.dismissible || !Number.isFinite(timeout) || timeout <= 0) {
            return;
        }

        this.#timeoutHandle = window.setTimeout(() => {
            this.dismiss("timeout");
        }, timeout);
    }

    #clearTimeout(): void {
        if (this.#timeoutHandle !== null) {
            window.clearTimeout(this.#timeoutHandle);
            this.#timeoutHandle = null;
        }
    }

    #slotHasContent(selector: string): boolean {
        const slot = this.shadowRoot?.querySelector(selector) as HTMLSlotElement | null;
        const slotName = slot?.name;
        if (slotName && this.querySelector(`[slot="${slotName}"]`)) {
            return true;
        }
        return (slot?.assignedNodes({ flatten: true }) ?? []).some(node => {
            if (node.nodeType === Node.TEXT_NODE) {
                return Boolean(node.textContent?.trim());
            }
            return true;
        });
    }
}

export type VioletToastTone = "default" | "info" | "success" | "warning" | "danger";
export type VioletToastAnnouncement = "off" | "polite" | "assertive";

attr({ mode: "boolean" })(VioletToast.prototype, "open");
attr(VioletToast.prototype, "tone");
attr(VioletToast.prototype, "announcement");
attr({ mode: "boolean" })(VioletToast.prototype, "dismissible");
attr(VioletToast.prototype, "timeout");

if (!customElements.get("violet-toast")) {
    await FASTElement.define(VioletToast, {
        name: "violet-toast",
        template,
        styles,
        shadowOptions: {
            delegatesFocus: true,
        },
    });
}
