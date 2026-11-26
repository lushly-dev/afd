import { afterEach, describe, expect, it } from "vitest";
import { cdp, server, userEvent } from "vitest/browser";

const isChromium = server.browser === "chromium";

import "../tab-panel/violet-tab-panel.define";
import type { VioletTabPanel } from "../tab-panel/violet-tab-panel";
import "../tab/violet-tab.define";
import type { VioletTab } from "../tab/violet-tab";
import "./violet-tabs.define";
import type { VioletTabs } from "./violet-tabs";

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

async function renderTabs(
  options: {
    appearance?: "open" | "closed" | "mixed";
    orientation?: "horizontal" | "vertical";
    disableThirdTab?: boolean;
  } = {},
): Promise<{
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

  const panels = ["Overview panel", "Planting panel", "Irrigation panel"].map((copy) => {
    const panel = document.createElement("violet-tab-panel") as VioletTabPanel;
    panel.textContent = copy;
    return panel;
  });

  tabItems.forEach((tab) => {
    tabs.append(tab);
  });
  panels.forEach((panel) => {
    tabs.append(panel);
  });
  document.body.append(tabs);

  await customElements.whenDefined("violet-tabs");
  await nextFrame();

  return { tabs, tabItems, panels };
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

/** The name Chromium's accessibility tree gives the tab list, read from the frame the spec runs in. */
async function tablistName(): Promise<string | undefined> {
  const session = cdp() as unknown as { send(method: string, params?: object): Promise<unknown> };
  const { frameTree } = (await session.send("Page.getFrameTree")) as {
    frameTree: { childFrames?: { frame: { id: string; url: string } }[] };
  };
  const frame = frameTree.childFrames?.find((child) => child.frame.url === location.href)?.frame;
  expect(frame).toBeDefined();
  const { nodes } = (await session.send("Accessibility.getFullAXTree", { frameId: frame?.id })) as {
    nodes: { role?: { value?: string }; name?: { value?: string } }[];
  };
  return nodes.find((node) => node.role?.value === "tablist")?.name?.value;
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
      }),
    );
    await nextFrame();

    expect(tabs.activeid).toBe(tabItems[1]?.id);
    expect(tabItems[1]?.tabIndex).toBe(0);

    tabItems[1]?.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        key: "ArrowRight",
      }),
    );
    await nextFrame();

    expect(tabs.activeid).toBe(tabItems[0]?.id);

    tabItems[0]?.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        key: "End",
      }),
    );
    await nextFrame();

    expect(tabs.activeid).toBe(tabItems[1]?.id);

    tabItems[1]?.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        key: "Home",
      }),
    );
    await nextFrame();

    expect(tabs.activeid).toBe(tabItems[0]?.id);
  });

  // #1172: parsed markup upgrades in tree order, so violet-tabs connects before its violet-tab
  // children are upgraded and called methods they did not have yet.
  describe("mounted from parsed markup", () => {
    async function renderMarkup(): Promise<{
      tabs: VioletTabs;
      tabItems: VioletTab[];
      panels: VioletTabPanel[];
      errors: unknown[];
    }> {
      const errors: unknown[] = [];
      const onError = (event: ErrorEvent) => {
        errors.push(event.error ?? event.message);
        event.preventDefault();
      };
      window.addEventListener("error", onError);
      try {
        document.body.innerHTML = `
                    <violet-tabs appearance="mixed" label="Account settings">
                        <violet-tab>Profile</violet-tab>
                        <violet-tab>Security</violet-tab>
                        <violet-tab disabled>Billing</violet-tab>
                        <violet-tab>Notifications</violet-tab>
                        <violet-tab-panel>Profile panel</violet-tab-panel>
                        <violet-tab-panel>Security panel</violet-tab-panel>
                        <violet-tab-panel>Billing panel</violet-tab-panel>
                        <violet-tab-panel>Notifications panel</violet-tab-panel>
                    </violet-tabs>`;
        await nextFrame();
        await nextFrame();
      } finally {
        window.removeEventListener("error", onError);
      }
      const tabs = document.querySelector("violet-tabs") as VioletTabs;
      return {
        tabs,
        tabItems: Array.from(tabs.querySelectorAll("violet-tab")),
        panels: Array.from(tabs.querySelectorAll("violet-tab-panel")),
        errors,
      };
    }

    it("connects without errors and presents every tab", async () => {
      const { tabItems, panels, errors } = await renderMarkup();

      expect(errors).toEqual([]);
      expect(tabItems.map((tab) => tab.getAttribute("data-appearance"))).toEqual([
        "mixed",
        "open",
        "open",
        "open",
      ]);
      expect(tabItems.map((tab) => tab.getAttribute("aria-selected"))).toEqual([
        "true",
        "false",
        "false",
        "false",
      ]);
      expect(tabItems.map((tab) => tab.tabIndex)).toEqual([0, -1, -1, -1]);
      expect(tabItems[2]?.getAttribute("aria-disabled")).toBe("true");
      expect(panels.map((panel) => panel.hidden)).toEqual([false, true, true, true]);
      expect(panels[0]?.getAttribute("aria-labelledby")).toBe(tabItems[0]?.id);
    });

    it("selects on click and moves past the disabled tab from the keyboard", async () => {
      const { tabs, tabItems, panels } = await renderMarkup();

      await userEvent.click(tabItems[1] as VioletTab);
      await nextFrame();
      expect(tabs.activeid).toBe(tabItems[1]?.id);
      expect(panels[1]?.hidden).toBe(false);
      expect(tabItems[1]?.getAttribute("data-appearance")).toBe("mixed");
      expect(document.activeElement).toBe(tabItems[1]);

      await userEvent.keyboard("{ArrowRight}");
      await nextFrame();
      expect(tabs.activeid).toBe(tabItems[3]?.id);
      expect(document.activeElement).toBe(tabItems[3]);
      expect(panels[3]?.hidden).toBe(false);
      expect(panels[1]?.hidden).toBe(true);
    });
  });

  it("resolves mixed appearance so only the active tab gets the closed treatment", async () => {
    const { tabItems } = await renderTabs({
      appearance: "mixed",
    });

    expect(tabItems[0]?.getAttribute("data-appearance")).toBe("mixed");
    expect(tabItems[1]?.getAttribute("data-appearance")).toBe("open");
  });

  // #1585: the tab list is in the shadow root, so the host's aria-label did not reach it.
  describe("naming the tab list", () => {
    it("is unnamed by default", async () => {
      const { tabs } = await renderTabs();
      const tablist = tabs.shadowRoot?.querySelector('[role="tablist"]') as HTMLElement;

      expect(tablist.hasAttribute("aria-label")).toBe(false);
    });

    it("takes its name from label", async () => {
      const { tabs } = await renderTabs();
      tabs.label = "Account settings";
      await nextFrame();
      const tablist = tabs.shadowRoot?.querySelector('[role="tablist"]') as HTMLElement;

      expect(tablist.getAttribute("aria-label")).toBe("Account settings");
      if (isChromium) {
        expect(await tablistName()).toBe("Account settings");
      }
    });

    it("follows label as it changes", async () => {
      const { tabs } = await renderTabs();
      const tablist = tabs.shadowRoot?.querySelector('[role="tablist"]') as HTMLElement;

      tabs.setAttribute("label", "Billing");
      await nextFrame();
      expect(tablist.getAttribute("aria-label")).toBe("Billing");

      tabs.removeAttribute("label");
      await nextFrame();
      expect(tablist.hasAttribute("aria-label")).toBe(false);
    });

    it("leaves the host's aria-label and its native property alone", async () => {
      const { tabs } = await renderTabs();
      tabs.setAttribute("aria-label", "Old");
      tabs.ariaLabel = "New";
      await nextFrame();
      const tablist = tabs.shadowRoot?.querySelector('[role="tablist"]') as HTMLElement;

      // ARIAMixin reflection still works: violet-tabs defines no aria-label of its own.
      expect(tabs.getAttribute("aria-label")).toBe("New");
      expect(tablist.hasAttribute("aria-label")).toBe(false);
    });
  });

  // #1584: each panel is a tab stop, and a focused panel drew no focus indicator.
  describe("a focused panel", () => {
    afterEach(async () => {
      if (isChromium) {
        await emulateForcedColors(false);
      }
    });

    for (const forcedColors of isChromium ? [false, true] : [false]) {
      it(`shows the focus ring${forcedColors ? " under forced colours" : ""}`, async () => {
        if (isChromium) {
          await emulateForcedColors(forcedColors);
        }
        const { tabItems, panels } = await renderTabs();
        tabItems[0]?.focus();
        await userEvent.tab();

        const panel = panels[0] as VioletTabPanel;
        expect(document.activeElement).toBe(panel);
        expect(panel.matches(":focus-visible")).toBe(true);
        const style = getComputedStyle(panel);
        expect(style.outlineStyle).toBe("solid");
        expect(style.outlineWidth).toBe("2px");
        if (forcedColors) {
          expect(style.outlineColor).toBe(systemColor("Highlight"));
        }
      });
    }
  });
});
