import { afterEach, describe, expect, it, vi } from "vitest";
import { cdp, server, userEvent } from "vitest/browser";

const isChromium = server.browser === "chromium";

import "./violet-icon-button.define";
import type { VioletIconButton } from "./violet-icon-button";

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

async function renderIconButton(
  configure?: (button: VioletIconButton) => void,
): Promise<VioletIconButton> {
  document.body.innerHTML = "";

  const button = document.createElement("violet-icon-button") as VioletIconButton;
  const glyph = document.createElement("span");
  glyph.textContent = "+";
  button.append(glyph);
  configure?.(button);
  document.body.append(button);

  await customElements.whenDefined("violet-icon-button");
  await nextFrame();

  return button;
}

function control(button: VioletIconButton): HTMLButtonElement {
  const native = button.shadowRoot?.querySelector("button");
  if (!native) {
    throw new Error("violet-icon-button did not render its native control");
  }
  return native;
}

describe("violet-icon-button", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders a native button with defaults", async () => {
    const button = await renderIconButton();

    expect(button.appearance).toBe("secondary");
    expect(button.type).toBe("button");
    expect(button.disabled).toBe(false);
    expect(button.label).toBe("");
    expect(control(button).getAttribute("type")).toBe("button");
    expect(control(button).getAttribute("data-appearance")).toBe("secondary");
  });

  it("uses the label as the accessible name and tooltip", async () => {
    const button = await renderIconButton((el) => {
      el.setAttribute("label", "Add item");
    });

    expect(button.label).toBe("Add item");
    expect(control(button).getAttribute("aria-label")).toBe("Add item");
    expect(control(button).getAttribute("title")).toBe("Add item");

    button.label = "Add another item";
    await nextFrame();

    expect(button.getAttribute("label")).toBe("Add another item");
    expect(control(button).getAttribute("aria-label")).toBe("Add another item");
  });

  it("forwards attributes to properties and the native control", async () => {
    const button = await renderIconButton((el) => {
      el.setAttribute("appearance", "quiet");
      el.setAttribute("type", "submit");
      el.setAttribute("disabled", "");
    });

    expect(button.appearance).toBe("quiet");
    expect(button.type).toBe("submit");
    expect(button.disabled).toBe(true);
    expect(control(button).getAttribute("data-appearance")).toBe("quiet");
    expect(control(button).getAttribute("type")).toBe("submit");
    expect(control(button).disabled).toBe(true);
  });

  it("reflects property changes to host attributes and the control", async () => {
    const button = await renderIconButton();

    button.appearance = "primary";
    button.disabled = true;
    await nextFrame();

    expect(button.getAttribute("appearance")).toBe("primary");
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(control(button).getAttribute("data-appearance")).toBe("primary");
    expect(control(button).disabled).toBe(true);

    button.disabled = false;
    await nextFrame();

    expect(button.hasAttribute("disabled")).toBe(false);
    expect(control(button).disabled).toBe(false);
  });

  it.each([
    ["Enter", "{Enter}"],
    ["Space", "{ }"],
  ])("activates with the %s key and emits a click", async (_name, keys) => {
    const button = await renderIconButton((el) => {
      el.label = "Add item";
    });
    let clicks = 0;
    button.addEventListener("click", () => {
      clicks += 1;
    });

    button.focus();
    await userEvent.keyboard(keys);

    expect(clicks).toBe(1);
  });

  it("delegates focus to the inner control", async () => {
    const button = await renderIconButton();

    button.focus();

    expect(document.activeElement).toBe(button);
    expect(button.shadowRoot?.activeElement).toBe(control(button));
  });

  it("does not emit clicks or take focus when disabled", async () => {
    const button = await renderIconButton((el) => {
      el.label = "Add item";
      el.disabled = true;
    });
    let clicks = 0;
    button.addEventListener("click", () => {
      clicks += 1;
    });

    control(button).click();
    button.focus();
    await userEvent.keyboard("{Enter}");

    expect(clicks).toBe(0);
    expect(document.activeElement).not.toBe(button);
  });

  it("projects slotted icon content", async () => {
    const button = await renderIconButton();
    const slot = button.shadowRoot?.querySelector("slot") as HTMLSlotElement;

    expect(slot.assignedElements()).toHaveLength(1);
    expect(slot.assignedElements()[0]?.textContent).toBe("+");
  });

  if (isChromium)
    describe("under forced colours", () => {
      async function emulateForcedColors(active: boolean): Promise<void> {
        const session = cdp() as unknown as {
          send(method: string, params?: object): Promise<unknown>;
        };
        await session.send("Emulation.setEmulatedMedia", {
          features: [
            { name: "forced-colors", value: active ? "active" : "none" },
            { name: "prefers-color-scheme", value: active ? "dark" : "light" },
            { name: "prefers-reduced-motion", value: "no-preference" },
            { name: "prefers-contrast", value: "no-preference" },
          ],
        });
      }

      function systemColor(name: string): string {
        const probe = document.createElement("span");
        probe.style.color = name;
        document.body.append(probe);
        const value = getComputedStyle(probe).color;
        probe.remove();
        return value;
      }

      afterEach(async () => {
        await emulateForcedColors(false);
      });

      it.each(["quiet", "transparent"] as const)(
        "paints %s buttons with ButtonText inside a forced-color-adjust: none region (#1602)",
        async (appearance) => {
          await emulateForcedColors(true);
          document.body.innerHTML = "";
          const surface = document.createElement("div");
          surface.style.forcedColorAdjust = "none";
          surface.style.background = "Canvas";

          const button = document.createElement("violet-icon-button") as VioletIconButton;
          button.appearance = appearance;
          button.label = "Close";
          const glyph = document.createElement("span");
          glyph.textContent = "×";
          button.append(glyph);
          surface.append(button);
          document.body.append(surface);

          await customElements.whenDefined("violet-icon-button");
          await nextFrame();

          const buttonText = systemColor("ButtonText");
          expect(matchMedia("(forced-colors: active)").matches).toBe(true);
          expect(getComputedStyle(control(button)).color).toBe(buttonText);
          expect(getComputedStyle(glyph).color).toBe(buttonText);

          button.disabled = true;

          const grayText = systemColor("GrayText");
          await vi.waitFor(() => {
            expect(getComputedStyle(control(button)).color).toBe(grayText);
          });
          expect(getComputedStyle(control(button)).opacity).toBe("1");
        },
      );
    });
});
