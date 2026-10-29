import { afterEach, describe, expect, it } from "vitest";

import { hasVioletIcon, registerVioletIcon, resolveVioletIcon } from "./icon-registry";
import "./violet-icon";
import type { VioletIcon } from "./violet-icon";

function nextFrame(): Promise<void> {
    return new Promise(resolve => {
        requestAnimationFrame(() => resolve());
    });
}

const squareSvg =
    '<svg viewBox="0 0 24 24" data-test-icon="square" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="4" width="16" height="16"/></svg>';
const circleSvg =
    '<svg viewBox="0 0 24 24" data-test-icon="circle" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="8"/></svg>';

registerVioletIcon({
    name: "spec/square",
    svg: squareSvg,
    sourceId: "spec",
    originalFile: "square.svg",
});
registerVioletIcon({
    name: "spec/circle",
    svg: circleSvg,
    sourceId: "spec",
    originalFile: "circle.svg",
});

async function renderIcon(configure?: (icon: VioletIcon) => void): Promise<VioletIcon> {
    document.body.innerHTML = "";

    const icon = document.createElement("violet-icon") as VioletIcon;
    configure?.(icon);
    document.body.append(icon);

    await customElements.whenDefined("violet-icon");
    await nextFrame();

    return icon;
}

function glyph(icon: VioletIcon): HTMLElement {
    const element = icon.shadowRoot?.querySelector(".glyph") as HTMLElement | null;
    if (!element) {
        throw new Error("violet-icon did not render its glyph wrapper");
    }
    return element;
}

describe("violet-icon registry", () => {
    it("resolves registered icons by name", () => {
        expect(hasVioletIcon("spec/square")).toBe(true);
        expect(resolveVioletIcon("spec/square")?.svg).toBe(squareSvg);
        expect(resolveVioletIcon("spec/missing")).toBeNull();
        expect(hasVioletIcon("spec/missing")).toBe(false);
    });
});

describe("violet-icon", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("has defaults", async () => {
        const icon = await renderIcon();

        expect(icon.icon).toBe("system/search");
        expect(icon.label).toBe("");
        expect(icon.decorative).toBe(false);
    });

    it("renders the registered svg for its icon name", async () => {
        const icon = await renderIcon(el => {
            el.setAttribute("icon", "spec/square");
        });

        expect(icon.icon).toBe("spec/square");
        expect(glyph(icon).querySelector('svg[data-test-icon="square"]')).not.toBeNull();
    });

    it("re-renders when the icon changes", async () => {
        const icon = await renderIcon(el => {
            el.icon = "spec/square";
        });

        icon.icon = "spec/circle";
        await nextFrame();

        expect(icon.getAttribute("icon")).toBe("spec/circle");
        expect(glyph(icon).querySelector('svg[data-test-icon="circle"]')).not.toBeNull();
        expect(glyph(icon).querySelector('svg[data-test-icon="square"]')).toBeNull();
    });

    it("renders a fallback glyph for unknown icon names", async () => {
        const icon = await renderIcon(el => {
            el.icon = "spec/does-not-exist";
        });
        const svg = glyph(icon).querySelector("svg");

        expect(svg).not.toBeNull();
        expect(svg?.hasAttribute("data-test-icon")).toBe(false);
        expect(svg?.querySelectorAll("path")).toHaveLength(2);
    });

    it("exposes an image role labelled by label when not decorative", async () => {
        const icon = await renderIcon(el => {
            el.icon = "spec/square";
            el.label = "Square shape";
        });

        expect(glyph(icon).getAttribute("role")).toBe("img");
        expect(glyph(icon).getAttribute("aria-label")).toBe("Square shape");
        expect(glyph(icon).getAttribute("aria-hidden")).toBe("false");
    });

    it("falls back to the icon name as the accessible label", async () => {
        const icon = await renderIcon(el => {
            el.icon = "spec/square";
        });

        expect(glyph(icon).getAttribute("aria-label")).toBe("spec/square");
    });

    it("hides decorative icons from assistive technology", async () => {
        const icon = await renderIcon(el => {
            el.icon = "spec/square";
            el.label = "ignored";
            el.setAttribute("decorative", "");
        });

        expect(icon.decorative).toBe(true);
        expect(glyph(icon).getAttribute("role")).toBe("presentation");
        expect(glyph(icon).getAttribute("aria-hidden")).toBe("true");
        expect(glyph(icon).hasAttribute("aria-label")).toBe(false);
    });

    it("reflects label and decorative properties to attributes", async () => {
        const icon = await renderIcon();

        icon.label = "Search";
        icon.decorative = true;
        await nextFrame();

        expect(icon.getAttribute("label")).toBe("Search");
        expect(icon.hasAttribute("decorative")).toBe(true);

        icon.decorative = false;
        await nextFrame();

        expect(icon.hasAttribute("decorative")).toBe(false);
        expect(glyph(icon).getAttribute("role")).toBe("img");
    });
});
