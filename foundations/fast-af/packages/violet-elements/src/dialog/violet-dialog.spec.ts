import { afterEach, describe, expect, it } from "vitest";
import { cdp, server, userEvent } from "vitest/browser";

const isChromium = server.browser === "chromium";

import "./violet-dialog.define";
import { registerSystemSearchIcon } from "../icon/generated/icons/system-search";
import { resolveVioletIcon } from "../icon/icon-registry";
import type { VioletIcon } from "../icon/violet-icon";
import { VioletDialog } from "./violet-dialog";

registerSystemSearchIcon();

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

async function waitFor(condition: () => boolean, attempts = 60): Promise<void> {
  for (let index = 0; index < attempts; index += 1) {
    if (condition()) {
      return;
    }
    await nextFrame();
  }
  throw new Error("Timed out waiting for condition");
}

async function renderDialog(configure?: (dialog: VioletDialog) => void): Promise<VioletDialog> {
  document.body.innerHTML = "";

  const dialog = document.createElement("violet-dialog") as VioletDialog;
  const title = document.createElement("span");
  title.slot = "title";
  title.textContent = "Confirm";
  const body = document.createElement("p");
  body.textContent = "Are you sure?";
  const footer = document.createElement("button");
  footer.slot = "footer";
  footer.textContent = "OK";
  dialog.append(title, body, footer);
  configure?.(dialog);
  document.body.append(dialog);

  await customElements.whenDefined("violet-dialog");
  await nextFrame();

  return dialog;
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

async function expectCloseGlyph(button: Element | null | undefined): Promise<void> {
  const icon = button?.querySelector("violet-icon") as VioletIcon | null | undefined;
  expect(icon).toBeTruthy();
  expect(icon?.icon).toBe("system/close");

  const closeSvg = resolveVioletIcon("system/close")?.svg ?? "";
  const searchSvg = resolveVioletIcon("system/search")?.svg ?? "";
  expect(closeSvg).not.toBe("");
  expect(searchSvg).not.toBe("");

  await nextFrame();
  const rendered = icon?.shadowRoot?.querySelector(".glyph svg");
  const expected = new DOMParser().parseFromString(closeSvg, "image/svg+xml").documentElement;
  expect(rendered).not.toBeNull();
  const paths = (root: Element | null | undefined) =>
    Array.from(root?.querySelectorAll("path") ?? []).map((path) => path.getAttribute("d"));
  expect(paths(rendered)).toEqual(paths(expected));
  expect(paths(rendered).length).toBeGreaterThan(0);
  expect(rendered?.querySelector("circle")).toBeNull();
}

function nativeDialog(dialog: VioletDialog): HTMLDialogElement {
  const native = dialog.shadowRoot?.querySelector("dialog");
  if (!native) {
    throw new Error("violet-dialog did not render its native dialog");
  }
  return native;
}

describe("violet-dialog", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders the close glyph through the icon attribute with search also registered", async () => {
    const dialog = await renderDialog();

    await expectCloseGlyph(dialog.shadowRoot?.querySelector('[part="close-button"]'));
  });

  it("is closed by default with modal type", async () => {
    const dialog = await renderDialog();

    expect(dialog.open).toBe(false);
    expect(dialog.type).toBe("modal");
    expect(dialog.padding).toBe("medium");
    expect(nativeDialog(dialog).open).toBe(false);
  });

  it("never transforms the dialog, so fixed descendants keep viewport coordinates", async () => {
    const dialog = await renderDialog((el) => {
      const popup = document.createElement("div");
      popup.id = "popup";
      popup.style.cssText =
        "position:fixed;inset-block-start:10px;inset-inline-start:10px;inline-size:20px;block-size:20px";
      el.append(popup);
    });
    const popup = dialog.querySelector("#popup") as HTMLElement;

    dialog.show();
    // Sample while the opacity fade is still running as well as after it settles.
    for (let frame = 0; frame < 3; frame += 1) {
      expect(getComputedStyle(nativeDialog(dialog)).transform).toBe("none");
      const rect = popup.getBoundingClientRect();
      expect(rect.top).toBe(10);
      expect(rect.left).toBe(10);
      await nextFrame();
    }
    await waitFor(() => getComputedStyle(nativeDialog(dialog)).opacity === "1");
    expect(getComputedStyle(nativeDialog(dialog)).transform).toBe("none");
    expect(popup.getBoundingClientRect().top).toBe(10);

    dialog.hide();
    expect(getComputedStyle(nativeDialog(dialog)).transform).toBe("none");
  });

  it("opens as a modal dialog via show() and reflects the open attribute", async () => {
    const dialog = await renderDialog();

    dialog.show();
    await nextFrame();

    expect(dialog.open).toBe(true);
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(nativeDialog(dialog).open).toBe(true);
    expect(nativeDialog(dialog).matches(":modal")).toBe(true);
  });

  it("opens when the open attribute is set before connection", async () => {
    const dialog = await renderDialog((el) => {
      el.setAttribute("open", "");
    });

    expect(nativeDialog(dialog).open).toBe(true);
    expect(nativeDialog(dialog).matches(":modal")).toBe(true);
  });

  it("renders immediately at full opacity when open at mount so contrast checks never see a fade-in (#1171)", async () => {
    document.body.innerHTML = "";
    const dialog = document.createElement("violet-dialog") as VioletDialog;
    dialog.setAttribute("open", "");
    const title = document.createElement("span");
    title.slot = "title";
    title.textContent = "Delete project?";
    const body = document.createElement("p");
    body.textContent = "This removes the project and its files.";
    dialog.append(title, body);
    document.body.append(dialog);

    await customElements.whenDefined("violet-dialog");
    // Check opacity immediately on frame 0 and across the first three animation frames.
    for (let frame = 0; frame < 4; frame += 1) {
      expect(getComputedStyle(nativeDialog(dialog)).opacity, `frame ${frame}`).toBe("1");
      await nextFrame();
    }
    // After the initial paint settles, data-initial-open is cleared so closing can still transition.
    expect(nativeDialog(dialog).hasAttribute("data-initial-open")).toBe(false);
    dialog.hide();
  });

  it("opens when the open property is toggled after connection", async () => {
    const dialog = await renderDialog();

    dialog.open = true;
    await nextFrame();
    expect(nativeDialog(dialog).open).toBe(true);

    dialog.open = false;
    await waitFor(() => !nativeDialog(dialog).open);
    await nextFrame();
    expect(dialog.hasAttribute("open")).toBe(false);
  });

  it("opens non-modally when type is non-modal", async () => {
    const dialog = await renderDialog((el) => {
      el.type = "non-modal";
    });

    dialog.show();
    await nextFrame();

    expect(nativeDialog(dialog).open).toBe(true);
    expect(nativeDialog(dialog).matches(":modal")).toBe(false);
  });

  it("exposes the alertdialog role for the alert type only", async () => {
    const alert = await renderDialog((el) => {
      el.type = "alert";
    });

    alert.show();
    await nextFrame();

    expect(nativeDialog(alert).getAttribute("role")).toBe("alertdialog");

    const modal = await renderDialog();
    modal.show();
    await nextFrame();

    expect(nativeDialog(modal).hasAttribute("role")).toBe(false);
  });

  it("gives the dialog an accessible name when there is no title", async () => {
    document.body.innerHTML = "";
    const dialog = document.createElement("violet-dialog") as VioletDialog;
    document.body.append(dialog);
    await customElements.whenDefined("violet-dialog");
    await nextFrame();

    expect(nativeDialog(dialog).getAttribute("aria-label")).toBe("Dialog");
    expect(nativeDialog(dialog).hasAttribute("aria-labelledby")).toBe(false);
  });

  it("labels the dialog by its title slot once a title is slotted", async () => {
    const dialog = await renderDialog();
    await nextFrame();

    expect(dialog.hasTitle).toBe(true);
    expect(nativeDialog(dialog).getAttribute("aria-labelledby")).toBe(dialog.titleId);
    expect(nativeDialog(dialog).hasAttribute("aria-label")).toBe(false);
  });

  it("emits open-change with the open detail after opening", async () => {
    const dialog = await renderDialog();
    const details: Array<{ open: boolean }> = [];
    dialog.addEventListener("open-change", (event) => {
      details.push((event as CustomEvent<{ open: boolean }>).detail);
    });

    dialog.show();
    await nextFrame();

    expect(details).toEqual([{ open: true }]);
  });

  it("emits open-change with open false after hide()", async () => {
    const dialog = await renderDialog();
    dialog.show();
    await nextFrame();

    const details: Array<{ open: boolean }> = [];
    dialog.addEventListener("open-change", (event) => {
      details.push((event as CustomEvent<{ open: boolean }>).detail);
    });

    dialog.hide();
    await waitFor(() => details.length > 0);

    expect(details).toEqual([{ open: false }]);
    expect(dialog.open).toBe(false);
    expect(nativeDialog(dialog).open).toBe(false);
  });

  it("passes a return value through hide()", async () => {
    const dialog = await renderDialog();
    dialog.show();
    await nextFrame();

    dialog.hide("confirmed");
    await waitFor(() => !nativeDialog(dialog).open);

    expect(dialog.returnValue).toBe("confirmed");
  });

  it("closes with Escape and emits request-close with a keyboard source", async () => {
    const dialog = await renderDialog();
    const sources: string[] = [];
    dialog.addEventListener("request-close", (event) => {
      sources.push((event as CustomEvent<{ source: string }>).detail.source);
    });
    dialog.show();
    await nextFrame();

    await userEvent.keyboard("{Escape}");
    await waitFor(() => !nativeDialog(dialog).open);

    expect(sources).toEqual(["keyboard"]);
    expect(dialog.open).toBe(false);
  });

  it("stays open when request-close is canceled", async () => {
    const dialog = await renderDialog();
    dialog.addEventListener("request-close", (event) => event.preventDefault());
    dialog.show();
    await nextFrame();

    await userEvent.keyboard("{Escape}");
    await nextFrame();
    await nextFrame();

    expect(dialog.open).toBe(true);
    expect(nativeDialog(dialog).open).toBe(true);
  });

  it.each(["modal", "alert", "non-modal"] as const)(
    "fires cancelable request-close with keyboard source on Escape for type=%s (#1581)",
    async (type) => {
      const dialog = await renderDialog((el) => {
        el.type = type;
      });
      const sources: string[] = [];
      let cancelClose = true;
      dialog.addEventListener("request-close", (event) => {
        sources.push((event as CustomEvent<{ source: string }>).detail.source);
        if (cancelClose) {
          event.preventDefault();
        }
      });
      dialog.show();
      await nextFrame();

      await userEvent.keyboard("{Escape}");
      await nextFrame();
      await nextFrame();

      expect(sources).toEqual(["keyboard"]);
      expect(dialog.open).toBe(true);
      expect(nativeDialog(dialog).open).toBe(true);

      cancelClose = false;
      await userEvent.keyboard("{Escape}");
      await waitFor(() => !nativeDialog(dialog).open);

      expect(sources).toEqual(["keyboard", "keyboard"]);
      expect(dialog.open).toBe(false);
    },
  );

  it("closes from the close button and reports the close-button source", async () => {
    const dialog = await renderDialog();
    const sources: string[] = [];
    dialog.addEventListener("request-close", (event) => {
      sources.push((event as CustomEvent<{ source: string }>).detail.source);
    });
    dialog.show();
    await nextFrame();

    const closeButton = dialog.shadowRoot?.querySelector(".close-button") as HTMLElement;
    // The accessible name belongs on the inner <button>, via violet-icon-button's label.
    expect(closeButton.getAttribute("label")).toBe("Close");
    expect(closeButton.hasAttribute("aria-label")).toBe(false);
    await waitFor(
      () => closeButton.shadowRoot?.querySelector("button")?.getAttribute("aria-label") === "Close",
    );
    closeButton.click();
    await waitFor(() => !nativeDialog(dialog).open);

    expect(sources).toEqual(["close-button"]);
    expect(dialog.open).toBe(false);
  });

  it("hides the close button when no-close-button is set", async () => {
    const dialog = await renderDialog((el) => {
      el.setAttribute("no-close-button", "");
    });
    const closeButton = dialog.shadowRoot?.querySelector(".close-button") as HTMLElement;

    expect(dialog.noCloseButton).toBe(true);
    expect(closeButton.hasAttribute("hidden")).toBe(true);
  });

  it("projects title, body and footer slots", async () => {
    const dialog = await renderDialog();
    const root = dialog.shadowRoot as ShadowRoot;
    const titleSlot = root.querySelector('slot[name="title"]') as HTMLSlotElement;
    const bodySlot = root.querySelector("slot:not([name])") as HTMLSlotElement;
    const footerSlot = root.querySelector('slot[name="footer"]') as HTMLSlotElement;

    expect(titleSlot.assignedElements()[0]?.textContent).toBe("Confirm");
    expect(bodySlot.assignedElements()[0]?.textContent).toBe("Are you sure?");
    expect(footerSlot.assignedElements()[0]?.textContent).toBe("OK");
  });

  it("restores focus to the previously focused element after closing", async () => {
    document.body.innerHTML = "";
    const trigger = document.createElement("button");
    trigger.textContent = "Open";
    document.body.append(trigger);
    trigger.focus();

    const dialog = document.createElement("violet-dialog") as VioletDialog;
    document.body.append(dialog);
    await customElements.whenDefined("violet-dialog");
    await nextFrame();

    dialog.show();
    await nextFrame();
    expect(document.activeElement).not.toBe(trigger);

    dialog.hide();
    await waitFor(() => !nativeDialog(dialog).open);
    await nextFrame();

    expect(document.activeElement).toBe(trigger);
  });

  if (isChromium)
    describe("under forced colours", () => {
      afterEach(async () => {
        await emulateForcedColors(false);
      });

      it("lets slotted content take the system colours while the surface keeps its own", async () => {
        await emulateForcedColors(true);
        const dialog = await renderDialog((el) => {
          // Content styled by a theme, as an app's stylesheet would style it.
          for (const child of Array.from(el.children) as HTMLElement[]) {
            child.style.color = "rgb(24, 27, 26)";
          }
        });
        dialog.show();
        await waitFor(() => nativeDialog(dialog).open);

        const canvasText = systemColor("CanvasText");
        expect(matchMedia("(forced-colors: active)").matches).toBe(true);
        for (const selector of ['[slot="title"]', "p"]) {
          const element = dialog.querySelector(selector) as HTMLElement;
          expect(getComputedStyle(element).forcedColorAdjust).toBe("auto");
          expect(getComputedStyle(element).color).toBe(canvasText);
        }
        const footer = dialog.querySelector('[slot="footer"]') as HTMLElement;
        expect(getComputedStyle(footer).forcedColorAdjust).toBe("auto");
        expect(getComputedStyle(footer).color).toBe(systemColor("ButtonText"));

        const surface = nativeDialog(dialog);
        expect(getComputedStyle(surface).forcedColorAdjust).toBe("none");
        expect(getComputedStyle(surface).backgroundColor).toBe(systemColor("Canvas"));

        const closeButton = dialog.shadowRoot?.querySelector(".close-button") as HTMLElement;
        const closeControl = closeButton.shadowRoot?.querySelector("button") as HTMLElement;
        const closeIcon = closeButton.querySelector("violet-icon") as HTMLElement;
        expect(getComputedStyle(closeControl).color).toBe(systemColor("ButtonText"));
        expect(getComputedStyle(closeIcon).color).toBe(systemColor("ButtonText"));
        dialog.hide();
      });
    });
});
