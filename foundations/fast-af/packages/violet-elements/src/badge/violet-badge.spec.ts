import { afterEach, describe, expect, it } from "vitest";
import { cdp } from "vitest/browser";

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

/**
 * Emulates a dark forced-colours theme (Windows "Night sky") with reduced motion, or restores the
 * media Playwright emulates by default, so later spec files on the page do not follow the host.
 */
async function emulateForcedColors(active: boolean): Promise<void> {
    const session = cdp() as unknown as { send(method: string, params?: object): Promise<unknown> };
    await session.send("Emulation.setEmulatedMedia", {
        features: [
            { name: "forced-colors", value: active ? "active" : "none" },
            { name: "prefers-color-scheme", value: active ? "dark" : "light" },
            { name: "prefers-reduced-motion", value: active ? "reduce" : "no-preference" },
            { name: "prefers-contrast", value: "no-preference" },
        ],
    });
}

/** What a system colour resolves to in the current colour scheme. */
function systemColor(name: string): string {
    const probe = document.createElement("span");
    probe.style.color = name;
    document.body.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
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

    it("keeps its status colour with no theme installed", async () => {
        const badge = await renderBadge(`<violet-badge color="danger">Overdue</violet-badge>`);
        expect(getComputedStyle(badge).getPropertyValue("--color-state-danger-text")).toBe("");
        // The light theme's values are the fallbacks: #C42A1A text on #F7E4DF.
        expect(getComputedStyle(badge).getPropertyValue("--_badge-text").trim().toLowerCase()).toBe("#c42a1a");
        expect(getComputedStyle(badge).getPropertyValue("--_badge-bg").trim().toLowerCase()).toBe("#f7e4df");
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

    describe("under forced colours", () => {
        afterEach(async () => {
            await emulateForcedColors(false);
        });

        // #1576: the subtle appearance's fill outranked the forced-colours rule.
        for (const appearance of ["filled", "outline", "subtle"]) {
            it(`paints the ${appearance} badge in the system colours`, async () => {
                await emulateForcedColors(true);
                const badge = await renderBadge(
                    `<violet-badge appearance="${appearance}" color="success">Active</violet-badge>`
                );
                const surface = badge.shadowRoot?.querySelector(".badge") as HTMLElement;
                const style = getComputedStyle(surface);

                expect(matchMedia("(forced-colors: active)").matches).toBe(true);
                expect(style.forcedColorAdjust).toBe("none");
                expect(style.backgroundColor).toBe(systemColor("Canvas"));
                expect(style.color).toBe(systemColor("CanvasText"));
                expect(style.borderTopColor).toBe(systemColor("ButtonText"));
            });
        }
    });
});
