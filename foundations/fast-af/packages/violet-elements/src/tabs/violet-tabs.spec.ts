import { afterEach, describe, expect, it } from "vitest";

import "../tab-panel/violet-tab-panel";
import type { VioletTabPanel } from "../tab-panel/violet-tab-panel";
import "../tab/violet-tab";
import type { VioletTab } from "../tab/violet-tab";
import "./violet-tabs";
import type { VioletTabs } from "./violet-tabs";

function nextFrame(): Promise<void> {
    return new Promise(resolve => {
        requestAnimationFrame(() => resolve());
    });
}

async function renderTabs(options: {
    appearance?: "open" | "closed" | "mixed";
    orientation?: "horizontal" | "vertical";
    disableThirdTab?: boolean;
} = {}): Promise<{
    tabs: VioletTabs;
    tabItems: VioletTab[];
    panels: VioletTabPanel[];
}> {
    document.body.innerHTML = "";

    const tabs = document.createElement("violet-tabs") as VioletTabs;
    tabs.appearance = options.appearance ?? "open";
    tabs.orientation = options.orientation ?? "horizontal";

    const tabItems = ["Overview", "Planting", "Irrigation"].map((label, index) => {
        const tab = document.createElement("violet-tab") as VioletTab;
        tab.textContent = label;
        tab.disabled = Boolean(options.disableThirdTab) && index === 2;
        return tab;
    });

    const panels = ["Overview panel", "Planting panel", "Irrigation panel"].map(copy => {
        const panel = document.createElement("violet-tab-panel") as VioletTabPanel;
        panel.textContent = copy;
        return panel;
    });

    tabItems.forEach(tab => {
        tabs.append(tab);
    });
    panels.forEach(panel => {
        tabs.append(panel);
    });
    document.body.append(tabs);

    await customElements.whenDefined("violet-tabs");
    await nextFrame();

    return { tabs, tabItems, panels };
}

describe("violet-tabs", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("pairs tabs and panels, updates selection on click, and wires aria relationships", async () => {
        const { tabs, tabItems, panels } = await renderTabs();

        const secondTab = tabItems[1];
        secondTab?.click();
        await nextFrame();

        expect(tabs.activeid).toBe(secondTab?.id);
        expect(secondTab?.getAttribute("aria-selected")).toBe("true");
        expect(secondTab?.getAttribute("aria-controls")).toBe(panels[1]?.id);
        expect(panels[1]?.getAttribute("aria-labelledby")).toBe(secondTab?.id);
        expect(panels[1]?.hidden).toBe(false);
        expect(panels[0]?.hidden).toBe(true);
    });

    it("supports roving keyboard selection, Home/End, and skips disabled tabs", async () => {
        const { tabs, tabItems } = await renderTabs({
            disableThirdTab: true,
        });

        tabItems[0]?.focus();
        tabItems[0]?.dispatchEvent(
            new KeyboardEvent("keydown", {
                bubbles: true,
                key: "ArrowRight",
            })
        );
        await nextFrame();

        expect(tabs.activeid).toBe(tabItems[1]?.id);
        expect(tabItems[1]?.tabIndex).toBe(0);

        tabItems[1]?.dispatchEvent(
            new KeyboardEvent("keydown", {
                bubbles: true,
                key: "ArrowRight",
            })
        );
        await nextFrame();

        expect(tabs.activeid).toBe(tabItems[0]?.id);

        tabItems[0]?.dispatchEvent(
            new KeyboardEvent("keydown", {
                bubbles: true,
                key: "End",
            })
        );
        await nextFrame();

        expect(tabs.activeid).toBe(tabItems[1]?.id);

        tabItems[1]?.dispatchEvent(
            new KeyboardEvent("keydown", {
                bubbles: true,
                key: "Home",
            })
        );
        await nextFrame();

        expect(tabs.activeid).toBe(tabItems[0]?.id);
    });

    it("resolves mixed appearance so only the active tab gets the closed treatment", async () => {
        const { tabItems } = await renderTabs({
            appearance: "mixed",
        });

        expect(tabItems[0]?.getAttribute("data-appearance")).toBe("mixed");
        expect(tabItems[1]?.getAttribute("data-appearance")).toBe("open");
    });
});
