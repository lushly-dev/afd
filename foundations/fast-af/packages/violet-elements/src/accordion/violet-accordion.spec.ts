import { afterEach, describe, expect, it } from "vitest";
import { cdp, server } from "vitest/browser";

const isChromium = server.browser === "chromium";

import "../accordion-item/violet-accordion-item.define";
import "./violet-accordion.define";
import type { VioletAccordion } from "./violet-accordion";

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function renderAccordion(expandMode: "single" | "multi" = "multi"): Promise<VioletAccordion> {
  document.body.innerHTML = `
        <violet-accordion expand-mode="${expandMode}">
            <violet-accordion-item expanded>
                <span slot="heading">First</span>
                First body
            </violet-accordion-item>
            <violet-accordion-item>
                <span slot="heading">Second</span>
                Second body
            </violet-accordion-item>
        </violet-accordion>
    `;
  await customElements.whenDefined("violet-accordion");
  await nextFrame();
  return document.querySelector("violet-accordion") as VioletAccordion;
}

describe("violet-accordion", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("supports multi-expand behavior", async () => {
    const accordion = await renderAccordion("multi");
    const items = accordion.querySelectorAll("violet-accordion-item");

    (items[1]?.shadowRoot?.querySelector(".trigger") as HTMLButtonElement | null)?.click();
    await nextFrame();

    expect(items[0]?.hasAttribute("expanded")).toBe(true);
    expect(items[1]?.hasAttribute("expanded")).toBe(true);
  });

  it("collapses siblings in single-expand mode", async () => {
    const accordion = await renderAccordion("single");
    const items = accordion.querySelectorAll("violet-accordion-item");

    (items[1]?.shadowRoot?.querySelector(".trigger") as HTMLButtonElement | null)?.click();
    await nextFrame();

    expect(items[0]?.hasAttribute("expanded")).toBe(false);
    expect(items[1]?.hasAttribute("expanded")).toBe(true);
  });

  it("moves focus between enabled items with arrow keys", async () => {
    const accordion = await renderAccordion("multi");
    const items = accordion.querySelectorAll("violet-accordion-item");
    const firstButton = items[0]?.shadowRoot?.querySelector(".trigger") as HTMLButtonElement | null;
    const secondButton = items[1]?.shadowRoot?.querySelector(
      ".trigger",
    ) as HTMLButtonElement | null;

    firstButton?.focus();
    firstButton?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, composed: true }),
    );
    await nextFrame();

    expect(items[1]?.shadowRoot?.activeElement).toBe(secondButton);
  });

  describe("native key handling", () => {
    it("does not cancel Tab or Enter on a trigger, but cancels arrow navigation", async () => {
      const accordion = await renderAccordion("multi");
      const trigger = accordion
        .querySelector("violet-accordion-item")
        ?.shadowRoot?.querySelector(".trigger") as HTMLElement;
      const press = (key: string) => {
        const event = new KeyboardEvent("keydown", {
          key,
          bubbles: true,
          cancelable: true,
          composed: true,
        });
        trigger.dispatchEvent(event);
        return event;
      };

      expect(press("Tab").defaultPrevented).toBe(false);
      expect(press("Enter").defaultPrevented).toBe(false);
      expect(press("ArrowDown").defaultPrevented).toBe(true);
    });
  });

  if (isChromium)
    describe("coarse pointer sizing (#1569)", () => {
      async function emulateCoarsePointer(coarse: boolean): Promise<void> {
        const session = cdp() as unknown as {
          send(method: string, params?: object): Promise<unknown>;
        };
        if (coarse) {
          await session.send("Emulation.setTouchEmulationEnabled", {
            enabled: true,
            maxTouchPoints: 1,
          });
          await session.send("Emulation.setDeviceMetricsOverride", {
            width: 390,
            height: 844,
            deviceScaleFactor: 2,
            mobile: true,
          });
        } else {
          await session.send("Emulation.setTouchEmulationEnabled", { enabled: false });
          await session.send("Emulation.clearDeviceMetricsOverride");
        }
      }

      afterEach(async () => {
        await emulateCoarsePointer(false);
      });

      it("grows the accordion header control to the comfortable target size on coarse pointers", async () => {
        const accordion = await renderAccordion("multi");
        const item = accordion.querySelector("violet-accordion-item") as HTMLElement;
        const trigger = item.shadowRoot?.querySelector(".trigger") as HTMLButtonElement;

        expect(matchMedia("(any-pointer: coarse)").matches).toBe(false);
        expect(getComputedStyle(item).getPropertyValue("--_target-size").trim()).toBe("32px");
        expect(Number.parseFloat(getComputedStyle(trigger).minBlockSize)).toBe(32);

        await emulateCoarsePointer(true);
        await nextFrame();

        expect(matchMedia("(any-pointer: coarse)").matches).toBe(true);
        expect(getComputedStyle(item).getPropertyValue("--_target-size").trim()).toBe("44px");
        expect(Number.parseFloat(getComputedStyle(trigger).minBlockSize)).toBe(44);
        expect(trigger.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);

        // An explicit --violet-target-size override still wins on coarse pointers.
        item.style.setProperty("--violet-target-size", "24px");
        await nextFrame();
        expect(getComputedStyle(item).getPropertyValue("--_target-size").trim()).toBe("24px");
      });
    });
});
