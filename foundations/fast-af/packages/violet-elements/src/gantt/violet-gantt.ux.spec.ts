import { userEvent } from "vitest/browser";
import { afterEach, describe, expect, it } from "vitest";
import "./violet-gantt";
import type {
  VioletGantt,
  VioletGanttItem,
  VioletGanttRow,
} from "./violet-gantt";

const settle = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    )
  );
const rows: VioletGanttRow[] = [
  { id: "one", label: "First record", itemIds: ["item-one"] },
  { id: "two", label: "Second record", itemIds: ["item-two"] },
];
const items: VioletGanttItem[] = rows.map((row) => ({
  id: row.itemIds[0]!,
  rowId: row.id,
  label: row.label,
  time: { kind: "day-range", start: "2028-02-28", endExclusive: "2028-03-04" },
  presentation: "window",
  provenance: "derived",
}));
async function mount(
  overrides: Partial<VioletGantt> = {}
): Promise<VioletGantt> {
  const element = document.createElement("violet-gantt") as VioletGantt;
  element.style.cssText = "display:block;width:760px;height:320px";
  element.rows = rows;
  element.items = items;
  element.viewport = {
    start: "2028-02-25",
    endExclusive: "2028-03-10",
    scale: "day",
  };
  Object.assign(element, overrides);
  document.body.append(element);
  await settle();
  return element;
}

describe("violet-gantt UX regression contract", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("retains a visible month label after scrolling within a narrow month-scale viewport", async () => {
    const element = await mount({
      viewport: {
        start: "2028-01-01",
        endExclusive: "2028-04-01",
        scale: "month",
      },
    });
    element.style.width = "280px";
    await settle();
    const viewport =
      element.shadowRoot!.querySelector<HTMLElement>(".viewport")!;
    viewport.scrollLeft = 15 * element.dayWidth;
    viewport.dispatchEvent(new Event("scroll"));
    await settle();
    expect(element.axisContextLabel).toBe("2028");
    const labels = [
      ...element.shadowRoot!.querySelectorAll<HTMLElement>(".day-label"),
    ];
    const january = labels.find((label) => label.textContent?.trim() === "Jan");
    expect(january).toBeTruthy();
    const nameHeader =
      element.shadowRoot!.querySelector<HTMLElement>(".name-header")!;
    expect(january!.getBoundingClientRect().left).toBeGreaterThanOrEqual(
      nameHeader.getBoundingClientRect().right
    );
    const february = labels.find(
      (label) => label.textContent?.trim() === "Feb"
    );
    if (february) {
      expect(january!.getBoundingClientRect().right).toBeLessThanOrEqual(
        february.getBoundingClientRect().left
      );
    }
  });

  it("retains a keyboard entry and valid focus when a refresh removes the active row", async () => {
    const element = await mount();
    element.focusItem("item-one");
    await settle();
    element.rows = [rows[1]!];
    element.items = [items[1]!];
    await settle();
    const focusable = element.shadowRoot?.querySelectorAll(
      '[part~="row"][tabindex="0"]'
    );
    expect(focusable).toHaveLength(1);
    expect(element.shadowRoot?.activeElement?.getAttribute("data-row-id")).toBe(
      "two"
    );
    element.rows = [];
    element.items = [];
    await settle();
    element.rows = rows;
    element.items = items;
    await settle();
    expect(
      element.shadowRoot?.querySelectorAll('[part~="row"][tabindex="0"]')
    ).toHaveLength(1);
  });

  it("reconciles filtered identities without stealing focus from an external control", async () => {
    const element = await mount();
    element.focusItem("item-one");
    await settle();
    const outside = document.createElement("button");
    outside.textContent = "Another view";
    document.body.append(outside);
    outside.focus();
    element.rows = [rows[1]!];
    element.items = [items[1]!];
    await settle();
    expect(document.activeElement).toBe(outside);
    expect(
      element.shadowRoot?.querySelectorAll('[part~="row"][tabindex="0"]')
    ).toHaveLength(1);
  });

  it("offers row inspection separately from item activation through the keyboard", async () => {
    const element = await mount();
    const inspected: string[] = [];
    const activated: string[] = [];
    element.addEventListener("row-inspect", (event) =>
      inspected.push((event as CustomEvent<{ rowId: string }>).detail.rowId)
    );
    element.addEventListener("item-activate", (event) =>
      activated.push((event as CustomEvent<{ itemId: string }>).detail.itemId)
    );
    element.focusItem("item-one");
    await settle();
    await userEvent.keyboard("{Shift>}{Enter}{/Shift}");
    expect(inspected).toEqual(["one"]);
    expect(activated).toEqual([]);
    await userEvent.keyboard("{Enter}");
    expect(activated).toEqual(["item-one"]);
  });

  it("retains native overflow button focus and cycles with Enter and Space without activation", async () => {
    const denseItemIds = ["a", "b", "c", "d", "e", "f", "g"];
    const denseItems = denseItemIds.map((id) => ({ ...items[0]!, id }));
    const element = await mount({
      rows: [{ id: "one", label: "Research", itemIds: denseItemIds }],
      items: denseItems,
    });
    const activated: string[] = [];
    element.addEventListener("item-activate", (event) =>
      activated.push((event as CustomEvent<{ itemId: string }>).detail.itemId)
    );
    element.focusItem("a");
    await settle();
    await userEvent.keyboard("{Tab}");
    await settle();
    expect(element.shadowRoot?.activeElement?.getAttribute("data-action")).toBe(
      "cycle-overflow"
    );
    expect(
      element.shadowRoot?.activeElement?.getAttribute("data-direction")
    ).toBe("previous");
    await userEvent.keyboard("{Enter}");
    await settle();
    expect(element.activeItemId).toBe("g");
    expect(element.shadowRoot?.activeElement?.getAttribute("data-action")).toBe(
      "cycle-overflow"
    );
    await userEvent.keyboard(" ");
    await settle();
    expect(element.activeItemId).toBe("f");
    expect(activated).toEqual([]);
  });

  it("keeps ordinary narrow row names readable alongside overflow actions", async () => {
    const denseItemIds = ["a", "b", "c", "d", "e", "f", "g"];
    const element = await mount({
      rows: [{ id: "one", label: "Research", itemIds: denseItemIds }],
      items: denseItemIds.map((id) => ({ ...items[0]!, id })),
    });
    element.style.width = "380px";
    await settle();
    const label = element.shadowRoot!.querySelector<HTMLElement>(".row-label")!;
    expect(element.shadowRoot?.querySelector(".item-overflow")).not.toBeNull();
    expect(label.clientWidth).toBeGreaterThanOrEqual(label.scrollWidth);
  });

  it.each(["today", "programmatic"])(
    "reveals the requested date after a controlled %s viewport change",
    async (reason) => {
      const target = "2031-06-01";
      const element = await mount({
        rows: [{ id: "one", label: "Future record", itemIds: ["target"] }],
        items: [
          {
            ...items[0]!,
            id: "target",
            time: { kind: "day-point", at: target },
            presentation: "milestone",
          },
        ],
        viewport: {
          start: "2028-01-01",
          endExclusive: "2030-01-01",
          scale: "month",
        },
        today: target,
      });
      element.style.width = "380px";
      await settle();
      const viewport =
        element.shadowRoot!.querySelector<HTMLElement>('[part~="viewport"]')!;
      viewport.scrollLeft = 2500;
      await settle();
      element.addEventListener("viewport-change", (event) => {
        element.viewport = (
          event as CustomEvent<{ viewport: VioletGantt["viewport"] }>
        ).detail.viewport;
      });
      expect(
        reason === "today" ? element.showToday() : element.scrollToDate(target)
      ).toBe(true);
      await settle();
      const mark = element.shadowRoot!.querySelector<HTMLElement>(
        '[data-item-id="target"]'
      );
      expect(mark).not.toBeNull();
      const name = element.shadowRoot!.querySelector<HTMLElement>(
        '[part~="name-header"]'
      )!;
      expect(mark!.getBoundingClientRect().left).toBeGreaterThanOrEqual(
        name.getBoundingClientRect().right - 1
      );
      expect(mark!.getBoundingClientRect().left).toBeLessThan(
        viewport.getBoundingClientRect().right
      );
    }
  );

  it("distinguishes projected provenance without selection-like duration outlines", async () => {
    const provenance = ["planned", "derived", "advisory", "actual"] as const;
    const element = await mount({
      rows: provenance.map((value) => ({
        id: value,
        label: value,
        itemIds: [value],
      })),
      items: provenance.map((value) => ({
        ...items[0]!,
        id: value,
        rowId: value,
        provenance: value,
      })),
    });
    const marks = provenance.map(
      (value) =>
        element.shadowRoot!.querySelector<HTMLElement>(
          `[data-item-id="${value}"]`
        )!
    );
    for (const mark of marks) {
      expect(getComputedStyle(mark).borderTopStyle).toBe("dashed");
      expect(getComputedStyle(mark).borderBottomStyle).not.toBe("dashed");
      if (mark.dataset.active !== "true") {
        expect(getComputedStyle(mark).outlineStyle).toBe("none");
      }
      expect(mark.getAttribute("aria-label")).toContain(
        mark.dataset.provenance
      );
    }
    const glyphs = marks
      .slice(0, 3)
      .map((mark) => getComputedStyle(mark, "::before").content);
    expect(new Set(glyphs).size).toBe(3);
    expect(getComputedStyle(marks[3]!).borderBottomWidth).toBe("3px");
  });

  it("distinguishes work from windows on the true interval shape without relying on color", async () => {
    const variants = ["work", "window"] as const;
    const intervalItems = variants.flatMap((presentation) => [
      {
        ...items[0]!,
        id: presentation,
        rowId: presentation,
        presentation,
        time: {
          kind: "day-range" as const,
          start: "2028-02-01",
          endExclusive: "2028-02-20",
        },
      },
      {
        ...items[0]!,
        id: `${presentation}-short`,
        rowId: `${presentation}-short`,
        presentation,
        time: {
          kind: "day-range" as const,
          start: "2028-02-01",
          endExclusive: "2028-02-02",
        },
      },
    ]);
    const element = await mount({
      density: "compact",
      rows: intervalItems.map(({ id }) => ({ id, label: id, itemIds: [id] })),
      items: intervalItems,
      viewport: {
        start: "2028-02-01",
        endExclusive: "2028-03-01",
        scale: "month",
      },
    });
    for (const presentation of variants) {
      const normal = element.shadowRoot!.querySelector<HTMLElement>(
        `[data-item-id="${presentation}"]`
      )!;
      const short = element.shadowRoot!.querySelector<HTMLElement>(
        `[data-item-id="${presentation}-short"]`
      )!;
      const geometry = short.querySelector<HTMLElement>(".item-geometry")!;
      expect(getComputedStyle(normal).borderTopStyle).toBe(
        presentation === "window" ? "dashed" : "solid"
      );
      expect(getComputedStyle(geometry).borderTopStyle).toBe(
        presentation === "window" ? "dashed" : "solid"
      );
      expect(getComputedStyle(short).borderTopWidth).toBe("0px");
      expect(geometry.getBoundingClientRect().width).toBe(element.dayWidth);
    }
  });

  it("keeps derived and advisory labels inside visible item bounds", async () => {
    const element = await mount({
      rows: [{ id: "one", label: "Record", itemIds: ["a", "b"] }],
      items: [
        {
          ...items[0]!,
          id: "a",
          label: "Derived interval",
          provenance: "derived",
        },
        {
          ...items[0]!,
          id: "b",
          label: "Advisory interval",
          provenance: "advisory",
        },
      ],
    });
    const mounted = [
      ...element.shadowRoot!.querySelectorAll<HTMLElement>('[part~="item"]'),
    ];
    expect(mounted).toHaveLength(2);
    for (const node of mounted) {
      const bounds = node.getBoundingClientRect();
      const label = node.querySelector(".item-label")!.getBoundingClientRect();
      expect(label.top).toBeGreaterThanOrEqual(bounds.top - 1);
      expect(label.bottom).toBeLessThanOrEqual(bounds.bottom + 1);
      expect(bounds.height).toBeGreaterThanOrEqual(24);
    }
  });

  it("uses a narrower name column and reveals items within the actual chart viewport", async () => {
    const far: VioletGanttItem = {
      ...items[0]!,
      id: "far",
      time: { kind: "day-point", at: "2028-07-01" },
      presentation: "milestone",
    };
    const element = await mount({
      rows: [{ id: "one", label: "A long record name", itemIds: ["far"] }],
      items: [far],
      viewport: {
        start: "2028-01-01",
        endExclusive: "2029-01-01",
        scale: "week",
      },
    });
    element.style.width = "380px";
    await settle();
    const name = element.shadowRoot!.querySelector<HTMLElement>(
      '[part~="name-header"]'
    )!;
    expect(name.getBoundingClientRect().width).toBeLessThanOrEqual(190);
    element.focusItem("far");
    await settle();
    const mark = element.shadowRoot!.querySelector<HTMLElement>(
      '[data-item-id="far"]'
    )!;
    expect(mark).toBeTruthy();
    const viewport =
      element.shadowRoot!.querySelector<HTMLElement>('[part~="viewport"]')!;
    expect(mark.getBoundingClientRect().left).toBeGreaterThanOrEqual(
      name.getBoundingClientRect().right - 1
    );
    expect(mark.getBoundingClientRect().left).toBeLessThan(
      viewport.getBoundingClientRect().right
    );
  });

  it("keeps chronological scrolling coherent under inherited RTL and preserves RTL names", async () => {
    const element = await mount({
      viewport: {
        start: "2028-01-01",
        endExclusive: "2029-01-01",
        scale: "week",
      },
    });
    element.setAttribute("dir", "rtl");
    await settle();
    const viewport =
      element.shadowRoot!.querySelector<HTMLElement>('[part~="viewport"]')!;
    const rowHeader = element.shadowRoot!.querySelector<HTMLElement>(
      '[part~="row-header"]'
    )!;
    expect(getComputedStyle(viewport).direction).toBe("ltr");
    expect(getComputedStyle(rowHeader).direction).toBe("rtl");
    const before = element.renderedDays[0]?.date;
    viewport.scrollLeft = 1200;
    await settle();
    expect(viewport.scrollLeft).toBeGreaterThan(0);
    expect(element.renderedDays[0]?.date).not.toBe(before);
    const viewportLeft = viewport.getBoundingClientRect().left;
    const name = element.shadowRoot!.querySelector<HTMLElement>(
      '[part~="name-header"]'
    )!;
    expect(
      Math.abs(name.getBoundingClientRect().left - viewportLeft)
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(rowHeader.getBoundingClientRect().left - viewportLeft)
    ).toBeLessThanOrEqual(1);
  });
});
