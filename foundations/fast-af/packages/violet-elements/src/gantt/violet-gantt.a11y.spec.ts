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
  { id: "group", label: "Group", itemIds: [] },
  { id: "child", parentId: "group", label: "Child", itemIds: ["work", "single", "point"] },
  { id: "empty", label: "No items", itemIds: [] },
];
const items: VioletGanttItem[] = [
  {
    id: "work",
    rowId: "child",
    label: "Build",
    time: { kind: "day-range", start: "2028-02-28", endExclusive: "2028-03-04" },
    presentation: "work",
    provenance: "planned",
  },
  {
    id: "single",
    rowId: "child",
    label: "Review",
    time: { kind: "day-range", start: "2028-03-01", endExclusive: "2028-03-02" },
    presentation: "window",
    provenance: "derived",
  },
  {
    id: "point",
    rowId: "child",
    label: "Ship",
    time: { kind: "day-point", at: "2028-03-05" },
    presentation: "milestone",
    provenance: "actual",
  },
];

async function mount(
  overrides: Partial<VioletGantt> = {},
  attributes: Record<string, string> = {}
): Promise<VioletGantt> {
  const element = document.createElement("violet-gantt") as VioletGantt;
  element.style.cssText = "display:block;width:760px;height:320px";
  element.locale = "en-US";
  element.rows = rows;
  element.items = items;
  element.viewport = {
    start: "2028-02-25",
    endExclusive: "2028-03-10",
    scale: "day",
  };
  for (const [name, value] of Object.entries(attributes))
    element.setAttribute(name, value);
  Object.assign(element, overrides);
  document.body.append(element);
  await settle();
  return element;
}

const normalise = (text: string | null | undefined) =>
  (text ?? "").replace(/\s/g, " ");

function pressOnRow(element: VioletGantt, rowId: string, init: KeyboardEventInit) {
  const row = element.shadowRoot!.querySelector<HTMLElement>(
    `.row[data-row-id="${rowId}"]`
  )!;
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    composed: true,
    ...init,
  });
  row.dispatchEvent(event);
  return event;
}

describe("violet-gantt accessibility details", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("names items once with a humanised date label and no duplicate title", async () => {
    const element = await mount({ expandedRowIds: ["group"] });
    const mark = (id: string) =>
      element.shadowRoot!.querySelector<HTMLElement>(`[data-item-id="${id}"]`)!;

    expect(mark("work").hasAttribute("title")).toBe(false);
    const label = normalise(mark("work").getAttribute("aria-label"));
    expect(label).toContain("Build. work.");
    expect(label).toContain("Feb 28 – Mar 3, 2028 (5 days)");
    expect(label).not.toMatch(/exclusive|2028-0/);
    expect(normalise(mark("single").getAttribute("aria-label"))).toContain(
      "Mar 1, 2028 (1 day)"
    );
    expect(normalise(mark("point").getAttribute("aria-label"))).toContain(
      "Mar 5, 2028"
    );
  });

  it("only adds a row-label tooltip when a description supplies extra information", async () => {
    const element = await mount({
      rows: [
        { id: "plain", label: "Plain", itemIds: [] },
        { id: "described", label: "Described", itemIds: [], description: "More detail" },
      ],
      items: [],
    });
    const label = (id: string) =>
      element.shadowRoot!.querySelector<HTMLElement>(
        `.row[data-row-id="${id}"] .row-label`
      )!;

    expect(label("plain").hasAttribute("title")).toBe(false);
    expect(label("described").getAttribute("title")).toBe("More detail");
  });

  it("does not reflect a default aria-label onto the generic host", async () => {
    const element = await mount();
    expect(element.hasAttribute("aria-label")).toBe(false);
    expect(
      element.shadowRoot!.querySelector('[role="treegrid"]')!.getAttribute(
        "aria-label"
      )
    ).toBe("Timeline");

    element.ariaLabel = "Release plan";
    await settle();
    expect(element.hasAttribute("aria-label")).toBe(false);
    expect(
      element.shadowRoot!.querySelector('[role="treegrid"]')!.getAttribute(
        "aria-label"
      )
    ).toBe("Release plan");
  });

  it("still accepts an aria-label attribute as the treegrid name", async () => {
    const element = await mount({}, { "aria-label": "Harvest schedule" });
    expect(element.ariaLabel).toBe("Harvest schedule");
    expect(
      element.shadowRoot!.querySelector('[role="treegrid"]')!.getAttribute(
        "aria-label"
      )
    ).toBe("Harvest schedule");
  });

  it("claims Alt+Arrow only when the row has items to move between", async () => {
    const element = await mount({ expandedRowIds: ["group"] });

    const withItems = pressOnRow(element, "child", {
      key: "ArrowRight",
      altKey: true,
    });
    expect(withItems.defaultPrevented).toBe(true);
    expect(element.activeItemId).not.toBeNull();

    const withoutItems = pressOnRow(element, "empty", {
      key: "ArrowLeft",
      altKey: true,
    });
    expect(withoutItems.defaultPrevented).toBe(false);
  });

  it("expands and collapses with the arrow that points toward the end of the line", async () => {
    for (const [dir, expandKey, collapseKey] of [
      ["ltr", "ArrowRight", "ArrowLeft"],
      ["rtl", "ArrowLeft", "ArrowRight"],
    ] as const) {
      document.body.innerHTML = "";
      const element = await mount();
      element.dir = dir;
      await settle();
      const requests: string[][] = [];
      element.addEventListener("expanded-change", (event) => {
        requests.push(
          [...(event as CustomEvent<{ expandedRowIds: string[] }>).detail.expandedRowIds]
        );
      });

      pressOnRow(element, "group", { key: collapseKey });
      expect(requests, `${dir} ${collapseKey} on a collapsed group`).toEqual([]);
      pressOnRow(element, "group", { key: expandKey });
      expect(requests, `${dir} ${expandKey} on a collapsed group`).toEqual([
        ["group"],
      ]);
    }
  });
});
