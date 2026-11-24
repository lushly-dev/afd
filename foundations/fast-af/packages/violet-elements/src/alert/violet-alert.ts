import { FASTElement, attr, css, html, observable, type PartialFASTElementDefinition } from "@lushly-dev/fast-element";

import { violetSurfaceTokenDefaults } from "../theme/violet-token-defaults";
import { registerSystemCheckmarkIcon } from "../icon/generated/icons/system-checkmark";
import { registerSystemCloseIcon } from "../icon/generated/icons/system-close";
import { registerSystemDismissIcon } from "../icon/generated/icons/system-dismiss";
import { registerSystemWarningIcon } from "../icon/generated/icons/system-warning";

const styles = css`
    ${violetSurfaceTokenDefaults}

    :host {
        display: block;
        color: var(--_text-primary);
        --_alert-radius: var(--violet-alert-radius, var(--_radius-lg));
        --_alert-padding: var(--violet-alert-padding, var(--_space-md));
        --_alert-gap: var(--violet-alert-gap, var(--_space-sm));
        --_alert-icon-size: var(--violet-alert-icon-size, 1rem);
        --_alert-title-size: var(--violet-alert-title-size, var(--_body-size));
        --_alert-title-line: var(--violet-alert-title-line, var(--_body-line));
        --_alert-body-size: var(--violet-alert-body-size, var(--_body-size));
        --_alert-body-line: var(--violet-alert-body-line, var(--_body-line));
        --_alert-meta-size: var(--violet-alert-meta-size, var(--_caption-size));
        /* The tone is the fill, the icon and the words; a plain or info alert is the quiet surface. */
        --_alert-border: var(--violet-alert-border, transparent);
        --_alert-surface: var(--violet-alert-surface, var(--_surface-subtle));
        --_alert-emphasis: var(--violet-alert-emphasis, var(--_text-secondary));
        --_alert-shadow: var(--violet-alert-shadow, none);
    }

    :host([tone="info"]) {
        --_alert-emphasis: var(--_text-secondary);
    }

    :host([tone="success"]) {
        --_alert-surface: var(--violet-color-state-success-background, #dfeae3);
        --_alert-border: var(--violet-color-state-success-border, transparent);
        --_alert-emphasis: var(--violet-color-state-success-text, #2c5e4b);
    }

    :host([tone="warning"]) {
        --_alert-surface: var(--violet-color-state-warning-background, #f3e8d2);
        --_alert-border: var(--violet-color-state-warning-border, transparent);
        --_alert-emphasis: var(--violet-color-state-warning-text, #92400E);
    }

    :host([tone="danger"]) {
        --_alert-surface: var(--violet-color-state-danger-background, #f7e4df);
        --_alert-border: var(--violet-color-state-danger-border, transparent);
        --_alert-emphasis: var(--violet-color-state-danger-text, #c42a1a);
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

    /* The icon alone, on the title's line. */
    .leading {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        inline-size: var(--_alert-icon-size);
        block-size: var(--_alert-title-line);
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
        font-weight: 500;
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

    /* The button is centred on the title's line and sits out to the alert's inset. */
    .dismiss {
        flex: 0 0 auto;
        margin-block-start: calc((var(--_alert-title-line) - var(--violet-size-target-natural, 32px)) / 2);
        margin-inline-end: calc(var(--_space-stack-xs) * -1);
        color: var(--_alert-emphasis);
    }

    .dismiss[hidden] {
        display: none;
    }

    @media (max-width: 480px) {
        .layout {
            grid-template-columns: auto minmax(0, 1fr);
        }

        .actions[data-single-action] slot::slotted(*) {
            flex: 1 1 100%;
            inline-size: 100%;
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

        /*
         * The frame's slot opts its content back in, so the layout, which the alert paints, opts out
         * again; what is slotted into the alert takes the system colours.
         */
        .layout {
            forced-color-adjust: none;
        }

        .title,
        .content {
            color: CanvasText;
        }

        .leading {
            color: ButtonText;
        }

        slot {
            forced-color-adjust: auto;
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
                <div
                    class="actions"
                    part="actions"
                    ?hidden="${x => !x.hasActions}"
                    ?data-single-action="${x => x.hasSingleAction}"
                >
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
    declare public hasSingleAction: boolean;

    @observable
    declare public hasIcon: boolean;

    declare public tone: string;
    declare public announcement: string;
    declare public dismissible: boolean;

    public constructor() {
        super();
        this.hasTitle = false;
        this.hasActions = false;
        this.hasSingleAction = false;
        this.hasIcon = false;
        this.tone = "default";
        this.announcement = "off";
        this.dismissible = false;
    }

    public connectedCallback(): void {
        // Before the first render, so the first alert of a tone draws its own icon, not the fallback.
        registerSystemCheckmarkIcon();
        registerSystemCloseIcon();
        registerSystemDismissIcon();
        registerSystemWarningIcon();
        super.connectedCallback();
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
        const slot = this.shadowRoot?.querySelector('slot[name="actions"]') as HTMLSlotElement | null;
        const meaningfulNodes = (slot?.assignedNodes({ flatten: true }) ?? []).filter(node => {
            if (node.nodeType === Node.TEXT_NODE) {
                return Boolean(node.textContent?.trim());
            }
            return node.nodeType === Node.ELEMENT_NODE;
        });
        this.hasActions = meaningfulNodes.length > 0;
        this.hasSingleAction = meaningfulNodes.length === 1 && meaningfulNodes[0]?.nodeType === Node.ELEMENT_NODE;
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

/** The FAST definition of `<violet-alert>`; `defineVioletAlert` in `./violet-alert.define` registers it. */
export const violetAlertDefinition = {
    name: "violet-alert",
    template,
    styles,
    shadowOptions: {
        delegatesFocus: true,
    },
} satisfies PartialFASTElementDefinition;
