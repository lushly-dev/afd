import { html } from "@lushly-dev/fast-element";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { VioletListbox } from "../listbox/violet-listbox";

import "./violet-data-grid-multi-picker";
import "./violet-data-grid";
import type {
  VioletDataGrid,
  VioletDataGridCellTemplateContext,
  VioletDataGridEditorOption,
} from "./violet-data-grid";
import type { VioletDataGridMultiPicker } from "./violet-data-grid-multi-picker";
import {
  parseMultiPickerValue,
  serializeMultiPickerValue,
} from "./violet-data-grid-multi-picker-values";

const tagOptions: VioletDataGridEditorOption[] = [
  { value: "Priority Crop", label: "Priority Crop", tone: "gold" },
  { value: "Field Trial", label: "Field Trial", tone: "blue" },
  { value: "Needs Support", label: "Needs Support", tone: "teal" },
  { value: "Direct Seed", label: "Direct Seed", tone: "olive" },
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

async function renderMultiPicker(): Promise<VioletDataGridMultiPicker> {
  document.body.innerHTML = "";

  const element = document.createElement(
    "violet-data-grid-multi-picker",
  ) as VioletDataGridMultiPicker;
  element.placeholder = "Add tags";
  element.options = tagOptions;
  element.setAttribute("aria-label", "Cultivation tags");
  document.body.append(element);

  await customElements.whenDefined("violet-data-grid-multi-picker");
  await nextFrame();

  return element;
}

async function openPicker(element: VioletDataGridMultiPicker) {
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

describe("violet-data-grid-multi-picker", () => {
  describe("closed panel", () => {
    it("is not rendered or hit-testable while closed (guards against a base display on the popover)", async () => {
      const element = await renderMultiPicker();
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
      const element = await renderMultiPicker();
      const { trigger } = await openPicker(element);
      const panel = shadowElement<HTMLElement>(element, ".panel");

      expect(trigger).toBeTruthy();
      expect(getComputedStyle(panel).display).toBe("grid");
    });
  });

  it("preserves search through pointer-induced null blur and clears pointer state on cancellation", async () => {
    const element = await renderMultiPicker();
    element.selectedValues = ["Priority Crop"];
    const outside = document.createElement("button");
    outside.textContent = "Outside";
    document.body.append(outside);
    const { search, listbox } = await openPicker(element);
    await userEvent.fill(search, "trial");
    await vi.waitFor(() =>
      expect(listbox.options.map((option) => option.value)).toEqual(["Field Trial"]),
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
    expect(element.filterQuery).toBe("trial");
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
    expect(element.selectedValues).toEqual(["Priority Crop", "Field Trial"]);
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
        parse: parseMultiPickerValue,
        serialize: (value) => serializeMultiPickerValue(parseMultiPickerValue(value)),
        editorTemplate: html<VioletDataGridCellTemplateContext>`
        <violet-data-grid-multi-picker class="cell-editor" data-cell-editor="custom"
          data-commit-on-change="true" data-row-id="${(x) => x.rowId}" data-column-id="${(x) => x.columnId}"
          :value="${(x) => x.editValue}" :options="${() => tagOptions}">
        </violet-data-grid-multi-picker>
      `,
      },
    ];
    grid.rows = [{ id: "row", data: { tags: ["Priority Crop"] } }];
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
      expect(grid.shadowRoot?.querySelector("violet-data-grid-multi-picker")).toBeTruthy(),
    );
    const element = shadowElement<VioletDataGridMultiPicker>(grid, "violet-data-grid-multi-picker");
    const { search, listbox, trigger } = await openPicker(element);
    await userEvent.fill(search, "trial");
    await vi.waitFor(() =>
      expect(listbox.options.map((option) => option.value)).toEqual(["Field Trial"]),
    );
    expect(getComputedStyle(scroller).overflow).toBe("auto");
    expect(shadowElement<HTMLElement>(element, ".panel").matches(":popover-open")).toBe(true);
    await userEvent.click(shadowElement<HTMLElement>(listbox.options[0], ".control"));
    await vi.waitFor(() => {
      expect(element.selectedValues).toEqual(["Priority Crop", "Field Trial"]);
      expect(grid.editingValue).toBe(JSON.stringify(["Priority Crop", "Field Trial"]));
    });
    expect(element.filterQuery).toBe("trial");
    expect(element.open).toBe(true);
    expect(grid.editingCell).toEqual({ rowId: "row", columnId: "tags" });
    expect(change).not.toHaveBeenCalled();
    await userEvent.click(trigger);
    await vi.waitFor(() => expect(grid.editingCell).toBeNull());
    expect(change).toHaveBeenCalledTimes(1);
    expect((change.mock.calls[0][0] as CustomEvent).detail.value).toEqual([
      "Priority Crop",
      "Field Trial",
    ]);
  });
  it("retains hidden selections when clicking the filtered option's inner control", async () => {
    const element = await renderMultiPicker();
    element.selectedValues = ["Priority Crop", "unknown"];
    const input = vi.fn();
    const change = vi.fn();
    element.addEventListener("input", input);
    element.addEventListener("change", change);
    const { search, listbox, trigger } = await openPicker(element);
    await userEvent.fill(search, "trial");
    await vi.waitFor(() =>
      expect(listbox.options.map((option) => option.value)).toEqual(["Field Trial"]),
    );
    const option = listbox.options[0];
    const control = shadowElement<HTMLElement>(option, ".control");
    await userEvent.click(control);
    expect(element.filterQuery).toBe("trial");
    expect(element.open).toBe(true);
    expect(element.selectedValues).toEqual(["Priority Crop", "Field Trial", "unknown"]);
    expect(input).toHaveBeenCalledTimes(1);
    expect((input.mock.calls[0][0] as CustomEvent).detail.selectedValues).toEqual([
      "Priority Crop",
      "Field Trial",
      "unknown",
    ]);
    expect(change).not.toHaveBeenCalled();
    await userEvent.click(control);
    expect(element.selectedValues).toEqual(["Priority Crop", "unknown"]);
    await userEvent.click(control);
    await userEvent.click(trigger);
    expect(element.open).toBe(false);
    expect(change).toHaveBeenCalledTimes(1);
    expect((change.mock.calls[0][0] as CustomEvent).detail.selectedValues).toEqual([
      "Priority Crop",
      "Field Trial",
      "unknown",
    ]);
  });
  it("opens the last option with ArrowUp and keeps reverse Tab navigation native", async () => {
    const element = await renderMultiPicker();
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
    const element = await renderMultiPicker();
    const outside = document.createElement("button");
    outside.textContent = "Outside";
    document.body.append(outside);
    const change = vi.fn();
    element.addEventListener("change", change);
    await openPicker(element);
    element.toggleOption("Field Trial");
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
    const element = await renderMultiPicker();
    const inputSpy = vi.fn();
    const changeSpy = vi.fn();

    element.addEventListener("input", inputSpy);
    element.addEventListener("change", changeSpy);

    element.handleTriggerClick();
    await nextFrame();

    expect(element.open).toBe(true);

    element.toggleOption("Priority Crop");
    element.toggleOption("Field Trial");
    await nextFrame();

    expect(element.selectedValues).toEqual(["Priority Crop", "Field Trial"]);
    expect(inputSpy).toHaveBeenCalledTimes(2);
    expect(changeSpy).not.toHaveBeenCalled();

    element.handleTriggerClick();
    await nextFrame();

    expect(element.open).toBe(false);
    expect(changeSpy).toHaveBeenCalledTimes(1);
    expect(element.value).toBe('["Priority Crop","Field Trial"]');
  });

  it("supports search filtering and backspace removal from the search field", async () => {
    const element = await renderMultiPicker();

    element.selectedValues = ["Priority Crop", "Field Trial"];
    element.filterQuery = "support";
    await nextFrame();

    expect(element.filteredOptions.map((option) => option.value)).toEqual(["Needs Support"]);

    element.filterQuery = "";
    element.handleSearchKeydown(
      new KeyboardEvent("keydown", {
        bubbles: true,
        key: "Backspace",
      }),
    );
    await nextFrame();

    expect(element.selectedValues).toEqual(["Priority Crop"]);
  });

  it("focuses the search field after opening from the trigger", async () => {
    const element = await renderMultiPicker();

    element.handleTriggerClick();
    await nextFrame();
    await nextFrame();

    const search = element.shadowRoot?.querySelector(".search") as HTMLInputElement | null;
    expect(element.shadowRoot?.activeElement).toBe(search);
  });

  it("allows printable search key presses to use the browser default behavior", async () => {
    const element = await renderMultiPicker();

    element.handleTriggerClick();
    await nextFrame();
    await nextFrame();

    const search = element.shadowRoot?.querySelector(".search") as HTMLInputElement | null;
    expect(search).toBeTruthy();

    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "t",
    });

    expect(search?.dispatchEvent(event)).toBe(true);
    expect(event.defaultPrevented).toBe(false);
  });

  it("types and edits search text, preserves hidden selections, and commits on keyboard exit", async () => {
    const element = await renderMultiPicker();
    element.selectedValues = ["Priority Crop", "unknown"];
    const input = vi.fn();
    const change = vi.fn();
    element.addEventListener("input", input);
    element.addEventListener("change", change);
    const { trigger, search, listbox, control } = await openPicker(element);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(search.getAttribute("aria-controls")).toBe(listbox.id);
    await userEvent.keyboard("support");
    expect(search.value).toBe("support");
    await vi.waitFor(() =>
      expect(element.filteredOptions.map((option) => option.value)).toEqual(["Needs Support"]),
    );
    expect(input).not.toHaveBeenCalled();
    await userEvent.keyboard("{ArrowLeft}{Backspace}");
    expect(search.value).toBe("suppot");
    expect(element.filterQuery).toBe("suppot");
    expect(element.selectedValues).toEqual(["Priority Crop", "unknown"]);
    await userEvent.fill(search, "support");
    await vi.waitFor(() =>
      expect(listbox.options.map((option) => option.value)).toEqual(["Needs Support"]),
    );
    await userEvent.keyboard("{ArrowDown}");
    expect(listbox.shadowRoot?.activeElement).toBe(control);
    expect(element.open).toBe(true);
    expect(control.getAttribute("aria-multiselectable")).toBe("true");
    expect(control.ariaActiveDescendantElement).toBe(listbox.options[0]);
    await userEvent.keyboard("{Enter}");
    expect(element.selectedValues).toEqual(["Priority Crop", "Needs Support", "unknown"]);
    expect(input).toHaveBeenCalledTimes(1);
    expect(change).not.toHaveBeenCalled();
    await userEvent.keyboard("{Enter}");
    expect(element.selectedValues).toEqual(["Priority Crop", "unknown"]);
    const outside = document.createElement("button");
    outside.textContent = "Next field";
    document.body.append(outside);
    await userEvent.keyboard("{Tab}");
    await vi.waitFor(() => expect(element.open).toBe(false));
    expect(document.activeElement).toBe(outside);
    expect(change).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      expect(element.shadowRoot?.querySelector(".panel")).toBeNull();
    });
  });

  it("removes a selection only for empty-search Backspace and restores focus on Escape", async () => {
    const element = await renderMultiPicker();
    element.selectedValues = ["Priority Crop", "Field Trial"];
    const change = vi.fn();
    element.addEventListener("change", change);
    const { trigger, search } = await openPicker(element);
    await userEvent.keyboard("x{Backspace}");
    expect(search.value).toBe("");
    expect(element.selectedValues).toEqual(["Priority Crop", "Field Trial"]);
    await userEvent.keyboard("{Backspace}");
    expect(element.selectedValues).toEqual(["Priority Crop"]);
    await userEvent.keyboard("{Escape}");
    expect(element.open).toBe(false);
    expect(element.shadowRoot?.activeElement).toBe(trigger);
    expect(change).toHaveBeenCalledTimes(1);
  });

  it("leaves IME keys untouched in search and in the current listbox primitive", async () => {
    const element = await renderMultiPicker();
    element.selectedValues = ["Priority Crop"];
    const { search, control } = await openPicker(element);
    for (const key of ["Escape", "ArrowDown", "Enter", "Backspace"]) {
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
      key: "Escape",
      keyCode: 229,
      bubbles: true,
      cancelable: true,
    });
    search.dispatchEvent(legacyIME);
    expect(legacyIME.defaultPrevented).toBe(false);
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
    expect(element.selectedValues).toEqual(["Priority Crop"]);
  });

  it("keeps a disabled picker inert and closes safely when disabled while open", async () => {
    const element = await renderMultiPicker();
    element.disabled = true;
    await nextFrame();
    const trigger = shadowElement<HTMLButtonElement>(element, ".trigger");
    expect(trigger.disabled).toBe(true);
    trigger.click();
    element.toggleOption("Field Trial");
    expect(element.open).toBe(false);
    expect(element.selectedValues).toEqual([]);
    element.disabled = false;
    await nextFrame();
    await openPicker(element);
    element.disabled = true;
    await nextFrame();
    expect(element.open).toBe(false);
    expect(element.shadowRoot?.querySelector(".panel")).toBeNull();
  });

  it("escapes scroll clipping, reanchors on ancestor scroll, and cleans up on close and disconnect", async () => {
    const element = await renderMultiPicker();
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
    vi.restoreAllMocks();
  });
});
