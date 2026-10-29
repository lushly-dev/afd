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
        display: block;
        color: var(--_text-primary);
        --_alert-radius: var(--violet-alert-radius, calc(var(--_radius-md) * 1.5));
        --_alert-padding: var(--violet-alert-padding, var(--_space-md));
        --_alert-gap: var(--violet-alert-gap, var(--_space-md));
        --_alert-icon-size: var(--violet-alert-icon-size, 1.125rem);
        --_alert-title-size: var(--violet-alert-title-size, var(--_body-size));
        --_alert-title-line: var(--violet-alert-title-line, var(--_body-line));
        --_alert-body-size: var(--violet-alert-body-size, var(--_body-size));
        --_alert-body-line: var(--violet-alert-body-line, var(--_body-line));
        --_alert-meta-size: var(--violet-alert-meta-size, var(--_caption-size));
        --_alert-border: var(--violet-alert-border, var(--_border-subtle));
        --_alert-surface: var(--violet-alert-surface, var(--_surface-card));
        --_alert-emphasis: var(--violet-alert-emphasis, var(--_text-secondary));
        --_alert-shadow: var(--violet-alert-shadow, none);
    }

    :host([tone="info"]) {
        --_alert-surface: color-mix(in srgb, var(--_surface-card) 72%, var(--_surface-subtle));
        --_alert-border: color-mix(in srgb, var(--_border-subtle) 70%, var(--_focus-ring));
        --_alert-emphasis: var(--_text-secondary);
    }

    :host([tone="success"]) {
        --_alert-surface: var(--color-state-success-background);
        --_alert-border: var(--color-state-success-border);
        --_alert-emphasis: var(--color-state-success-text);
    }

    :host([tone="warning"]) {
        --_alert-surface: var(--color-state-warning-background);
        --_alert-border: var(--color-state-warning-border);
        --_alert-emphasis: var(--color-state-warning-text);
    }

    :host([tone="danger"]) {
        --_alert-surface: var(--color-state-danger-background);
        --_alert-border: var(--color-state-danger-border);
        --_alert-emphasis: var(--color-state-danger-text);
    }

    .frame {
        --violet-card-radius: var(--_alert-radius);
        --violet-card-padding: var(--_alert-padding);
        --violet-card-background: var(--_alert-surface);
        --violet-card-border-color: var(--_alert-border);
        --violet-card-shadow: var(--_alert-shadow);
    }

    .layout {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: start;
        gap: var(--_alert-gap);
    }

    .leading {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        inline-size: calc(var(--_alert-icon-size) + var(--_space-sm));
        block-size: calc(var(--_alert-icon-size) + var(--_space-sm));
        border-radius: var(--_radius-round);
        background: color-mix(in srgb, var(--_alert-emphasis) 12%, transparent);
        color: var(--_alert-emphasis);
        flex: 0 0 auto;
    }

    .leading[hidden] {
        display: none;
    }

    .leading ::slotted(violet-icon) {
        --violet-icon-size: var(--_alert-icon-size);
        color: currentColor;
    }

    .icon-slot {
        display: contents;
    }

    .body {
        display: grid;
        gap: var(--_space-stack-2xs);
        min-inline-size: 0;
        font-size: var(--_alert-body-size);
        line-height: var(--_alert-body-line);
    }

    .copy {
        display: grid;
        gap: var(--_space-stack-2xs);
        min-inline-size: 0;
    }

    .title {
        margin: 0;
        color: var(--_alert-emphasis);
        font-size: var(--_alert-title-size);
        line-height: var(--_alert-title-line);
        font-weight: 600;
    }

    .title[hidden] {
        display: none;
    }

    .content {
        display: grid;
        gap: var(--_space-stack-2xs);
        color: var(--_text-primary);
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
        flex: 0 0 auto;
        margin-block-start: calc(var(--_space-stack-2xs) * -1);
        color: var(--_alert-emphasis);
    }

    .dismiss[hidden] {
        display: none;
    }

    @media (max-width: 480px) {
        .layout {
            grid-template-columns: auto minmax(0, 1fr);
        }

        .dismiss {
            grid-column: 2;
            justify-self: end;
            margin-block-start: 0;
        }
    }

    @media (forced-colors: active) {
        .frame::part(root) {
            forced-color-adjust: none;
            border-color: ButtonText;
            background: Canvas;
            color: CanvasText;
        }

        .leading {
            background: Canvas;
            color: ButtonText;
            outline: 1px solid ButtonText;
        }
    }
`;

const template = html<VioletAlert>`
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
                label="Dismiss alert"
                ?hidden="${x => !x.dismissible}"
                @click="${x => x.handleDismiss()}"
            >
                <violet-icon icon="system/close" decorative></violet-icon>
            </violet-icon-button>
        </div>
    </violet-card>
`;

/**
 * Persistent inline or banner-style message surface.
 *
 * @summary Token-driven alert composed with Violet card, icon, and button primitives.
 * @fires dismiss - Emitted when the dismiss control is activated.
 * @slot icon - Optional leading icon that overrides the default tone icon.
 * @slot title - Optional alert heading.
 * @slot - Alert body content.
 * @slot actions - Optional action buttons or links.
 * @csspart root - The outer card surface.
 * @csspart layout - Internal layout wrapper.
 * @csspart icon - Leading icon container.
 * @csspart body - Text and actions wrapper.
 * @csspart title - Heading text wrapper.
 * @csspart content - Body content wrapper.
 * @csspart actions - Action row wrapper.
 * @csspart dismiss-button - Optional dismiss button.
 */
export class VioletAlert extends FASTElement {
    @observable
    declare public hasTitle: boolean;

    @observable
    declare public hasActions: boolean;

    @observable
    declare public hasIcon: boolean;

    declare public tone: string;
    declare public announcement: string;
    declare public dismissible: boolean;

    public constructor() {
        super();
        this.hasTitle = false;
        this.hasActions = false;
        this.hasIcon = false;
        this.tone = "default";
        this.announcement = "off";
        this.dismissible = false;
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

    public handleTitleSlotChange(): void {
        this.hasTitle = this.#slotHasContent('slot[name="title"]');
    }

    public handleActionsSlotChange(): void {
        this.hasActions = this.#slotHasContent('slot[name="actions"]');
    }

    public handleIconSlotChange(): void {
        this.hasIcon = this.#slotHasContent('slot[name="icon"]');
    }

    public handleDismiss(): void {
        this.$emit("dismiss");
    }

    #slotHasContent(selector: string): boolean {
        const slot = this.shadowRoot?.querySelector(selector) as HTMLSlotElement | null;
        return (slot?.assignedNodes({ flatten: true }) ?? []).some(node => {
            if (node.nodeType === Node.TEXT_NODE) {
                return Boolean(node.textContent?.trim());
            }
            return true;
        });
    }
}

export type VioletAlertTone = "default" | "info" | "success" | "warning" | "danger";
export type VioletAlertAnnouncement = "off" | "polite" | "assertive";

attr(VioletAlert.prototype, "tone");
attr(VioletAlert.prototype, "announcement");
attr({ mode: "boolean" })(VioletAlert.prototype, "dismissible");

if (!customElements.get("violet-alert")) {
    await FASTElement.define(VioletAlert, {
        name: "violet-alert",
        template,
        styles,
        shadowOptions: {
            delegatesFocus: true,
        },
    });
}
