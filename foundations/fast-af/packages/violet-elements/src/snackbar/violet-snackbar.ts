import { FASTElement, attr, css, html, observable } from "@lushly-dev/fast-element";

import { violetSurfaceTokenDefaults } from "../theme/violet-token-defaults";
import { registerSystemCloseIcon } from "../icon/generated/icons/system-close";
import "../button/violet-button";
import "../card/violet-card";
import "../icon/violet-icon";
import "../icon-button/violet-icon-button";

const styles = css`
    ${violetSurfaceTokenDefaults}

    :host {
        position: fixed;
        inset-inline-start: 50%;
        inset-block-end: var(--violet-snackbar-inset-block-end, var(--_space-lg));
        transform: translateX(-50%);
        z-index: var(--_layer-toast);
        inline-size: min(var(--violet-snackbar-inline-size, 32rem), calc(100vw - (var(--_space-lg) * 2)));
        max-inline-size: calc(100vw - (var(--_space-lg) * 2));
        color: var(--_text-primary);
        --_snackbar-padding-inline: var(--violet-snackbar-padding-inline, var(--_space-md));
        --_snackbar-padding-block: var(--violet-snackbar-padding-block, var(--_space-sm));
        --_snackbar-gap: var(--violet-snackbar-gap, var(--_space-sm));
        --_snackbar-radius: var(--violet-snackbar-radius, calc(var(--_radius-lg) * 1.33));
        --_snackbar-surface: var(--violet-snackbar-surface, var(--_surface-floating));
        --_snackbar-border: var(--violet-snackbar-border, var(--_border-subtle));
        --_snackbar-shadow: var(--violet-snackbar-shadow, var(--_shadow-floating));
        --_snackbar-emphasis: var(--violet-snackbar-emphasis, var(--_text-primary));
        --_snackbar-action: var(--violet-snackbar-action, var(--_text-primary));
        --_snackbar-body-size: var(--violet-snackbar-body-size, var(--_body-size));
        --_snackbar-body-line: var(--violet-snackbar-body-line, var(--_body-line));
    }

    :host(:not([open])) {
        display: none;
    }

    :host([tone="info"]) {
        --_snackbar-surface: var(--_surface-card);
        --_snackbar-border: color-mix(in srgb, var(--_border-subtle) 70%, var(--_focus-ring));
    }

    :host([tone="success"]) {
        --_snackbar-surface: color-mix(in srgb, var(--color-state-success-background) 78%, var(--_surface-card));
        --_snackbar-border: var(--color-state-success-border);
        --_snackbar-emphasis: var(--color-state-success-text);
        --_snackbar-action: var(--color-state-success-text);
    }

    :host([tone="warning"]) {
        --_snackbar-surface: color-mix(in srgb, var(--color-state-warning-background) 82%, var(--_surface-card));
        --_snackbar-border: var(--color-state-warning-border);
        --_snackbar-emphasis: var(--color-state-warning-text);
        --_snackbar-action: var(--color-state-warning-text);
    }

    :host([tone="danger"]) {
        --_snackbar-surface: color-mix(in srgb, var(--color-state-danger-background) 82%, var(--_surface-card));
        --_snackbar-border: var(--color-state-danger-border);
        --_snackbar-emphasis: var(--color-state-danger-text);
        --_snackbar-action: var(--color-state-danger-text);
    }

    .frame {
        --violet-card-radius: var(--_snackbar-radius);
        --violet-card-padding: 0;
        --violet-card-background: var(--_snackbar-surface);
        --violet-card-border-color: var(--_snackbar-border);
        --violet-card-shadow: var(--_snackbar-shadow);
    }

    .layout {
        display: flex;
        align-items: center;
        gap: var(--_snackbar-gap);
        min-block-size: var(--_target-size-natural);
        padding: var(--_snackbar-padding-block) var(--_snackbar-padding-inline);
    }

    .message {
        display: block;
        flex: 1 1 auto;
        min-inline-size: 0;
        font-size: var(--_snackbar-body-size);
        line-height: var(--_snackbar-body-line);
        color: var(--_snackbar-emphasis);
    }

    .message-copy {
        display: block;
    }

    .message slot::slotted(*) {
        margin: 0;
    }

    .action {
        flex: 0 0 auto;
        display: inline-flex;
        align-items: center;
    }

    .action[hidden] {
        display: none;
    }

    .action ::slotted(violet-button) {
        color: var(--_snackbar-action);
        --violet-button-padding-inline: var(--_space-sm);
    }

    .dismiss {
        flex: 0 0 auto;
        color: var(--_snackbar-emphasis);
    }

    .dismiss[hidden] {
        display: none;
    }

    @media (max-width: 480px) {
        :host {
            inset-inline-start: var(--_space-md);
            inset-inline-end: var(--_space-md);
            transform: none;
            inline-size: auto;
            max-inline-size: none;
        }

        .layout {
            align-items: start;
        }
    }

    @media (forced-colors: active) {
        .frame::part(root) {
            forced-color-adjust: none;
            border-color: ButtonText;
            background: Canvas;
            color: CanvasText;
            box-shadow: none;
        }
    }
`;

const template = html<VioletSnackbar>`
    <violet-card class="frame" part="root" appearance="outline" padding="none">
        <div class="layout" part="layout">
            <div class="message" part="message">
                <div
                    class="message-copy"
                    part="message-copy"
                    role="${x => x.liveRegionRole || null}"
                    aria-live="${x => x.liveRegionPoliteness || null}"
                >
                    <slot></slot>
                </div>
            </div>
            <div class="action" part="action" ?hidden="${x => !x.hasAction}">
                <slot name="action" @slotchange="${x => x.handleActionSlotChange()}"></slot>
            </div>
            <violet-icon-button
                class="dismiss"
                part="dismiss-button"
                appearance="transparent"
                label="Dismiss message"
                ?hidden="${x => !x.dismissible}"
                @click="${x => x.dismiss("dismiss-button")}"
            >
                <violet-icon icon="system/close" decorative></violet-icon>
            </violet-icon-button>
        </div>
    </violet-card>
`;

/**
 * Compact transient message with optional single action.
 *
 * @summary Lightweight snackbar surface for short-lived feedback near the bottom of the viewport.
 * @fires dismiss - Emitted when the snackbar closes. Detail: `{ reason: "timeout" | "dismiss-button" }`.
 * @fires open-change - Emitted when the open state changes. Detail: `{ open: boolean }`.
 * @slot - Snackbar message content.
 * @slot action - Optional single action control. Presence disables auto-dismiss.
 * @csspart root - The outer card surface.
 * @csspart layout - Internal row layout.
 * @csspart message - Message wrapper.
 * @csspart action - Action slot wrapper.
 * @csspart dismiss-button - Optional dismiss button.
 */
export class VioletSnackbar extends FASTElement {
    @observable
    declare public hasAction: boolean;

    declare public open: boolean;
    declare public tone: string;
    declare public announcement: string;
    declare public dismissible: boolean;
    declare public timeout: string;

    #timeoutHandle: number | null = null;

    public constructor() {
        super();
        this.hasAction = false;
        this.open = false;
        this.tone = "default";
        this.announcement = "polite";
        this.dismissible = false;
        this.timeout = "6000";
    }

    public connectedCallback(): void {
        super.connectedCallback();
        registerSystemCloseIcon();
        this.handleActionSlotChange();
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

    public handleActionSlotChange(): void {
        this.hasAction = this.#slotHasContent('slot[name="action"]');
        const action = this.shadowRoot?.querySelector(".action") as HTMLElement | null;
        if (action) {
            action.hidden = !this.hasAction;
        }
        if (this.$fastController.isConnected) {
            this.#syncTimeout();
        }
    }

    public dismiss(reason: "timeout" | "dismiss-button"): void {
        if (!this.open) {
            return;
        }

        this.#clearTimeout();
        this.open = false;
        this.$emit("dismiss", { reason });
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

    #syncTimeout(): void {
        this.#clearTimeout();

        const timeout = Number.parseInt(this.timeout, 10);
        if (!this.open || this.hasAction || this.dismissible || !Number.isFinite(timeout) || timeout <= 0) {
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

export type VioletSnackbarTone = "default" | "info" | "success" | "warning" | "danger";
export type VioletSnackbarAnnouncement = "off" | "polite" | "assertive";

attr({ mode: "boolean" })(VioletSnackbar.prototype, "open");
attr(VioletSnackbar.prototype, "tone");
attr(VioletSnackbar.prototype, "announcement");
attr({ mode: "boolean" })(VioletSnackbar.prototype, "dismissible");
attr(VioletSnackbar.prototype, "timeout");

if (!customElements.get("violet-snackbar")) {
    await FASTElement.define(VioletSnackbar, {
        name: "violet-snackbar",
        template,
        styles,
        shadowOptions: {
            delegatesFocus: true,
        },
    });
}
