import { FASTElement, attr, css, html } from "@lushly-dev/fast-element";
import type { ViewTemplate } from "@lushly-dev/fast-element";

import { resolveVioletIcon } from "./icon-registry";

const fallbackSvg =
    "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M5 5L19 19\"/><path d=\"M19 5L5 19\"/></svg>";
const iconTemplateCache = new Map<string, ViewTemplate>();

function getIconTemplate(svg: string): ViewTemplate {
    let template = iconTemplateCache.get(svg);

    if (!template) {
        template = html`${html.partial(svg)}`;
        iconTemplateCache.set(svg, template);
    }

    return template;
}

const styles = css`
    :host {
        display: inline-flex;
        inline-size: var(--violet-icon-size, 1em);
        block-size: var(--violet-icon-size, 1em);
        align-items: center;
        justify-content: center;
        aspect-ratio: 1 / 1;
        color: inherit;
        flex: 0 0 auto;
    }

    .glyph {
        display: inline-flex;
        inline-size: 100%;
        block-size: 100%;
        align-items: center;
        justify-content: center;
        color: inherit;
    }

    .glyph svg {
        display: block;
        inline-size: 100%;
        block-size: 100%;
    }
`;

const template = html<VioletIcon>`
    <span
        class="glyph"
        part="glyph"
        role="${x => x.decorative ? "presentation" : "img"}"
        aria-label="${x => x.decorative ? null : (x.label || x.icon)}"
        aria-hidden="${x => x.decorative ? "true" : "false"}"
    >
        ${x => getIconTemplate(resolveVioletIcon(x.icon)?.svg ?? fallbackSvg)}
    </span>
`;

/**
 * Violet reusable icon primitive.
 *
 * @summary Token-driven icon renderer backed by the registered Violet icon registry.
 * @csspart glyph - Inline wrapper containing the rendered SVG.
 */
export class VioletIcon extends FASTElement {
    /**
     * Registry name for the icon, using source-prefixed ids such as system/search.
     */
    declare public icon: string;

    /**
     * Optional accessible label when the icon is not decorative.
     */
    declare public label: string;

    /**
     * Marks the icon decorative when it should be hidden from assistive technology.
     */
    declare public decorative: boolean;

    public constructor() {
        super();
        this.icon = "system/search";
        this.label = "";
        this.decorative = false;
    }
}

attr(VioletIcon.prototype, "icon");
attr(VioletIcon.prototype, "label");
attr({ mode: "boolean" })(VioletIcon.prototype, "decorative");

if (!customElements.get("violet-icon")) {
    await FASTElement.define(VioletIcon, {
        name: "violet-icon",
        template,
        styles,
    });
}
