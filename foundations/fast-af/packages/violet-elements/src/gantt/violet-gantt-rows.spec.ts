import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";

import "./violet-gantt";
import type {
  VioletGantt,
  VioletGanttItem,
  VioletGanttRow,
} from "./violet-gantt";

function settle(count = 3): Promise<void> {
  return new Promise((resolve) => {
    const advance = (remaining: number) =>
      requestAnimationFrame(() =>
        remaining <= 1 ? resolve() : advance(remaining - 1)
      );
    advance(count);
  });
}

function item(
  id: string,
  rowId: string,
  start = "2028-03-01"
): VioletGanttItem {
  return {
    id,
    rowId,
    label: id,
    time: { kind: "day-range", start, endExclusive: "2028-03-04" },
    presentation: "work",
    provenance: "planned",
  };
}

async function mount(
  rows: readonly VioletGanttRow[],
  items: readonly VioletGanttItem[],
  overrides: Partial<VioletGantt> = {}
): Promise<VioletGantt> {
  const element = document.createElement("violet-gantt") as VioletGantt;
  element.style.cssText = "display:block;width:760px;height:220px";
  element.rows = rows;
  element.items = items;
  element.expandedRowIds = [];
  element.density = "compact";
  element.viewport = {
    start: "2028-03-01",
    endExclusive: "2028-03-11",
    scale: "day",
  };
  Object.assign(element, overrides);
  document.body.append(element);
  await customElements.whenDefined("violet-gantt");
  await settle();
  return element;
}

function renderedRow(element: VioletGantt, rowId: string): HTMLElement {
  const row = element.shadowRoot?.querySelector<HTMLElement>(
    `.row[data-row-id="${rowId}"]`
  );
  if (!row) throw new Error(`Expected ${rowId} to be mounted.`);
  return row;
}

function press(row: HTMLElement, key: string): void {
  row.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, composed: true })
  );
}

describe("violet-gantt adaptive row layout", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("keeps compact single-item rows at 36px and grows three-lane rows to 84px", async () => {
    const items = [
      item("single", "single"),
      item("stack-1", "stacked"),
      item("stack-2", "stacked"),
      item("stack-3", "stacked"),
    ];
    const element = await mount(
      [
        { id: "single", label: "Single", itemIds: ["single"] },
        {
          id: "stacked",
          label: "Stacked",
          itemIds: ["stack-1", "stack-2", "stack-3"],
        },
      ],
      items
    );
    const single = renderedRow(element, "single");
    const stacked = renderedRow(element, "stacked");
    const singleHeader = single.querySelector<HTMLElement>(".row-header")!;
    const singleChart = single.querySelector<HTMLElement>(".chart")!;
    const mark = single.querySelector<HTMLElement>(".item")!;

    expect(single.style.getPropertyValue("--_row-height")).toBe("36px");
    expect(stacked.style.getPropertyValue("--_row-height")).toBe("84px");
    expect(stacked.style.getPropertyValue("--_row-top")).toBe("36px");
    expect(
      element.shadowRoot
        ?.querySelector<HTMLElement>(".body")
        ?.style.getPropertyValue("--_gantt-body-height")
    ).toBe("120px");
    expect(singleHeader.getBoundingClientRect().height).toBeCloseTo(
      singleChart.getBoundingClientRect().height,
      0
    );
    expect(
      Math.abs(
        mark.getBoundingClientRect().top +
          mark.getBoundingClientRect().height / 2 -
          (singleChart.getBoundingClientRect().top +
            singleChart.getBoundingClientRect().height / 2)
      )
    ).toBeLessThanOrEqual(1);
  });

  it.each([
    ["natural", "64px"],
    ["comfortable", "76px"],
  ] as const)(
    "preserves the %s single-lane minimum",
    async (density, expected) => {
      const element = await mount(
        [{ id: "row", label: "Row", itemIds: ["one"] }],
        [item("one", "row")],
        { density }
      );
      expect(
        renderedRow(element, "row").style.getPropertyValue("--_row-height")
      ).toBe(expected);
    }
  );

  it("counts only items intersecting the controlled date viewport when sizing lanes", async () => {
    const inside = item("inside", "row");
    const outside = Array.from(
      { length: 5 },
      (_, index): VioletGanttItem => ({
        ...item(`outside-${index}`, "row"),
        time: {
          kind: "day-range",
          start: "2028-04-01",
          endExclusive: "2028-04-03",
        },
      })
    );
    const items = [inside, ...outside];
    const element = await mount(
      [{ id: "row", label: "Row", itemIds: items.map(({ id }) => id) }],
      items
    );

    expect(
      renderedRow(element, "row").style.getPropertyValue("--_row-height")
    ).toBe("36px");
    expect(element.shadowRoot?.querySelectorAll(".item")).toHaveLength(1);
    expect(element.shadowRoot?.querySelector(".item-overflow")).toBeNull();
  });

  it("uses cumulative row offsets for pixel-distance paging and End focus", async () => {
    const rows: VioletGanttRow[] = [
      { id: "short-0", label: "Short 0", itemIds: ["short-0-item"] },
      {
        id: "busy",
        label: "Busy",
        itemIds: Array.from({ length: 6 }, (_, index) => `busy-${index}`),
      },
      { id: "short-1", label: "Short 1", itemIds: ["short-1-item"] },
      ...Array.from({ length: 100 }, (_, index) => ({
        id: `tail-${index}`,
        label: `Tail ${index}`,
        itemIds: [] as string[],
      })),
    ];
    const items = [
      item("short-0-item", "short-0"),
      ...Array.from({ length: 6 }, (_, index) => item(`busy-${index}`, "busy")),
      item("short-1-item", "short-1"),
    ];
    const element = await mount(rows, items);
    let active = renderedRow(element, "short-0");
    active.focus();
    press(active, "PageDown");
    await settle();
    expect(element.activeRowId).toBe("busy");

    active = renderedRow(element, "busy");
    press(active, "PageDown");
    await settle();
    expect(element.activeRowId).toBe("short-1");
    active = renderedRow(element, "short-1");
    press(active, "PageUp");
    await settle();
    expect(element.activeRowId).toBe("short-0");

    press(renderedRow(element, "short-0"), "End");
    await settle(4);
    expect(element.activeRowId).toBe("tail-99");
    expect(element.shadowRoot?.activeElement?.getAttribute("data-row-id")).toBe(
      "tail-99"
    );
    expect(element.shadowRoot?.querySelectorAll(".row").length).toBeLessThan(
      25
    );
  });

  it("expands and shrinks row geometry after data updates while retaining focus and selection", async () => {
    const first = item("first", "row");
    const element = await mount(
      [{ id: "row", label: "Row", itemIds: ["first"] }],
      [first],
      { selectedItemId: "first" }
    );
    renderedRow(element, "row").focus();
    const expandedItems = [
      first,
      item("second", "row"),
      item("third", "row"),
      item("fourth", "row"),
    ];
    element.rows = [
      { id: "row", label: "Row", itemIds: expandedItems.map(({ id }) => id) },
    ];
    element.items = expandedItems;
    await settle(4);

    expect(
      renderedRow(element, "row").style.getPropertyValue("--_row-height")
    ).toBe("108px");
    expect(
      element.shadowRoot
        ?.querySelector<HTMLElement>(".body")
        ?.style.getPropertyValue("--_gantt-body-height")
    ).toBe("108px");
    expect(element.shadowRoot?.activeElement?.getAttribute("data-row-id")).toBe(
      "row"
    );
    expect(element.selectedItemId).toBe("first");

    element.rows = [{ id: "row", label: "Row", itemIds: ["first"] }];
    element.items = [first];
    await settle(4);
    expect(
      renderedRow(element, "row").style.getPropertyValue("--_row-height")
    ).toBe("36px");
    expect(
      element.shadowRoot
        ?.querySelector<HTMLElement>(".body")
        ?.style.getPropertyValue("--_gantt-body-height")
    ).toBe("36px");
    const viewport =
      element.shadowRoot!.querySelector<HTMLElement>(".viewport")!;
    expect(viewport.scrollTop).toBeLessThanOrEqual(
      viewport.scrollHeight - viewport.clientHeight
    );
  });

  it("clamps vertical scroll and restores focus when a tall expanded child collapses", async () => {
    const childItems = Array.from({ length: 6 }, (_, index) =>
      item(`child-${index}`, "child")
    );
    const element = await mount(
      [
        { id: "root", label: "Root", itemIds: [] },
        {
          id: "child",
          parentId: "root",
          label: "Child",
          itemIds: childItems.map(({ id }) => id),
        },
      ],
      childItems,
      { expandedRowIds: ["root"] }
    );
    renderedRow(element, "child").focus();
    element.expandedRowIds = [];
    await settle(4);

    const viewport =
      element.shadowRoot!.querySelector<HTMLElement>(".viewport")!;
    expect(element.activeRowId).toBe("root");
    expect(element.shadowRoot?.activeElement?.getAttribute("data-row-id")).toBe(
      "root"
    );
    expect(viewport.scrollTop).toBe(0);
    expect(
      element.shadowRoot
        ?.querySelector<HTMLElement>(".body")
        ?.style.getPropertyValue("--_gantt-body-height")
    ).toBe("36px");
  });

  it("keeps single-item rows at 36px while an inline keyboard action reveals culled items", async () => {
    const scheduled = item("scheduled", "scheduled-row", "2028-12-20");
    scheduled.time = {
      kind: "day-range",
      start: "2028-12-20",
      endExclusive: "2028-12-23",
    };
    const unscheduled: VioletGanttItem = {
      ...item("unscheduled", "unscheduled-row"),
      time: null,
    };
    const element = await mount(
      [
        { id: "scheduled-row", label: "Scheduled", itemIds: ["scheduled"] },
        {
          id: "unscheduled-row",
          label: "Unscheduled",
          itemIds: ["unscheduled"],
        },
      ],
      [scheduled, unscheduled],
      {
        viewport: {
          start: "2028-01-01",
          endExclusive: "2029-01-01",
          scale: "day",
        },
      }
    );
    const before = element.renderedRows.map((row) => row.style);
    expect(before.every((style) => style.includes("--_row-height:36px"))).toBe(
      true
    );
    expect(
      element.shadowRoot?.querySelectorAll(".single-item-overflow")
    ).toHaveLength(1);
    const reveal = element.shadowRoot?.querySelector<HTMLElement>(
      '.single-item-overflow[data-row-id="scheduled-row"]'
    );
    expect(reveal?.getAttribute("aria-label")).toBe("Reveal item in Scheduled");
    reveal?.focus();
    await userEvent.keyboard("{Enter}");
    await settle(4);

    expect(element.activeItemId).toBe("scheduled");
    expect(
      element.shadowRoot?.querySelector('[data-item-id="scheduled"]')
    ).not.toBeNull();
    expect(element.shadowRoot?.activeElement?.getAttribute("data-row-id")).toBe(
      "scheduled-row"
    );
    expect(
      element.shadowRoot?.activeElement?.getAttribute("aria-activedescendant")
    ).toBe(
      element.shadowRoot
        ?.querySelector<HTMLElement>('[data-item-id="scheduled"]')
        ?.getAttribute("id")
    );
    expect(
      element.shadowRoot?.querySelectorAll(".single-item-overflow")
    ).toHaveLength(1);
    expect(element.shadowRoot?.querySelectorAll(".item-overflow")).toHaveLength(
      0
    );
    expect(
      element.renderedRows
        .map((row) => row.style)
        .every((style) => style.includes("--_row-height:36px"))
    ).toBe(true);

    const viewport =
      element.shadowRoot!.querySelector<HTMLElement>(".viewport")!;
    expect(viewport.scrollLeft).toBeGreaterThan(0);
    viewport.scrollLeft = 0;
    viewport.dispatchEvent(new Event("scroll"));
    await settle(4);

    expect(
      element.renderedRows
        .map((row) => row.style)
        .every((style) => style.includes("--_row-height:36px"))
    ).toBe(true);
    expect(
      element.shadowRoot?.querySelectorAll(".single-item-overflow")
    ).toHaveLength(1);
    expect(element.shadowRoot?.querySelectorAll(".item-overflow")).toHaveLength(
      0
    );
  });

  it("caps busy rows at six lanes while overflow cycling reaches every item", async () => {
    const items = Array.from({ length: 10 }, (_, index) =>
      item(`dense-${index}`, "dense")
    );
    const element = await mount(
      [{ id: "dense", label: "Dense", itemIds: items.map(({ id }) => id) }],
      items
    );
    expect(
      renderedRow(element, "dense").style.getPropertyValue("--_row-height")
    ).toBe("156px");
    expect(element.shadowRoot?.querySelectorAll(".item")).toHaveLength(6);
    expect(
      element.shadowRoot?.querySelector(".item-overflow")?.textContent
    ).toContain("+4");

    for (let index = 0; index < items.length; index += 1) {
      const next = element.shadowRoot?.querySelector<HTMLElement>(
        '[data-action="cycle-overflow"][data-direction="next"]'
      );
      if (!next) throw new Error("Expected overflow cycling controls.");
      await userEvent.click(next);
      await settle();
    }
    expect(element.activeItemId).toBe("dense-9");
    expect(
      element.shadowRoot?.querySelector('[data-item-id="dense-9"]')
    ).not.toBeNull();
  });
});
