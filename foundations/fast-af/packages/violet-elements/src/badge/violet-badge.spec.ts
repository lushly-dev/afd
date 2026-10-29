import { afterEach, describe, expect, it } from "vitest";

import "./violet-badge";
import type { VioletBadge } from "./violet-badge";

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

async function renderBadge(
    template = `<violet-badge appearance="outline" color="success" size="lg">Saved</violet-badge>`
): Promise<VioletBadge> {
    document.body.innerHTML = template;
    await customElements.whenDefined("violet-badge");
    await nextFrame();
    return document.querySelector("violet-badge") as VioletBadge;
}

describe("violet-badge", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("renders slotted content with the configured attributes", async () => {
        const badge = await renderBadge();

        expect(badge.getAttribute("appearance")).toBe("outline");
        expect(badge.getAttribute("color")).toBe("success");
        expect(badge.getAttribute("size")).toBe("lg");
        expect(badge.textContent?.trim()).toBe("Saved");
    });

    it("hides the badge from assistive technology when decorative", async () => {
        const badge = await renderBadge(`<violet-badge decorative>Trial</violet-badge>`);

        expect(badge.getAttribute("aria-hidden")).toBe("true");
    });

    it("renders the optional leading icon", async () => {
        const badge = await renderBadge(`<violet-badge icon="system/check">Saved</violet-badge>`);

        expect(badge.shadowRoot?.querySelector("violet-icon")?.getAttribute("icon")).toBe("system/check");
    });

    it("supports an explicit accessible label for icon-only badges", async () => {
        const badge = await renderBadge(`<violet-badge icon="system/check" label="Saved"></violet-badge>`);

        expect(badge.getAttribute("aria-label")).toBe("Saved");
    });
});
