import { FASTElement, attr, css, html, observable } from "@lushly-dev/fast-element";

import { violetSurfaceTokenDefaults } from "../theme/violet-token-defaults";
import { registerSystemArrowUpIcon } from "../icon/generated/icons/system-arrow-up";
import { registerSystemStopIcon } from "../icon/generated/icons/system-stop";
import "../icon/violet-icon";
import "../icon-button/violet-icon-button";
import "../text-area/violet-text-area";
import type { VioletTextArea } from "../text-area/violet-text-area";

const styles = css`
    ${violetSurfaceTokenDefaults}

    :host {
        display: block;
        --_composer-font-size: var(--violet-composer-font-size, var(--_body-size, 14px));
        --_composer-line-height: var(--violet-composer-line-height, var(--_body-line, 20px));
        --_composer-min-rows: var(--violet-composer-min-rows, 3);
        --_composer-max-rows: var(--violet-composer-max-rows, 8);
    }

    .root {
        display: flex;
        flex-direction: column;
        border: var(--_card-border-width, 1px) solid var(--_border-subtle);
        border-radius: var(--_radius-lg);
        background: var(--_surface-card);
        overflow: hidden;
        transition: border-color 0.15s ease;
    }

    .root:focus-within {
        border-color: var(--_focus-ring);
    }

    .input-row {
        display: flex;
        align-items: flex-end;
        gap: var(--_space-sm);
        padding: var(--_space-sm) var(--_space-md);
    }

    .input-field {
        flex: 1;
        min-inline-size: 0;
        --_surface-page: transparent;
        --_surface-subtle: transparent;
        --_border-subtle: transparent;
        --_shadow-control: none;
        --_focus-ring: transparent;
    }

    .input-field::part(control-frame) {
        min-block-size: auto;
        padding: 0;
        border: 0;
        background: transparent;
        box-shadow: none;
        transform: none;
    }

    .input-field::part(label) {
        position: absolute;
        inline-size: 1px;
        block-size: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        clip-path: inset(50%);
        white-space: nowrap;
        border: 0;
    }

    .input-field::part(control) {
        min-block-size: calc(var(--_composer-line-height) * var(--_composer-min-rows));
        max-block-size: calc(var(--_composer-line-height) * var(--_composer-max-rows));
        padding-block: var(--_space-xs, 4px);
        resize: none;
        overflow-y: auto;
        field-sizing: content;
    }

    .actions {
        display: flex;
        align-items: center;
        gap: var(--_space-sm);
        padding: 0 var(--_space-md) var(--_space-sm);
    }

    .actions[hidden] {
        display: none;
    }

    .footer {
        padding: var(--_space-xs, 4px) var(--_space-md);
        border-block-start: var(--_card-border-width, 1px) solid var(--_border-subtle);
        font-size: calc(var(--_composer-font-size) * 0.85);
        color: var(--_text-secondary, #414651);
    }

    .footer[hidden] {
        display: none;
    }

    @media (forced-colors: active) {
        .root {
            forced-color-adjust: none;
            border-color: ButtonText;
            background: Canvas;
        }
    }
`;

const template = html<VioletChatComposer>`
    <div class="root" part="root">
        <div class="input-row">
            <violet-text-area
                class="input-field"
                part="input"
                label="${x => x.label}"
                placeholder="${x => x.placeholder}"
                value="${x => x.value}"
                ?disabled="${x => x.disabled || x.status === "submitted" || x.status === "streaming"}"
                rows="3"
                @keydown="${(x, c) => x.handleKeydown(c.event as KeyboardEvent)}"
                @input="${(x, c) => x.handleInput(c.event)}"
            ></violet-text-area>
            ${x => x.status === "streaming"
                ? html<VioletChatComposer>`
                    <violet-icon-button
                        appearance="primary"
                        label="Stop generating"
                        part="stop-button"
                        @click="${x => x.handleStop()}"
                    >
                        <violet-icon icon="system/stop" decorative></violet-icon>
                    </violet-icon-button>
                `
                : html<VioletChatComposer>`
                    <violet-icon-button
                        appearance="primary"
                        label="Send message"
                        part="submit-button"
                        ?disabled="${x => !x.canSubmit}"
                        @click="${x => x.handleSubmit()}"
                    >
                        <violet-icon icon="system/arrow-up" decorative></violet-icon>
                    </violet-icon-button>
                `
            }
        </div>
        <div class="actions" part="actions" ?hidden="${x => !x.hasActions}">
            <slot name="actions" @slotchange="${x => x.handleActionsSlotChange()}"></slot>
        </div>
        <div class="footer" part="footer" ?hidden="${x => !x.hasFooter}">
            <slot name="footer" @slotchange="${x => x.handleFooterSlotChange()}"></slot>
        </div>
    </div>
`;

/**
 * Violet chat composer.
 *
 * @summary Prompt input shell with auto-growing textarea, submit/stop
 *          toggle, and optional action and footer slots.
 * @attr label - Programmatic label forwarded to the composer input.
 * @slot actions - Action buttons (attach file, etc.).
 * @slot footer - Below-input content (token count, model picker, etc.).
 * @csspart root - The outer container.
 * @csspart input - The textarea.
 * @csspart submit-button - The send button.
 * @csspart stop-button - The stop button (shown during streaming).
 * @csspart actions - The action button row.
 * @csspart footer - The footer area.
 * @fires submit - When the user submits a message. Detail: { text }.
 * @fires stop - When the user clicks stop during streaming.
 */
export class VioletChatComposer extends FASTElement {
    declare public status: string;
    declare public placeholder: string;
    declare public label: string;
    declare public disabled: boolean;
    declare public value: string;

    @observable
    declare public hasInput: boolean;

    @observable
    declare public hasActions: boolean;

    @observable
    declare public hasFooter: boolean;

    public constructor() {
        super();
        this.status = "ready";
        this.placeholder = "Send a message\u2026";
        this.label = "Message";
        this.disabled = false;
        this.value = "";
        this.hasInput = false;
        this.hasActions = false;
        this.hasFooter = false;
    }

    public connectedCallback(): void {
        super.connectedCallback();
        registerSystemArrowUpIcon();
        registerSystemStopIcon();
        this.syncInputState();
        queueMicrotask(() => this.syncTextareaHeight());
    }

    get textAreaField(): VioletTextArea | null {
        return this.shadowRoot?.querySelector("violet-text-area") as VioletTextArea | null;
    }

    get textareaEl(): HTMLTextAreaElement | null {
        return this.textAreaField?.shadowRoot?.querySelector("textarea") as HTMLTextAreaElement | null;
    }

    get canSubmit(): boolean {
        return !this.disabled && this.status !== "submitted" && this.status !== "streaming" && Boolean(this.value.trim());
    }

    public handleKeydown(event: KeyboardEvent): boolean {
        // Enter that confirms an IME composition must not submit the message.
        if (event.isComposing || event.keyCode === 229) {
            return true;
        }

        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            // Enter never stops a running response; Stop is the explicit button.
            if (this.status !== "streaming") {
                this.handleSubmit();
            }
            return false;
        }
        return true;
    }

    public handleInput(_event: Event): void {
        const field = this.textAreaField;
        this.value = field?.value ?? "";
        this.hasInput = Boolean(this.value.trim());
        this.syncTextareaHeight();
    }

    public handleSubmit(): void {
        const field = this.textAreaField;
        const text = field?.value.trim();
        if (!text || this.disabled || this.status === "submitted" || this.status === "streaming") {
            return;
        }

        this.$emit("submit", { text });

        if (field) {
            field.value = "";
        }
        this.value = "";
        this.hasInput = false;
        this.syncTextareaHeight();
    }

    public handleStop(): void {
        this.$emit("stop");
    }

    public handleActionsSlotChange(): void {
        const slot = this.shadowRoot?.querySelector('slot[name="actions"]') as HTMLSlotElement | null;
        this.hasActions = (slot?.assignedNodes({ flatten: true }) ?? []).some(node => {
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

    public valueChanged(): void {
        if (this.$fastController.isConnected) {
            this.syncInputState();
            queueMicrotask(() => this.syncTextareaHeight());
        }
    }

    public syncInputState(): void {
        this.hasInput = Boolean(this.value.trim());
    }

    public syncTextareaHeight(): void {
        const textarea = this.textareaEl;
        if (!textarea) {
            return;
        }

        const lineHeight = Number.parseFloat(getComputedStyle(textarea).lineHeight) || 20;
        const maxRows = Number.parseFloat(getComputedStyle(this).getPropertyValue("--_composer-max-rows")) || 8;
        const maxHeight = lineHeight * maxRows;

        textarea.style.height = "auto";
        textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
        textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
    }
}

export type VioletChatComposerStatus = "ready" | "submitted" | "streaming" | "error";

attr(VioletChatComposer.prototype, "status");
attr(VioletChatComposer.prototype, "placeholder");
attr(VioletChatComposer.prototype, "label");
// fromView: typed text must not be reflected back into the DOM `value` attribute.
attr({ mode: "fromView" })(VioletChatComposer.prototype, "value");
attr({ mode: "boolean" })(VioletChatComposer.prototype, "disabled");

if (!customElements.get("violet-chat-composer")) {
    await FASTElement.define(VioletChatComposer, {
        name: "violet-chat-composer",
        template,
        styles,
        shadowOptions: { delegatesFocus: true },
    });
}
