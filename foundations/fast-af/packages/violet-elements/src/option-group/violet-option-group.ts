import { FASTElement, attr, css, html, observable, when } from "@lushly-dev/fast-element";

import { violetSurfaceTokenDefaults } from "../theme/violet-token-defaults";

let violetOptionGroupId = 0;

const styles = css`
    ${violetSurfaceTokenDefaults}

    :host {
        display: grid;
        gap: var(--_space-stack-2xs);
    }

    .label {
        padding-inline: calc(var(--_space-sm) * 1.5);
        color: var(--_text-secondary);
        font-size: var(--_caption-size);
        font-weight: 600;
        line-height: var(--_caption-line);
        letter-spacing: 0.02em;
    }

    :host([disabled]) .label {
        color: var(--_text-muted);
    }

    .options {
        display: grid;
        gap: 2px;
    }

    ::slotted(violet-option) {
        --violet-option-padding-inline-start: calc(var(--_space-sm) * 3);
    }
`;

const template = html<VioletOptionGroup>`
    ${when(
        x => Boolean(x.label),
        html<VioletOptionGroup>`
            <div class="label" part="label" id="${x => x.labelId}">${x => x.label}</div>
        `
    )}
    <div class="options" part="options">
        <slot></slot>
    </div>
`;

export class VioletOptionGroup extends FASTElement {
    readonly #internals: ElementInternals;

    declare public label: string;
    declare public disabled: boolean;

    @observable
    declare public labelId: string;

    public constructor() {
        super();
        this.#internals = this.attachInternals();
        this.label = "";
        this.disabled = false;
        violetOptionGroupId += 1;
        this.labelId = `violet-option-group-label-${violetOptionGroupId}`;
    }

    public connectedCallback(): void {
        super.connectedCallback();
        this.#syncAccessibility();
    }

    public labelChanged(): void {
        this.#syncAccessibility();
    }

    public disabledChanged(): void {
        this.$emit("group-state-change", { disabled: this.disabled });
    }

    #syncAccessibility(): void {
        this.#internals.role = "group";
        this.#internals.ariaLabel = this.label || "";
    }
}

attr(VioletOptionGroup.prototype, "label");
attr({ mode: "boolean" })(VioletOptionGroup.prototype, "disabled");

if (!customElements.get("violet-option-group")) {
    await FASTElement.define(VioletOptionGroup, {
        name: "violet-option-group",
        template,
        styles,
    });
}
