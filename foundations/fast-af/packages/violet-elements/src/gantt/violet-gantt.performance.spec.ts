import { afterEach, describe, expect, it, vi } from "vitest";
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

const rows: VioletGanttRow[] = Array.from({ length: 40 }, (_, index) => ({
  id: `row-${index}`,
  label: `Record ${index}`,
  itemIds: [`item-${index}`],
}));
const items: VioletGanttItem[] = rows.map((row, index) => ({
  id: row.itemIds[0]!,
  rowId: row.id,
  label: row.label,
  time: {
    kind: "day-range",
    start: `2028-02-${String(1 + (index % 20)).padStart(2, "0")}`,
    endExclusive: `2028-02-${String(5 + (index % 20)).padStart(2, "0")}`,
  },
  presentation: "work",
  provenance: "planned",
}));

async function mount(): Promise<VioletGantt> {
  const element = document.createElement("violet-gantt") as VioletGantt;
  element.style.cssText = "display:block;width:760px;height:480px";
  element.rows = rows;
  element.items = items;
  element.viewport = {
    start: "2028-01-01",
    endExclusive: "2028-06-01",
    scale: "day",
  };
  document.body.append(element);
  await settle();
  return element;
}

async function scrollTimeline(element: VioletGantt, left: number) {
  const viewport = element.shadowRoot!.querySelector<HTMLElement>(".viewport")!;
  viewport.scrollLeft = left;
  viewport.dispatchEvent(new Event("scroll"));
  await settle();
}

describe("violet-gantt hot path", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("reuses Intl.DateTimeFormat instances across scroll frames", async () => {
    const element = await mount();
    const scrollSequence = async () => {
      for (let step = 1; step <= 10; step += 1) {
        await scrollTimeline(element, step * 120);
      }
    };
    // Warm the per-locale formatter cache, then count constructions on a repeat.
    await scrollSequence();
    const construct = vi.spyOn(Intl, "DateTimeFormat");

    await scrollSequence();

    // Each scroll frame formats ~20 day labels, their full-date titles and the
    // axis context; constructing a formatter for each of those was the hot path.
    expect(element.renderedDays.length).toBeGreaterThan(10);
    expect(construct).not.toHaveBeenCalled();
  });

  it("measures the name column once per render frame instead of once per row", async () => {
    const element = await mount();
    expect(element.renderedRows.length).toBeGreaterThan(8);
    let measurements = 0;
    const original = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.classList.contains("name-header")) measurements += 1;
        return original.call(this);
      }
    );

    const frames = 6;
    for (let step = 1; step <= frames; step += 1) {
      await scrollTimeline(element, step * 80);
    }

    expect(measurements).toBeGreaterThan(0);
    expect(measurements).toBeLessThanOrEqual(frames);
  });

  it("publishes viewport errors when the viewport changes, not while rendering", async () => {
    const element = await mount();
    expect(element.viewportError).toBe("");

    element.viewport = {
      start: "2028-06-01",
      endExclusive: "2028-01-01",
      scale: "day",
    };
    expect(element.viewportError).toMatch(/half-open YYYY-MM-DD range/);

    element.viewport = {
      start: "2028-01-01",
      endExclusive: "2028-02-01",
      scale: "day",
    };
    expect(element.viewportError).toBe("");

    element.viewport = {
      start: "2028-01-01",
      endExclusive: "2028-02-01",
      scale: "decade" as never,
    };
    expect(element.viewportError).toMatch(/half-open YYYY-MM-DD range/);
    await settle();
    expect(element.renderedRows).toEqual([]);
  });
});
