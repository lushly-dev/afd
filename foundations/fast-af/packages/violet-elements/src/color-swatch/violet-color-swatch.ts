import { FASTElement, attr, css, html } from "@lushly-dev/fast-element";

import { normalizeHexColor } from "../color-picker/violet-color-utils";
import { violetSurfaceTokenDefaults } from "../theme/violet-token-defaults";

export type VioletColorSwatchShape = "square" | "circle";
export type VioletColorSwatchSize = "compact" | "natural" | "comfortable";

const styles = css`
    ${violetSurfaceTokenDefaults}

    :host {
        display: inline-grid;
        color: inherit;
    }

    :host([size="compact"]) {
        --_swatch-size: 1rem;
    }

    :host([size="natural"]) {
        --_swatch-size: 1.25rem;
    }

    :host([size="comfortable"]) {
        --_swatch-size: 1.5rem;
    }

    .swatch {
        position: relative;
        inline-size: var(--_swatch-size, 1.25rem);
        block-size: var(--_swatch-size, 1.25rem);
        border: 1px solid var(--_border-subtle);
        border-radius: var(--_radius-md);
        box-shadow: inset 0 0 0 1px color-mix(in srgb, white 24%, transparent);
        overflow: hidden;
        background:
            linear-gradient(45deg, color-mix(in srgb, var(--_text-primary) 6%, transparent) 25%, transparent 25%, transparent 75%, color-mix(in srgb, var(--_text-primary) 6%, transparent) 75%),
            linear-gradient(45deg, color-mix(in srgb, var(--_text-primary) 6%, transparent) 25%, transparent 25%, transparent 75%, color-mix(in srgb, var(--_text-primary) 6%, transparent) 75%),
            var(--_swatch-color, transparent);
        background-position:
            0 0,
            0.375rem 0.375rem,
            0 0;
        background-size:
            0.75rem 0.75rem,
            0.75rem 0.75rem,
            auto;
    }

    :host([shape="circle"]) .swatch {
        border-radius: var(--_radius-round);
    }
`;

const template = html<VioletColorSwatch>`
    <span
        class="swatch"
        part="swatch"
        role="${x => (x.decorative ? "presentation" : "img")}"
        aria-label="${x => (x.decorative ? null : x.ariaLabel)}"
        style="${x => `--_swatch-color: ${x.normalizedValue || "transparent"};`}"
    ></span>
`;

/**
 * Small reusable color preview swatch.
 *
 * @summary Token-driven color sample used by the Violet color picker and color-adjacent surfaces.
 * @csspart swatch - The rendered swatch surface.
 */
export class VioletColorSwatch extends FASTElement {
    declare public value: string;
    declare public label: string;
    declare public decorative: boolean;
    declare public shape: VioletColorSwatchShape;
    declare public size: VioletColorSwatchSize;

    public constructor() {
        super();
        this.value = "";
        this.label = "";
        this.decorative = false;
        this.shape = "square";
        this.size = "natural";
    }

    public get normalizedValue(): string {
        return normalizeHexColor(this.value) ?? "";
    }

    public get ariaLabel(): string {
        return this.label || this.normalizedValue || "No color selected";
    }
}

attr(VioletColorSwatch.prototype, "value");
attr(VioletColorSwatch.prototype, "label");
attr({ mode: "boolean" })(VioletColorSwatch.prototype, "decorative");
attr(VioletColorSwatch.prototype, "shape");
attr(VioletColorSwatch.prototype, "size");

if (!customElements.get("violet-color-swatch")) {
    await VioletColorSwatch.define({
        name: "violet-color-swatch",
        template,
        styles,
    });
}
