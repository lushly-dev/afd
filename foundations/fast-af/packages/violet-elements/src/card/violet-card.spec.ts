import { afterEach, describe, expect, it } from "vitest";
import { cdp, server } from "vitest/browser";

const isChromium = server.browser === "chromium";

import "./violet-card.define";
import type { VioletCard } from "./violet-card";

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

async function renderCard(
  options: { header?: string; footer?: string; configure?: (card: VioletCard) => void } = {},
): Promise<VioletCard> {
  document.body.innerHTML = "";

  const card = document.createElement("violet-card") as VioletCard;
  const body = document.createElement("p");
  body.textContent = "Body content";
  card.append(body);

  if (options.header) {
    const header = document.createElement("h3");
    header.slot = "header";
    header.textContent = options.header;
    card.append(header);
  }

  if (options.footer) {
    const footer = document.createElement("div");
    footer.slot = "footer";
    footer.textContent = options.footer;
    card.append(footer);
  }

  options.configure?.(card);
  document.body.append(card);

  await customElements.whenDefined("violet-card");
  await nextFrame();

  return card;
}

function section(card: VioletCard, name: "header" | "body" | "footer"): HTMLElement {
  const element = card.shadowRoot?.querySelector(`.${name}`) as HTMLElement | null;
  if (!element) {
    throw new Error(`violet-card did not render its ${name}`);
  }
  return element;
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

describe("violet-card", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("has defaults", async () => {
    const card = await renderCard();

    expect(card.padding).toBe("none");
    expect(card.appearance).toBe("filled");
    expect(card.orientation).toBe("vertical");
    expect(card.interactive).toBe(false);
  });

  it("maps attributes to properties", async () => {
    const card = await renderCard({
      configure: (el) => {
        el.setAttribute("padding", "large");
        el.setAttribute("appearance", "outline");
        el.setAttribute("orientation", "horizontal");
      },
    });

    expect(card.padding).toBe("large");
    expect(card.appearance).toBe("outline");
    expect(card.orientation).toBe("horizontal");
  });

  it("reflects property changes to attributes", async () => {
    const card = await renderCard();

    card.padding = "small";
    card.appearance = "subtle";
    card.orientation = "horizontal";
    await nextFrame();

    expect(card.getAttribute("padding")).toBe("small");
    expect(card.getAttribute("appearance")).toBe("subtle");
    expect(card.getAttribute("orientation")).toBe("horizontal");
  });

  it("projects body content into the default slot", async () => {
    const card = await renderCard();
    const slot = section(card, "body").querySelector("slot") as HTMLSlotElement;

    expect(slot.assignedElements().map((element) => element.textContent)).toEqual(["Body content"]);
  });

  it("hides header and footer when their slots are empty", async () => {
    const card = await renderCard();

    expect(card.hasHeader).toBe(false);
    expect(card.hasFooter).toBe(false);
    expect(section(card, "header").hidden).toBe(true);
    expect(section(card, "footer").hidden).toBe(true);
  });

  it("shows header and footer when slotted content is present", async () => {
    const card = await renderCard({ header: "Title", footer: "Actions" });

    expect(card.hasHeader).toBe(true);
    expect(card.hasFooter).toBe(true);
    expect(section(card, "header").hidden).toBe(false);
    expect(section(card, "footer").hidden).toBe(false);

    const headerSlot = section(card, "header").querySelector("slot") as HTMLSlotElement;
    const footerSlot = section(card, "footer").querySelector("slot") as HTMLSlotElement;
    expect(headerSlot.assignedElements()[0]?.textContent).toBe("Title");
    expect(footerSlot.assignedElements()[0]?.textContent).toBe("Actions");
  });

  it("shows the header after content is slotted in later", async () => {
    const card = await renderCard();

    const header = document.createElement("h3");
    header.slot = "header";
    header.textContent = "Late title";
    card.append(header);
    await nextFrame();
    await nextFrame();

    expect(card.hasHeader).toBe(true);
    expect(section(card, "header").hidden).toBe(false);
  });

  describe("interactive mode", () => {
    it("is not focusable or a group by default", async () => {
      const card = await renderCard();

      expect(card.hasAttribute("tabindex")).toBe(false);
      expect(card.hasAttribute("role")).toBe(false);
    });

    it("adds tabindex and role=group when interactive", async () => {
      const card = await renderCard({
        configure: (el) => {
          el.setAttribute("interactive", "");
        },
      });

      expect(card.interactive).toBe(true);
      expect(card.getAttribute("tabindex")).toBe("0");
      expect(card.getAttribute("role")).toBe("group");
    });

    it("adds and removes the semantics when interactive is toggled", async () => {
      const card = await renderCard();

      card.interactive = true;
      await nextFrame();
      expect(card.getAttribute("tabindex")).toBe("0");
      expect(card.getAttribute("role")).toBe("group");

      card.interactive = false;
      await nextFrame();
      expect(card.hasAttribute("tabindex")).toBe(false);
      expect(card.hasAttribute("role")).toBe(false);
    });

    it("preserves author-provided tabindex and role", async () => {
      const card = await renderCard({
        configure: (el) => {
          el.setAttribute("tabindex", "-1");
          el.setAttribute("role", "article");
          el.setAttribute("interactive", "");
        },
      });

      expect(card.getAttribute("tabindex")).toBe("-1");
      expect(card.getAttribute("role")).toBe("article");

      card.interactive = false;
      await nextFrame();

      expect(card.getAttribute("tabindex")).toBe("-1");
      expect(card.getAttribute("role")).toBe("article");
    });
  });

  if (isChromium)
    describe("under forced colours", () => {
      afterEach(async () => {
        await emulateForcedColors(false);
      });

      it("lets slotted content take the system colours while the frame keeps its own", async () => {
        await emulateForcedColors(true);
        const card = await renderCard({ header: "Header", footer: "Footer" });
        // Content styled by a theme, as an app's stylesheet would style it.
        for (const child of Array.from(card.children) as HTMLElement[]) {
          child.style.color = "rgb(24, 27, 26)";
        }
        await nextFrame();

        const canvasText = systemColor("CanvasText");
        expect(matchMedia("(forced-colors: active)").matches).toBe(true);
        expect(canvasText).not.toBe("rgb(24, 27, 26)");
        for (const child of Array.from(card.children)) {
          expect(getComputedStyle(child).forcedColorAdjust).toBe("auto");
          expect(getComputedStyle(child).color).toBe(canvasText);
        }

        const root = card.shadowRoot?.querySelector(".root") as HTMLElement;
        expect(getComputedStyle(root).forcedColorAdjust).toBe("none");
        expect(getComputedStyle(root).backgroundColor).toBe(systemColor("Canvas"));
      });
    });
});
