import { afterEach, describe, expect, it, vi } from "vitest";

import "../button/violet-button.define";
import "../calendar/violet-calendar.define";
import "../card/violet-card.define";
import "../conversation/violet-tool-result-card.define";
import "../data-grid/violet-data-grid.define";
import "../data-grid/violet-data-grid-attachment-cell.define";
import "../data-grid/violet-data-grid-multi-picker.define";
import "../data-grid/violet-data-grid-persona-picker.define";
import "../data-grid/violet-data-grid-pill-select.define";
import "../data-grid/violet-data-grid-rating.define";
import "../data-grid/violet-data-grid-reference-picker.define";
import "../dialog/violet-dialog.define";
import "../select/violet-select.define";
import "../text/violet-text.define";
import "../text-field/violet-text-field.define";
import "./violet-theme.define";
import { loadVioletBuiltInTheme } from "./violet-theme-runtime";

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function parseRgba(color: string): [number, number, number, number] {
  const match = color.match(/[\d.]+/g) ?? [];
  return [
    Number(match[0] ?? 0),
    Number(match[1] ?? 0),
    Number(match[2] ?? 0),
    match[3] === undefined ? 1 : Number(match[3]),
  ];
}

function compositeOver(
  fg: [number, number, number, number],
  bg: readonly [number, number, number, ...number[]],
): [number, number, number] {
  const a = fg[3];
  return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a)];
}

function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const luminance = (rgb: [number, number, number]): number => {
    const [r, g, bl] = rgb.map((channel) => {
      const c = channel / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return r! * 0.2126 + g! * 0.7152 + bl! * 0.0722;
  };
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function resolveColor(value: string, parent: HTMLElement): [number, number, number, number] {
  const probe = document.createElement("span");
  probe.style.color = value;
  parent.append(probe);
  const parsed = parseRgba(getComputedStyle(probe).color);
  probe.remove();
  return parsed;
}

describe("violet-token-defaults", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    document.body.style.fontFamily = "";
    document.documentElement.style.removeProperty("--violet-font-family-body");
    document.documentElement.style.removeProperty("--violet-font-family-heading");
    document.documentElement.style.removeProperty("--violet-font-family");
    document.adoptedStyleSheets = [];
  });

  it("inherits the host font family when no Violet theme or override is set (#512)", async () => {
    const host = document.createElement("div");
    host.style.fontFamily = "Georgia, serif";
    host.innerHTML = `
            <violet-button>Save</violet-button>
            <violet-text-field label="Name"></violet-text-field>
            <violet-card>Card</violet-card>
            <violet-text variant="title-sm">Heading</violet-text>
            <violet-calendar></violet-calendar>
            <violet-tool-result-card></violet-tool-result-card>
            <violet-data-grid></violet-data-grid>
            <violet-data-grid-pill-select></violet-data-grid-pill-select>
            <violet-data-grid-rating></violet-data-grid-rating>
            <violet-data-grid-reference-picker></violet-data-grid-reference-picker>
            <violet-data-grid-attachment-cell></violet-data-grid-attachment-cell>
            <violet-data-grid-multi-picker></violet-data-grid-multi-picker>
            <violet-data-grid-persona-picker></violet-data-grid-persona-picker>
            <violet-dialog><span slot="title">Title</span>Body</violet-dialog>
        `;
    document.body.append(host);
    const tags = [
      "violet-button",
      "violet-text-field",
      "violet-card",
      "violet-text",
      "violet-calendar",
      "violet-tool-result-card",
      "violet-data-grid",
      "violet-data-grid-pill-select",
      "violet-data-grid-rating",
      "violet-data-grid-reference-picker",
      "violet-data-grid-attachment-cell",
      "violet-data-grid-multi-picker",
      "violet-data-grid-persona-picker",
      "violet-dialog",
    ];
    await Promise.all(tags.map((tag) => customElements.whenDefined(tag)));
    await nextFrame();

    for (const tag of tags) {
      const element = host.querySelector(tag) as HTMLElement;
      expect(getComputedStyle(element).fontFamily, tag).toContain("Georgia");
    }

    const headingRoot = host
      .querySelector("violet-text")
      ?.shadowRoot?.querySelector(".root") as HTMLElement;
    expect(getComputedStyle(headingRoot).fontFamily).toContain("Georgia");

    const dialogTitle = host
      .querySelector("violet-dialog")
      ?.shadowRoot?.querySelector(".title") as HTMLElement;
    expect(getComputedStyle(dialogTitle).fontFamily).toContain("Georgia");

    const calendarNav = host
      .querySelector("violet-calendar")
      ?.shadowRoot?.querySelector(".nav") as HTMLElement;
    expect(getComputedStyle(calendarNav).fontFamily).toContain("Georgia");

    const toolSummary = host
      .querySelector("violet-tool-result-card")
      ?.shadowRoot?.querySelector(".summary") as HTMLElement;
    expect(getComputedStyle(toolSummary).fontFamily).toContain("Georgia");
  });

  it("honors --violet-font-family-body, --violet-font-family, and --violet-data-grid-font-family in precedence order (#512)", async () => {
    const host = document.createElement("div");
    host.style.fontFamily = "Times, serif";
    host.style.setProperty("--violet-font-family-body", "Arial, sans-serif");
    host.innerHTML = `<violet-button>Save</violet-button><violet-data-grid></violet-data-grid>`;
    document.body.append(host);
    await Promise.all([
      customElements.whenDefined("violet-button"),
      customElements.whenDefined("violet-data-grid"),
    ]);
    await nextFrame();

    const button = host.querySelector("violet-button") as HTMLElement;
    const grid = host.querySelector("violet-data-grid") as HTMLElement;

    // --violet-font-family-body alone overrides the inherited host font.
    expect(getComputedStyle(button).fontFamily).toContain("Arial");
    expect(getComputedStyle(grid).fontFamily).toContain("Arial");

    // --violet-font-family overrides --violet-font-family-body.
    host.style.setProperty("--violet-font-family", "Georgia, serif");
    await nextFrame();
    expect(getComputedStyle(button).fontFamily).toContain("Georgia");
    expect(getComputedStyle(grid).fontFamily).toContain("Georgia");

    // --violet-data-grid-font-family overrides --violet-font-family on the grid.
    host.style.setProperty("--violet-data-grid-font-family", "Courier, monospace");
    await nextFrame();
    expect(getComputedStyle(grid).fontFamily).toContain("Courier");
  });

  it.each(["unthemed", "light", "dark"] as const)(
    "keeps resting field border at >= 3:1 contrast against the field background in %s (#512)",
    async (mode) => {
      let root: HTMLElement = document.body;
      if (mode !== "unthemed") {
        await loadVioletBuiltInTheme();
        await customElements.whenDefined("violet-theme");
        const theme = document.createElement("violet-theme");
        theme.setAttribute("preset", mode);
        document.body.append(theme);
        await vi.waitFor(() => {
          expect(
            getComputedStyle(theme).getPropertyValue("--violet-color-field-background").trim(),
          ).not.toBe("");
        });
        root = theme;
      }

      root.innerHTML = `
                <violet-text-field label="Name"></violet-text-field>
                <violet-select label="Kind"><violet-option value="a">A</violet-option></violet-select>
            `;
      await Promise.all([
        customElements.whenDefined("violet-text-field"),
        customElements.whenDefined("violet-select"),
      ]);
      await nextFrame();

      for (const selector of ["violet-text-field", "violet-select"] as const) {
        const field = root.querySelector(selector) as HTMLElement;
        const style = getComputedStyle(field);
        const page = resolveColor(
          style.getPropertyValue("--_surface-page").trim() || "#f4f0ea",
          root,
        );
        const bg = compositeOver(
          resolveColor(style.getPropertyValue("--_field-background").trim(), root),
          page,
        );
        const border = compositeOver(
          resolveColor(style.getPropertyValue("--_field-border").trim(), root),
          bg,
        );
        expect(contrastRatio(border, bg), `${mode} ${selector}`).toBeGreaterThanOrEqual(3);
      }
    },
  );
});
