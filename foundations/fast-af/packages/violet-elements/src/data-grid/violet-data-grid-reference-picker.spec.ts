import { html } from "@lushly-dev/fast-element";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { VioletListbox } from "../listbox/violet-listbox";

import "./violet-data-grid-reference-picker";
import "./violet-data-grid";
import type {
  VioletDataGrid,
  VioletDataGridCellTemplateContext,
  VioletDataGridEditorOption,
} from "./violet-data-grid";
import type { VioletDataGridReferencePicker } from "./violet-data-grid-reference-picker";
import {
  parseReferencePickerValue,
  serializeReferencePickerValue,
} from "./violet-data-grid-reference-picker-values";

const recordOptions: VioletDataGridEditorOption[] = [
  {
    value: "record-gh-04",
    label: "Greenhouse block 4",
    description: "Propagation house · 18 trays",
    tone: "blue",
    keywords: ["greenhouse", "propagation", "trays"],
  },
  {
    value: "record-cedar-5",
    label: "Cedar bed 5",
    description: "Field beds · North fence",
    tone: "olive",
    keywords: ["field", "north", "cedar"],
  },
  {
    value: "record-packhouse",
    label: "Packhouse queue",
    description: "Operations board · Friday handoff",
    tone: "gold",
    keywords: ["operations", "handoff"],
  },
];

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function shadowElement<T extends HTMLElement>(element: HTMLElement, selector: string): T {
  const target = element.shadowRoot?.querySelector<T>(selector);
  if (!target) {
    throw new Error(`Expected ${selector} in ${element.localName} shadow root.`);
  }
  return target;
}

async function renderReferencePicker(
  overrides: Partial<{
    selectedValues: string[];
    multiple: boolean;
    allowCreate: boolean;
  }> = {},
): Promise<VioletDataGridReferencePicker> {
  document.body.innerHTML = "";

  const element = document.createElement(
    "violet-data-grid-reference-picker",
  ) as VioletDataGridReferencePicker;
  element.placeholder = "Link records";
  element.options = recordOptions;
  element.selectedValues = overrides.selectedValues ?? ["record-gh-04"];
  element.multiple = overrides.multiple ?? true;
  element.allowCreate = overrides.allowCreate ?? false;
  element.setAttribute("aria-label", "Linked records");
  document.body.append(element);

  await customElements.whenDefined("violet-data-grid-reference-picker");
  await nextFrame();

  return element;
}

async function openPicker(element: VioletDataGridReferencePicker) {
  const trigger = shadowElement<HTMLButtonElement>(element, ".trigger");
  await userEvent.click(trigger);
  await vi.waitFor(() => {
    expect(element.shadowRoot?.querySelector(".panel")?.matches(":popover-open")).toBe(true);
    expect(element.shadowRoot?.activeElement).toBe(element.shadowRoot?.querySelector(".search"));
  });
  const search = shadowElement<HTMLInputElement>(element, ".search");
  const listbox = shadowElement<VioletListbox>(element, "violet-listbox");
  const control = shadowElement<HTMLElement>(listbox, '[role="listbox"]');
  return { trigger, search, listbox, control };
}

describe("violet-data-grid-reference-picker", () => {
  describe("closed panel", () => {
    it("is not rendered or hit-testable while closed (guards against a base display on the popover)", async () => {
      const element = await renderReferencePicker();
      const trigger = shadowElement<HTMLElement>(element, ".trigger");
      const panel = element.shadowRoot?.querySelector<HTMLElement>(".panel") ?? null;

      expect(element.open).toBe(false);
      if (panel) {
        expect(panel.matches(":popover-open")).toBe(false);
        expect(getComputedStyle(panel).display).toBe("none");
      }

      const rect = trigger.getBoundingClientRect();
      const hit = element.shadowRoot?.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );
      expect(panel?.contains(hit as Node) ?? false).toBe(false);
    });

    it("opens from a real pointer click on the trigger and lays out the panel", async () => {
      const element = await renderReferencePicker();
      const { trigger } = await openPicker(element);
      const panel = shadowElement<HTMLElement>(element, ".panel");

      expect(trigger).toBeTruthy();
      expect(getComputedStyle(panel).display).toBe("grid");
    });
  });

  it("preserves search through pointer-induced null blur and clears pointer state on cancellation", async () => {
    const element = await renderReferencePicker();
    element.selectedValues = ["record-gh-04"];
    const outside = document.createElement("button");
    outside.textContent = "Outside";
    document.body.append(outside);
    const { search, listbox } = await openPicker(element);
    await userEvent.fill(search, "north");
    await vi.waitFor(() =>
      expect(listbox.options.map((option) => option.value)).toEqual(["record-cedar-5"]),
    );
    const optionControl = shadowElement<HTMLElement>(listbox.options[0], ".control");
    const down = new PointerEvent("pointerdown", {
      pointerId: 7,
      button: 0,
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    optionControl.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(false);
    // Reproduce Testing Library's shadow-unaware blur before option activation.
    search.blur();
    expect(element.open).toBe(true);
    expect(element.filterQuery).toBe("north");
    const up = new PointerEvent("pointerup", {
      pointerId: 7,
      button: 0,
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    optionControl.dispatchEvent(up);
    expect(up.defaultPrevented).toBe(false);
    expect(listbox.shadowRoot?.activeElement).toBe(
      shadowElement<HTMLElement>(listbox, '[role="listbox"]'),
    );
    optionControl.click();
    expect(element.selectedValues).toEqual(["record-gh-04", "record-cedar-5"]);
    await userEvent.keyboard("{Tab}");
    await vi.waitFor(() => expect(element.open).toBe(false));
    expect(document.activeElement).toBe(outside);

    const reopened = await openPicker(element);
    const reopenedOption = shadowElement<HTMLElement>(reopened.listbox.options[0], ".control");
    reopenedOption.dispatchEvent(
      new PointerEvent("pointerdown", { pointerId: 8, button: 0, bubbles: true, composed: true }),
    );
    reopened.search.blur();
    expect(element.open).toBe(true);
    reopenedOption.dispatchEvent(
      new PointerEvent("pointercancel", { pointerId: 8, bubbles: true, composed: true }),
    );
    expect(element.open).toBe(false);
    outside.focus();
    document.dispatchEvent(new PointerEvent("pointerup", { pointerId: 8, bubbles: true }));
    await nextFrame();
    expect(document.activeElement).toBe(outside);

    const finalOpen = await openPicker(element);
    finalOpen.search.blur();
    expect(element.open).toBe(false);
  });
  it("retains hidden selections on a native inner-option click in a value-only clipped grid editor", async () => {
    const grid = document.createElement("violet-data-grid") as VioletDataGrid;
    grid.columns = [
      {
        id: "tags",
        label: "Tags",
        editable: true,
        editor: "custom",
        value: (row) => JSON.stringify((row as { tags: string[] }).tags),
        parse: parseReferencePickerValue,
        serialize: (value) => serializeReferencePickerValue(parseReferencePickerValue(value)),
        editorTemplate: html<VioletDataGridCellTemplateContext>`
        <violet-data-grid-reference-picker class="cell-editor" data-cell-editor="custom"
          data-commit-on-change="true" data-row-id="${(x) => x.rowId}" data-column-id="${(x) => x.columnId}"
          :value="${(x) => x.editValue}" :options="${() => recordOptions}">
        </violet-data-grid-reference-picker>
      `,
      },
    ];
    grid.rows = [{ id: "row", data: { tags: ["record-gh-04"] } }];
    grid.focusMode = "cell";
    grid.selectionMode = "none";
    grid.showFilter = false;
    const change = vi.fn();
    grid.addEventListener("cell-change", change);
    document.body.append(grid);
    await nextFrame();
    grid.activeCell = { rowId: "row", columnId: "tags" };
    const scroller = shadowElement<HTMLElement>(grid, ".table-scroll");
    scroller.style.maxBlockSize = "64px";
    scroller.focus();
    await userEvent.keyboard("{F2}");
    await vi.waitFor(() =>
      expect(grid.shadowRoot?.querySelector("violet-data-grid-reference-picker")).toBeTruthy(),
    );
    const element = shadowElement<VioletDataGridReferencePicker>(
      grid,
      "violet-data-grid-reference-picker",
    );
    const { search, listbox, trigger } = await openPicker(element);
    await userEvent.fill(search, "north");
    await vi.waitFor(() =>
      expect(listbox.options.map((option) => option.value)).toEqual(["record-cedar-5"]),
    );
    expect(getComputedStyle(scroller).overflow).toBe("auto");
    expect(shadowElement<HTMLElement>(element, ".panel").matches(":popover-open")).toBe(true);
    await userEvent.click(shadowElement<HTMLElement>(listbox.options[0], ".control"));
    await vi.waitFor(() => {
      expect(element.selectedValues).toEqual(["record-gh-04", "record-cedar-5"]);
      expect(grid.editingValue).toBe(JSON.stringify(["record-gh-04", "record-cedar-5"]));
    });
    expect(element.filterQuery).toBe("north");
    expect(element.open).toBe(true);
    expect(grid.editingCell).toEqual({ rowId: "row", columnId: "tags" });
    expect(change).not.toHaveBeenCalled();
    await userEvent.click(trigger);
    await vi.waitFor(() => expect(grid.editingCell).toBeNull());
    expect(change).toHaveBeenCalledTimes(1);
    expect((change.mock.calls[0][0] as CustomEvent).detail.value).toEqual([
      "record-gh-04",
      "record-cedar-5",
    ]);
  });
  it("retains hidden selections when clicking the filtered option's inner control", async () => {
    const element = await renderReferencePicker();
    element.selectedValues = ["record-gh-04", "unknown"];
    const input = vi.fn();
    const change = vi.fn();
    element.addEventListener("input", input);
    element.addEventListener("change", change);
    const { search, listbox, trigger } = await openPicker(element);
    await userEvent.fill(search, "north");
    await vi.waitFor(() =>
      expect(listbox.options.map((option) => option.value)).toEqual(["record-cedar-5"]),
    );
    const option = listbox.options[0];
    const control = shadowElement<HTMLElement>(option, ".control");
    await userEvent.click(control);
    expect(element.filterQuery).toBe("north");
    expect(element.open).toBe(true);
    expect(element.selectedValues).toEqual(["record-gh-04", "record-cedar-5", "unknown"]);
    expect(input).toHaveBeenCalledTimes(1);
    expect((input.mock.calls[0][0] as CustomEvent).detail.selectedValues).toEqual([
      "record-gh-04",
      "record-cedar-5",
      "unknown",
    ]);
    expect(change).not.toHaveBeenCalled();
    await userEvent.click(control);
    expect(element.selectedValues).toEqual(["record-gh-04", "unknown"]);
    await userEvent.click(control);
    await userEvent.click(trigger);
    expect(element.open).toBe(false);
    expect(change).toHaveBeenCalledTimes(1);
    expect((change.mock.calls[0][0] as CustomEvent).detail.selectedValues).toEqual([
      "record-gh-04",
      "record-cedar-5",
      "unknown",
    ]);
  });
  it("opens the last option with ArrowUp and keeps reverse Tab navigation native", async () => {
    const element = await renderReferencePicker();
    const before = document.createElement("button");
    before.textContent = "Previous field";
    element.before(before);
    const trigger = shadowElement<HTMLButtonElement>(element, ".trigger");
    trigger.focus();
    await userEvent.keyboard("{ArrowUp}");
    await vi.waitFor(() => {
      const listbox = shadowElement<VioletListbox>(element, "violet-listbox");
      const control = shadowElement<HTMLElement>(listbox, '[role="listbox"]');
      expect(listbox.shadowRoot?.activeElement).toBe(control);
      expect(listbox.activeValue).toBe(element.options.at(-1)?.value);
    });
    await userEvent.keyboard("{Escape}");
    expect(element.shadowRoot?.activeElement).toBe(trigger);
    const { search } = await openPicker(element);
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    expect(element.shadowRoot?.activeElement).toBe(trigger);
    expect(element.open).toBe(true);
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    await vi.waitFor(() => expect(element.open).toBe(false));
    expect(document.activeElement).toBe(before);
    expect(search.isConnected).toBe(false);
  });

  it("commits on outside pointer dismissal without stealing focus or committing twice", async () => {
    const element = await renderReferencePicker();
    const outside = document.createElement("button");
    outside.textContent = "Outside";
    document.body.append(outside);
    const change = vi.fn();
    element.addEventListener("change", change);
    await openPicker(element);
    element.toggleOption("record-cedar-5");
    await userEvent.click(outside);
    await nextFrame();
    expect(element.open).toBe(false);
    expect(document.activeElement).toBe(outside);
    expect(change).toHaveBeenCalledTimes(1);
    const trigger = shadowElement<HTMLButtonElement>(element, ".trigger");
    trigger.focus();
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    outside.focus();
    await nextFrame();
    await nextFrame();
    expect(element.open).toBe(false);
    expect(document.activeElement).toBe(outside);
    expect(change).toHaveBeenCalledTimes(1);
  });
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("tracks pending selections and emits change when the picker closes", async () => {
    const element = await renderReferencePicker();
    const inputSpy = vi.fn();
    const changeSpy = vi.fn();

    element.addEventListener("input", inputSpy);
    element.addEventListener("change", changeSpy);

    element.handleTriggerClick();
    await nextFrame();

    expect(element.open).toBe(true);

    element.toggleOption("record-cedar-5");
    await nextFrame();

    expect(element.selectedValues).toEqual(["record-gh-04", "record-cedar-5"]);
    expect(inputSpy).toHaveBeenCalledTimes(1);
    expect(changeSpy).not.toHaveBeenCalled();

    element.handleTriggerClick();
    await nextFrame();

    expect(element.open).toBe(false);
    expect(changeSpy).toHaveBeenCalledTimes(1);
    expect(element.value).toBe('["record-gh-04","record-cedar-5"]');
  });

  it("filters across descriptions and emits query-change and create-request events", async () => {
    const element = await renderReferencePicker({
      selectedValues: [],
      allowCreate: true,
    });
    const querySpy = vi.fn();
    const createSpy = vi.fn();

    element.addEventListener("query-change", querySpy);
    element.addEventListener("create-request", createSpy);

    element.handleTriggerClick();
    await nextFrame();
    const search = shadowElement<HTMLInputElement>(element, ".search");
    await userEvent.fill(search, "north");
    await nextFrame();

    expect(element.filteredOptions.map((option) => option.value)).toEqual(["record-cedar-5"]);
    expect(querySpy).toHaveBeenCalledTimes(1);

    await userEvent.fill(search, "Fresh market dispatch");
    await nextFrame();

    expect(element.hasCreateAction).toBe(true);

    element.handleCreateAction();

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect((createSpy.mock.calls[0]?.[0] as CustomEvent<{ query: string }>).detail.query).toBe(
      "Fresh market dispatch",
    );
  });

  it("supports single-select mode and commits immediately after a selection", async () => {
    const element = await renderReferencePicker({
      multiple: false,
    });
    const changeSpy = vi.fn();
    element.addEventListener("change", changeSpy);

    element.handleTriggerClick();
    await nextFrame();

    element.handleListboxInput(
      new CustomEvent("input", {
        detail: {
          value: "record-packhouse",
        },
      }),
    );
    await nextFrame();

    expect(element.selectedValues).toEqual(["record-packhouse"]);
    expect(element.open).toBe(false);
    expect(changeSpy).toHaveBeenCalledTimes(1);
    expect(element.value).toBe('["record-packhouse"]');
  });

  it("types and edits search text without selection events, then preserves hidden references on selection", async () => {
    const element = await renderReferencePicker({ selectedValues: ["record-gh-04", "unknown"] });
    const input = vi.fn();
    const change = vi.fn();
    const query = vi.fn();
    element.addEventListener("input", input);
    element.addEventListener("change", change);
    element.addEventListener("query-change", query);
    const { trigger, search, listbox, control } = await openPicker(element);
    expect(search.getAttribute("aria-controls")).toBe(listbox.id);
    await userEvent.keyboard("north");
    expect(search.value).toBe("north");
    expect(element.filterQuery).toBe("north");
    await vi.waitFor(() =>
      expect(listbox.options.map((option) => option.value)).toEqual(["record-cedar-5"]),
    );
    expect(input).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalled();
    expect((query.mock.lastCall?.[0] as CustomEvent).detail).toEqual({ query: "north" });
    await userEvent.keyboard("{ArrowLeft}{Backspace}");
    expect(search.value).toBe("norh");
    expect(element.filterQuery).toBe("norh");
    expect(element.selectedValues).toEqual(["record-gh-04", "unknown"]);
    await userEvent.fill(search, "north");
    await vi.waitFor(() => expect(listbox.options).toHaveLength(1));
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(listbox.shadowRoot?.activeElement).toBe(control);
    expect(control.ariaActiveDescendantElement).toBe(listbox.options[0]);
    expect(element.selectedValues).toEqual(["record-gh-04", "record-cedar-5", "unknown"]);
    expect(input).toHaveBeenCalledTimes(1);
    expect(change).not.toHaveBeenCalled();
    const outside = document.createElement("button");
    outside.textContent = "Next field";
    document.body.append(outside);
    await userEvent.keyboard("{Tab}");
    await vi.waitFor(() => expect(element.open).toBe(false));
    expect(document.activeElement).toBe(outside);
    expect(change).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      expect(element.shadowRoot?.querySelector(".panel")).toBeNull();
    });
  });

  it("selects a single reference with the real listbox keyboard and restores trigger focus", async () => {
    const element = await renderReferencePicker({ multiple: false });
    const change = vi.fn();
    element.addEventListener("change", change);
    const { trigger, search } = await openPicker(element);
    await userEvent.fill(search, "handoff");
    await vi.waitFor(() =>
      expect(element.filteredOptions.map((option) => option.value)).toEqual(["record-packhouse"]),
    );
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(element.selectedValues).toEqual(["record-packhouse"]);
    expect(element.open).toBe(false);
    expect(element.shadowRoot?.activeElement).toBe(trigger);
    expect(change).toHaveBeenCalledTimes(1);
  });

  it("allows IME input and confirmation without creating, selecting, removing, or closing", async () => {
    const element = await renderReferencePicker({ allowCreate: true });
    const create = vi.fn();
    element.addEventListener("create-request", create);
    const { trigger, search, control } = await openPicker(element);
    await userEvent.fill(search, "New field");
    for (const key of ["Enter", "Escape", "ArrowDown", "Backspace"]) {
      const event = new KeyboardEvent("keydown", {
        key,
        isComposing: true,
        bubbles: true,
        composed: true,
        cancelable: true,
      });
      search.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(element.open).toBe(true);
      expect(element.shadowRoot?.activeElement).toBe(search);
    }
    const legacyIME = new KeyboardEvent("keydown", {
      key: "Enter",
      keyCode: 229,
      bubbles: true,
      cancelable: true,
    });
    search.dispatchEvent(legacyIME);
    expect(legacyIME.defaultPrevented).toBe(false);
    expect(create).not.toHaveBeenCalled();
    await userEvent.fill(search, "");
    await userEvent.keyboard("{ArrowDown}");
    const confirm = new KeyboardEvent("keydown", {
      key: "Enter",
      isComposing: true,
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    control.dispatchEvent(confirm);
    expect(confirm.defaultPrevented).toBe(false);
    expect(element.selectedValues).toEqual(["record-gh-04"]);
    await userEvent.keyboard("{Escape}");
    expect(element.shadowRoot?.activeElement).toBe(trigger);
  });

  it("creates only on intentional activation, and Escape from the create action closes the panel", async () => {
    const element = await renderReferencePicker({ allowCreate: true, selectedValues: [] });
    const create = vi.fn();
    element.addEventListener("create-request", create);
    const { trigger, search } = await openPicker(element);
    await userEvent.keyboard("New field packet");
    expect(search.value).toBe("New field packet");
    await vi.waitFor(() => expect(element.hasCreateAction).toBe(true));
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(create).toHaveBeenCalledTimes(1);
    expect((create.mock.calls[0][0] as CustomEvent).detail).toEqual({ query: "New field packet" });
    expect(element.selectedValues).toEqual([]);
    await userEvent.keyboard("{Escape}");
    expect(element.open).toBe(false);
    expect(element.shadowRoot?.activeElement).toBe(trigger);
  });

  it("keeps disabled controls inert and removes the open popup when disabled", async () => {
    const element = await renderReferencePicker({ allowCreate: true });
    element.disabled = true;
    await nextFrame();
    const trigger = shadowElement<HTMLButtonElement>(element, ".trigger");
    expect(trigger.disabled).toBe(true);
    trigger.click();
    element.toggleOption("record-cedar-5");
    const create = vi.fn();
    element.addEventListener("create-request", create);
    element.filterQuery = "New record";
    element.handleCreateAction();
    expect(create).not.toHaveBeenCalled();
    expect(element.selectedValues).toEqual(["record-gh-04"]);
    expect(element.open).toBe(false);
    element.disabled = false;
    await nextFrame();
    await openPicker(element);
    element.disabled = true;
    await nextFrame();
    expect(element.open).toBe(false);
    expect(element.shadowRoot?.querySelector(".panel")).toBeNull();
  });

  it("escapes scroll clipping, reanchors in a shadow scroll container, and removes viewport listeners", async () => {
    const element = await renderReferencePicker();
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    const scroller = document.createElement("div");
    scroller.style.cssText = "overflow:auto;height:48px;width:240px";
    root.append(scroller);
    document.body.append(host);
    scroller.append(element);
    const { search } = await openPicker(element);
    const panel = shadowElement<HTMLElement>(element, ".panel");
    expect(getComputedStyle(panel).position).toBe("fixed");
    expect(panel.matches(":popover-open")).toBe(true);
    expect(panel.getBoundingClientRect().bottom).toBeGreaterThan(
      scroller.getBoundingClientRect().bottom,
    );
    expect(panel.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight - 7);
    const trigger = shadowElement<HTMLButtonElement>(element, ".trigger");
    const bounds = vi
      .spyOn(trigger, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(80, 80, 120, 24));
    scroller.dispatchEvent(new Event("scroll"));
    expect(panel.style.left).toBe("80px");
    expect(panel.style.top).toBe("110px");
    const remove = vi.spyOn(window, "removeEventListener");
    const rootRemove = vi.spyOn(root, "removeEventListener");
    search.focus();
    await userEvent.keyboard("{Escape}");
    expect(panel.matches(":popover-open")).toBe(false);
    expect(remove).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(rootRemove).toHaveBeenCalledWith("scroll", expect.any(Function), true);
    bounds.mockClear();
    scroller.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("resize"));
    expect(bounds).not.toHaveBeenCalled();
    await openPicker(element);
    const reopened = shadowElement<HTMLElement>(element, ".panel");
    element.remove();
    expect(reopened.matches(":popover-open")).toBe(false);
    expect(element.open).toBe(false);
    bounds.mockClear();
    scroller.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("resize"));
    expect(bounds).not.toHaveBeenCalled();
  });
});
