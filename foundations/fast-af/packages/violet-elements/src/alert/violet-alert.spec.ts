import { afterEach, describe, expect, it, vi } from "vitest";
import { cdp, page, server } from "vitest/browser";

const isChromium = server.browser === "chromium";

import "../button/violet-button.define";
import { systemCheckmarkIcon } from "../icon/generated/icons/system-checkmark";
import { clearVioletIconRegistryForTesting } from "../icon/icon-registry";
import "./violet-alert.define";
import type { VioletAlert } from "./violet-alert";

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function renderAlert(
  template = `
        <violet-alert tone="warning">
            <span slot="title">Check before planting</span>
            Soil temperature is below the preferred transplant range.
            <span slot="actions">Review changes</span>
        </violet-alert>
    `,
): Promise<VioletAlert> {
  document.body.innerHTML = template;
  await customElements.whenDefined("violet-alert");
  await nextFrame();
  return document.querySelector("violet-alert") as VioletAlert;
}

/**
 * Emulates a dark forced-colours theme, as Windows' "Night sky" gives, or restores the media
 * Playwright emulates by default, so later spec files on the page do not follow the host's settings.
 */
async function emulateForcedColors(active: boolean): Promise<void> {
  const session = cdp() as unknown as { send(method: string, params?: object): Promise<unknown> };
  await session.send("Emulation.setEmulatedMedia", {
    features: [
      { name: "forced-colors", value: active ? "active" : "none" },
      { name: "prefers-color-scheme", value: active ? "dark" : "light" },
      { name: "prefers-reduced-motion", value: "no-preference" },
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

describe("violet-alert", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders title and actions from slots", async () => {
    const alert = await renderAlert();
    const titleSlot = alert.shadowRoot?.querySelector(
      'slot[name="title"]',
    ) as HTMLSlotElement | null;
    const actionsSlot = alert.shadowRoot?.querySelector(
      'slot[name="actions"]',
    ) as HTMLSlotElement | null;
    const titleText = titleSlot
      ?.assignedNodes({ flatten: true })
      .map((node) => node.textContent ?? "")
      .join("")
      .trim();
    const actionsText = actionsSlot
      ?.assignedNodes({ flatten: true })
      .map((node) => node.textContent ?? "")
      .join("")
      .trim();

    expect(titleText).toBe("Check before planting");
    expect(actionsText?.includes("Review changes")).toBe(true);
  });

  it("maps assertive announcement to alert semantics", async () => {
    const alert = await renderAlert(
      `<violet-alert announcement="assertive">Immediate attention needed.</violet-alert>`,
    );
    const copy = alert.shadowRoot?.querySelector(".copy");

    expect(copy?.getAttribute("role")).toBe("alert");
    expect(copy?.getAttribute("aria-live")).toBe("assertive");
  });

  it("emits dismiss when the dismiss button is activated", async () => {
    const alert = await renderAlert(`<violet-alert dismissible>Saved successfully.</violet-alert>`);
    const handler = vi.fn();
    const dismissButton = alert.shadowRoot
      ?.querySelector("violet-icon-button")
      ?.shadowRoot?.querySelector("button") as HTMLButtonElement | null;

    alert.addEventListener("dismiss", handler);
    dismissButton?.click();

    expect(handler).toHaveBeenCalledTimes(1);
  });

  if (isChromium)
    describe("under forced colours", () => {
      afterEach(async () => {
        await emulateForcedColors(false);
      });

      it("lets slotted content take the system colours while the frame keeps its own", async () => {
        await emulateForcedColors(true);
        const alert = await renderAlert(`
                <violet-alert tone="danger" dismissible>
                    <span slot="title">Could not save</span>
                    <span class="body">The file is locked.</span>
                    <a slot="actions" href="#retry" style="color: rgb(24, 27, 26)">Retry</a>
                </violet-alert>
            `);

        const canvasText = systemColor("CanvasText");
        expect(matchMedia("(forced-colors: active)").matches).toBe(true);
        for (const selector of ['[slot="title"]', ".body"]) {
          const element = alert.querySelector(selector) as HTMLElement;
          expect(getComputedStyle(element).forcedColorAdjust).toBe("auto");
          expect(getComputedStyle(element).color).toBe(canvasText);
        }
        // A link keeps its own system colour, never the theme's.
        const action = alert.querySelector('[slot="actions"]') as HTMLElement;
        expect(getComputedStyle(action).forcedColorAdjust).toBe("auto");
        expect(getComputedStyle(action).color).toBe(systemColor("LinkText"));

        const card = alert.shadowRoot?.querySelector(".frame") as HTMLElement;
        const root = card.shadowRoot?.querySelector(".root") as HTMLElement;
        const leading = alert.shadowRoot?.querySelector(".leading") as HTMLElement;
        const dismiss = alert.shadowRoot?.querySelector(".dismiss") as HTMLElement;
        const dismissControl = dismiss.shadowRoot?.querySelector("button") as HTMLElement;
        const dismissIcon = dismiss.querySelector("violet-icon") as HTMLElement;
        const buttonText = systemColor("ButtonText");
        expect(getComputedStyle(root).forcedColorAdjust).toBe("none");
        expect(getComputedStyle(root).backgroundColor).toBe(systemColor("Canvas"));
        expect(getComputedStyle(leading).forcedColorAdjust).toBe("none");
        expect(getComputedStyle(leading).color).toBe(buttonText);
        expect(getComputedStyle(dismissControl).color).toBe(buttonText);
        expect(getComputedStyle(dismissIcon).color).toBe(buttonText);
      });
    });

  // #1588: the alert registered its icons after its first render, so the first one drew the fallback.
  it("draws its tone icon on its first render", () => {
    clearVioletIconRegistryForTesting();
    document.body.innerHTML = `<violet-alert tone="success"><span slot="title">Saved</span>Your changes are saved.</violet-alert>`;
    const alert = document.querySelector("violet-alert") as VioletAlert;
    const icon = alert.shadowRoot?.querySelector(".leading violet-icon");

    expect(icon?.getAttribute("icon")).toBe("system/checkmark");
    // Compare with the registered checkmark's own path, so a redrawn icon does not break the test.
    const checkmarkPath = /\sd="[^"]+"/u.exec(systemCheckmarkIcon.svg)?.[0];
    expect(checkmarkPath).toBeTruthy();
    expect(icon?.shadowRoot?.querySelector(".glyph")?.innerHTML).toContain(checkmarkPath);
  });

  describe("narrow action row (#1589)", () => {
    afterEach(async () => {
      await page.viewport(1280, 720);
    });

    it("expands a lone slotted action to fill the row below 480px", async () => {
      await page.viewport(320, 600);
      const alert = await renderAlert(`
                <violet-alert tone="danger">
                    <span slot="title">Could not save</span>
                    The connection dropped.
                    <violet-button slot="actions" appearance="primary">Try again</violet-button>
                </violet-alert>
            `);

      const actions = alert.shadowRoot?.querySelector(".actions") as HTMLElement;
      const button = alert.querySelector("violet-button") as HTMLElement;
      const control = button.shadowRoot?.querySelector("button") as HTMLButtonElement;

      expect(alert.hasSingleAction).toBe(true);
      expect(actions.hasAttribute("data-single-action")).toBe(true);
      expect(button.getBoundingClientRect().width).toBeCloseTo(
        actions.getBoundingClientRect().width,
        0,
      );
      expect(control.getBoundingClientRect().width).toBeCloseTo(
        actions.getBoundingClientRect().width,
        0,
      );
    });

    it("keeps a lone action at content width above 480px and keeps multiple actions at content width below 480px", async () => {
      await page.viewport(800, 600);
      const wideAlert = await renderAlert(`
                <violet-alert tone="danger">
                    <span slot="title">Could not save</span>
                    The connection dropped.
                    <violet-button slot="actions" appearance="primary">Try again</violet-button>
                </violet-alert>
            `);
      const wideActions = wideAlert.shadowRoot?.querySelector(".actions") as HTMLElement;
      const wideButton = wideAlert.querySelector("violet-button") as HTMLElement;
      expect(wideButton.getBoundingClientRect().width).toBeLessThan(
        wideActions.getBoundingClientRect().width - 20,
      );

      await page.viewport(320, 600);
      const multiAlert = await renderAlert(`
                <violet-alert tone="danger">
                    <span slot="title">Could not save</span>
                    The connection dropped.
                    <violet-button slot="actions" appearance="primary">Try again</violet-button>
                    <violet-button slot="actions" appearance="secondary">Dismiss</violet-button>
                </violet-alert>
            `);
      const multiActions = multiAlert.shadowRoot?.querySelector(".actions") as HTMLElement;
      const firstButton = multiAlert.querySelector("violet-button") as HTMLElement;
      expect(multiAlert.hasSingleAction).toBe(false);
      expect(multiActions.hasAttribute("data-single-action")).toBe(false);
      expect(firstButton.getBoundingClientRect().width).toBeLessThan(
        multiActions.getBoundingClientRect().width - 20,
      );
    });
  });
});
