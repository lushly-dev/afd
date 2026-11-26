import { afterEach, describe, expect, it } from "vitest";
import { cdp, server } from "vitest/browser";

const isChromium = server.browser === "chromium";

import "./violet-toast.define";
import type { VioletToast } from "./violet-toast";

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function renderToast(
  template = `
        <violet-toast open tone="success" timeout="5000">
            <span slot="title">Propagation synced</span>
            Seed-source defaults were updated for the spring-greens plan.
        </violet-toast>
    `,
): Promise<VioletToast> {
  document.body.innerHTML = template;
  await customElements.whenDefined("violet-toast");
  await nextFrame();
  return document.querySelector("violet-toast") as VioletToast;
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

describe("violet-toast", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("defaults to polite status semantics when open", async () => {
    const toast = await renderToast();
    const copy = toast.shadowRoot?.querySelector(".copy");

    expect(copy?.getAttribute("role")).toBe("status");
    expect(copy?.getAttribute("aria-live")).toBe("polite");
  });

  it("keeps the title and body content available", async () => {
    const toast = await renderToast();
    const titleSlot = toast.shadowRoot?.querySelector(
      'slot[name="title"]',
    ) as HTMLSlotElement | null;
    const bodySlot = toast.shadowRoot?.querySelector(
      ".content slot:not([name])",
    ) as HTMLSlotElement | null;
    const titleText = titleSlot
      ?.assignedNodes({ flatten: true })
      .map((node) => node.textContent ?? "")
      .join("")
      .trim();
    const bodyText = bodySlot
      ?.assignedNodes({ flatten: true })
      .map((node) => node.textContent ?? "")
      .join("")
      .trim();

    expect(titleText).toBe("Propagation synced");
    expect(bodyText?.includes("Seed-source defaults")).toBe(true);
  });

  it("closes itself after its timeout by default, keeping its dismiss button", async () => {
    const toast = await renderToast(`<violet-toast open timeout="80">Saved.</violet-toast>`);
    expect(toast.dismissible).toBe(true);
    const reasons: string[] = [];
    toast.addEventListener("dismiss", (event) =>
      reasons.push((event as CustomEvent<{ reason: string }>).detail.reason),
    );

    await new Promise((resolve) => window.setTimeout(resolve, 160));

    expect(toast.open).toBe(false);
    expect(reasons).toEqual(["timeout"]);
  });

  it("stays open with timeout 0", async () => {
    const toast = await renderToast(`<violet-toast open timeout="0">Saved.</violet-toast>`);
    await new Promise((resolve) => window.setTimeout(resolve, 60));
    expect(toast.open).toBe(true);
  });

  it("does not auto-dismiss when actions are present", async () => {
    const toast = await renderToast(`
            <violet-toast open timeout="20">
                Save complete.
                <span slot="actions">Undo</span>
            </violet-toast>
        `);

    await new Promise((resolve) => window.setTimeout(resolve, 60));

    expect(toast.hasAttribute("open")).toBe(true);
  });

  it("dismisses when the dismiss button is clicked", async () => {
    const toast = await renderToast(`<violet-toast open dismissible>Dismiss me.</violet-toast>`);
    const dismissButton = toast.shadowRoot
      ?.querySelector("violet-icon-button")
      ?.shadowRoot?.querySelector("button") as HTMLButtonElement | null;

    dismissButton?.click();
    await nextFrame();

    expect(toast.open).toBe(false);
  });

  if (isChromium)
    describe("under forced colours", () => {
      afterEach(async () => {
        await emulateForcedColors(false);
      });

      it("keeps what it paints opted out and lets slotted content take the system colours", async () => {
        await emulateForcedColors(true);
        const toast = await renderToast(`
                <violet-toast open tone="success" timeout="5000">
                    <span slot="title">Propagation synced</span>
                    <span class="body" style="color: rgb(24, 27, 26)">Seed-source defaults were updated.</span>
                    <a slot="actions" href="#undo" style="color: rgb(24, 27, 26)">Undo</a>
                </violet-toast>
            `);

        expect(matchMedia("(forced-colors: active)").matches).toBe(true);
        // Its card's slots opt slotted content back in; the toast's own layout opts out again.
        const layout = toast.shadowRoot?.querySelector(".layout") as HTMLElement;
        const leading = toast.shadowRoot?.querySelector(".leading") as HTMLElement;
        const dismiss = toast.shadowRoot?.querySelector(".dismiss") as HTMLElement;
        const dismissControl = dismiss.shadowRoot?.querySelector("button") as HTMLElement;
        const dismissIcon = dismiss.querySelector("violet-icon") as HTMLElement;
        const buttonText = systemColor("ButtonText");
        expect(getComputedStyle(layout).forcedColorAdjust).toBe("none");
        expect(getComputedStyle(leading).color).toBe(buttonText);
        expect(getComputedStyle(dismissControl).color).toBe(buttonText);
        expect(getComputedStyle(dismissIcon).color).toBe(buttonText);

        // Its own slots opt what is slotted into it back in, the title included.
        const canvasText = systemColor("CanvasText");
        for (const selector of ['[slot="title"]', ".body"]) {
          const element = toast.querySelector(selector) as HTMLElement;
          expect(getComputedStyle(element).forcedColorAdjust).toBe("auto");
          expect(getComputedStyle(element).color).toBe(canvasText);
        }
        const action = toast.querySelector('[slot="actions"]') as HTMLElement;
        expect(getComputedStyle(action).forcedColorAdjust).toBe("auto");
        expect(getComputedStyle(action).color).toBe(systemColor("LinkText"));
      });
    });
});
