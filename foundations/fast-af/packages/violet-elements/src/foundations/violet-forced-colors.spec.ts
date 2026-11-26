import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cdp, server, userEvent } from "vitest/browser";

import "../data-grid/violet-data-grid.define";
import "../select/violet-select.define";
import "../option/violet-option.define";
import "../slider/violet-slider.define";
import "../slider/violet-range-slider.define";
import "../switch/violet-switch.define";
import type { VioletDataGrid } from "../data-grid/violet-data-grid";

// Forced colours are emulated through the DevTools protocol, which only Chromium offers here.
const isChromium = server.browser === "chromium";

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * Emulates a forced-colours theme, or restores the media Playwright emulates by default, so later
 * spec files on the page do not inherit it.
 */
async function emulateForcedColors(active: boolean): Promise<void> {
  const session = cdp() as unknown as { send(method: string, params?: object): Promise<unknown> };
  await session.send("Emulation.setEmulatedMedia", {
    features: [
      { name: "forced-colors", value: active ? "active" : "none" },
      { name: "prefers-color-scheme", value: active ? "dark" : "light" },
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

function shadowPart(host: Element, selector: string): HTMLElement {
  const element = host.shadowRoot?.querySelector<HTMLElement>(selector);
  if (!element) {
    throw new Error(`Expected ${selector} in ${host.localName}.`);
  }
  return element;
}

async function renderGrid(): Promise<VioletDataGrid> {
  const grid = document.createElement("violet-data-grid") as VioletDataGrid;
  const target = grid as unknown as Record<string, unknown>;
  target.columns = [
    { id: "name", label: "Name", width: "160px" },
    { id: "status", label: "Status", width: "160px" },
  ];
  target.rows = [
    { id: "a", data: { name: "Alder", status: "Seedling" } },
    { id: "b", data: { name: "Birch", status: "Sapling" } },
    { id: "c", data: { name: "Cedar", status: "Mature" } },
  ];
  target.focusMode = "cell";
  target.virtualize = false;
  document.body.append(grid);
  await customElements.whenDefined("violet-data-grid");
  await nextFrame();
  await nextFrame();
  return grid;
}

function cellAt(grid: VioletDataGrid, row: number, column: number): HTMLElement {
  // Body rows only, skipping the virtual spacer rows and each row's selection cell.
  const rows = grid.shadowRoot?.querySelectorAll<HTMLTableRowElement>('tbody tr[part="row"]') ?? [];
  const cell = rows[row]?.querySelectorAll<HTMLElement>("td:not(.selection-cell)")[column];
  if (!cell) {
    throw new Error(`Expected a cell at ${row}, ${column}.`);
  }
  return cell;
}

describe.runIf(isChromium)("violet-elements under forced colours", () => {
  beforeEach(async () => {
    await emulateForcedColors(true);
  });

  afterEach(async () => {
    document.body.innerHTML = "";
    await emulateForcedColors(false);
  });

  it("draws the data grid's selection, active cell and focus with system colours", async () => {
    expect(matchMedia("(forced-colors: active)").matches).toBe(true);
    const grid = await renderGrid();
    const highlight = systemColor("Highlight");

    await userEvent.click(cellAt(grid, 0, 0));
    await userEvent.keyboard("{Shift>}{ArrowRight}{ArrowDown}{/Shift}");
    await nextFrame();

    // The range covers the top-left four cells; the active, focused cell is its far corner.
    const selected = cellAt(grid, 0, 0);
    const active = cellAt(grid, 1, 1);
    expect(selected.dataset.selected).toBe("true");
    expect(active.dataset.active).toBe("true");
    expect(grid.shadowRoot?.activeElement).toBe(active);

    expect(getComputedStyle(selected).backgroundColor).toBe(highlight);
    expect(getComputedStyle(selected).color).toBe(systemColor("HighlightText"));
    // The text opts out of the Canvas backplate forced colours paint behind text, which would hide it.
    const selectedText = selected.querySelector(".cell-content") as HTMLElement;
    expect(getComputedStyle(selectedText).forcedColorAdjust).toBe("none");
    expect(getComputedStyle(selectedText).color).toBe(systemColor("HighlightText"));
    expect(
      getComputedStyle(active.querySelector(".cell-content") as HTMLElement).forcedColorAdjust,
    ).toBe("auto");
    expect(getComputedStyle(cellAt(grid, 2, 0)).backgroundColor).not.toBe(highlight);

    // The active cell stays Canvas inside a Highlight ring, so it reads apart from the range.
    expect(getComputedStyle(active).backgroundColor).toBe(systemColor("Canvas"));
    expect(getComputedStyle(active, "::after").borderTopColor).toBe(highlight);
    expect(getComputedStyle(active).outlineStyle).toBe("solid");
    expect(getComputedStyle(active).outlineColor).toBe(highlight);
  });

  it("draws selected data grid rows with Highlight", async () => {
    const grid = await renderGrid();
    const target = grid as unknown as Record<string, unknown>;
    target.selectionMode = "multiple";
    target.selectedRowIds = ["b"];
    await nextFrame();

    const nameCell = cellAt(grid, 1, 0);
    expect(nameCell.closest("tr")?.dataset.selected).toBe("true");
    expect(getComputedStyle(nameCell).backgroundColor).toBe(systemColor("Highlight"));
    expect(getComputedStyle(cellAt(grid, 0, 0)).backgroundColor).not.toBe(systemColor("Highlight"));
    // The checkbox column stays Canvas, so a checked box keeps its Highlight edge.
    const selectionCell = nameCell.closest("tr")?.querySelector(".selection-cell") as HTMLElement;
    expect(getComputedStyle(selectionCell).backgroundColor).toBe(systemColor("Canvas"));
  });

  it("keeps the select trigger on Canvas with a ButtonText edge and a Highlight focus edge", async () => {
    document.body.innerHTML = `
            <violet-select label="Bed">
                <violet-option value="north">North</violet-option>
                <violet-option value="south">South</violet-option>
            </violet-select>
        `;
    await customElements.whenDefined("violet-select");
    await nextFrame();
    const select = document.querySelector("violet-select") as HTMLElement;
    const trigger = shadowPart(select, ".trigger");

    expect(getComputedStyle(trigger).backgroundColor).toBe(systemColor("Canvas"));
    expect(getComputedStyle(trigger).borderTopColor).toBe(systemColor("ButtonText"));

    await userEvent.tab();
    // The edge eases between colours, so wait for it to settle.
    const highlight = systemColor("Highlight");
    await vi.waitFor(() => expect(getComputedStyle(trigger).borderTopColor).toBe(highlight));
  });

  it("draws the slider and range slider fills with Highlight and outlines their thumbs", async () => {
    document.body.innerHTML = `
            <violet-slider label="Moisture" value="40"></violet-slider>
            <violet-range-slider label="Band" value-start="20" value-end="70"></violet-range-slider>
        `;
    await customElements.whenDefined("violet-slider");
    await customElements.whenDefined("violet-range-slider");
    await nextFrame();
    const highlight = systemColor("Highlight");

    for (const host of document.querySelectorAll("violet-slider, violet-range-slider")) {
      expect(getComputedStyle(shadowPart(host, ".fill")).backgroundColor).toBe(highlight);
      expect(getComputedStyle(shadowPart(host, ".thumb")).borderTopColor).toBe(highlight);
    }
  });

  it("draws a checked switch's track with Highlight and an unchecked one on Canvas", async () => {
    document.body.innerHTML = `
            <violet-switch label="Irrigation" checked></violet-switch>
            <violet-switch label="Frost alerts"></violet-switch>
        `;
    await customElements.whenDefined("violet-switch");
    await nextFrame();
    const [on, off] = document.querySelectorAll("violet-switch");

    expect(getComputedStyle(shadowPart(on as Element, ".track")).backgroundColor).toBe(
      systemColor("Highlight"),
    );
    expect(getComputedStyle(shadowPart(off as Element, ".track")).backgroundColor).toBe(
      systemColor("Canvas"),
    );
    expect(getComputedStyle(shadowPart(off as Element, ".track")).borderTopColor).toBe(
      systemColor("ButtonText"),
    );
  });
});
