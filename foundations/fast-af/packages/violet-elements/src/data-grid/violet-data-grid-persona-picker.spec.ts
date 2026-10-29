import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import "./violet-data-grid-persona-picker";
import type { VioletDataGridEditorOption } from "./violet-data-grid";
import type { VioletDataGridPersonaPicker } from "./violet-data-grid-persona-picker";

const assigneeOptions: VioletDataGridEditorOption[] = [
  {
    value: "user-lydia-bauer",
    label: "Lydia Bauer",
    description: "Propagation lead",
    initials: "LB",
  },
  {
    value: "user-morgan-snow",
    label: "Morgan Snow",
    description: "Operations handoff",
    initials: "MS",
  },
  {
    value: "user-katri-athokas",
    label: "Katri Athokas",
    description: "Field planning",
    initials: "KA",
  },
];

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

async function renderPersonaPicker(
  overrides: Partial<{
    selectedValues: string[];
    multiple: boolean;
  }> = {},
): Promise<VioletDataGridPersonaPicker> {
  document.body.innerHTML = "";

  const element = document.createElement(
    "violet-data-grid-persona-picker",
  ) as VioletDataGridPersonaPicker;
  element.placeholder = "Assign people";
  element.options = assigneeOptions;
  element.selectedValues = overrides.selectedValues ?? ["user-lydia-bauer"];
  element.multiple = overrides.multiple ?? true;
  element.setAttribute("aria-label", "Assignees");
  document.body.append(element);

  await customElements.whenDefined("violet-data-grid-persona-picker");
  await nextFrame();

  return element;
}

describe("violet-data-grid-persona-picker", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("tracks pending assignees and emits change when the picker closes", async () => {
    const element = await renderPersonaPicker();
    const inputSpy = vi.fn();
    const changeSpy = vi.fn();

    element.addEventListener("input", inputSpy);
    element.addEventListener("change", changeSpy);

    element.handleTriggerClick();
    await nextFrame();

    expect(element.open).toBe(true);

    element.toggleOption("user-morgan-snow");
    await nextFrame();

    expect(element.selectedValues).toEqual(["user-lydia-bauer", "user-morgan-snow"]);
    expect(inputSpy).toHaveBeenCalledTimes(1);
    expect(changeSpy).not.toHaveBeenCalled();

    element.handleTriggerClick();
    await nextFrame();

    expect(element.open).toBe(false);
    expect(changeSpy).toHaveBeenCalledTimes(1);
    expect(element.value).toBe('["user-lydia-bauer","user-morgan-snow"]');
  });

  it("filters across assignee metadata and removes the last assignee with backspace", async () => {
    const element = await renderPersonaPicker({
      selectedValues: ["user-lydia-bauer", "user-morgan-snow"],
    });

    element.handleTriggerClick();
    await nextFrame();
    const search = element.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
    search.value = "field";
    search.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await nextFrame();

    expect(element.filteredOptions.map((option) => option.value)).toEqual(["user-katri-athokas"]);

    element.filterQuery = "";
    element.handleSearchKeydown(
      new KeyboardEvent("keydown", {
        bubbles: true,
        key: "Backspace",
      }),
    );
    await nextFrame();

    expect(element.selectedValues).toEqual(["user-lydia-bauer"]);
  });

  it("supports single-select mode and commits immediately after a selection", async () => {
    const element = await renderPersonaPicker({
      multiple: false,
    });
    const changeSpy = vi.fn();
    element.addEventListener("change", changeSpy);

    element.handleTriggerClick();
    await nextFrame();

    element.handleListboxInput(
      new CustomEvent("input", {
        detail: {
          value: "user-katri-athokas",
        },
      }),
    );
    await nextFrame();

    expect(element.selectedValues).toEqual(["user-katri-athokas"]);
    expect(element.open).toBe(false);
    expect(changeSpy).toHaveBeenCalledTimes(1);
    expect(element.value).toBe('["user-katri-athokas"]');
  });

  it("retains hidden assignees when selecting a filtered option through the listbox", async () => {
    const element = await renderPersonaPicker();
    element.handleTriggerClick();
    await nextFrame();
    await nextFrame();
    await userEvent.keyboard("field");
    await nextFrame();
    await nextFrame();
    const listbox = element.shadowRoot!.querySelector("violet-listbox")!;
    expect(
      [...listbox.querySelectorAll("violet-option")].map((option) => option.getAttribute("value")),
    ).toEqual(["user-katri-athokas"]);
    await userEvent.keyboard("{ArrowDown}");
    await nextFrame();
    expect(listbox.shadowRoot!.activeElement).toBe(listbox.shadowRoot!.querySelector(".control"));
    await userEvent.keyboard(" ");
    await nextFrame();
    expect(element.selectedValues).toEqual(["user-lydia-bauer", "user-katri-athokas"]);
  });

  it("retains hidden assignees when a real option click blurs the search", async () => {
    const element = await renderPersonaPicker();
    element.handleTriggerClick();
    await nextFrame();
    await nextFrame();
    await userEvent.keyboard("field");
    await nextFrame();
    await nextFrame();
    const listbox = element.shadowRoot!.querySelector("violet-listbox")!;
    const option = listbox.querySelector<HTMLElement>('violet-option[value="user-katri-athokas"]')!;
    const control = option.shadowRoot!.querySelector<HTMLElement>(".control")!;
    await userEvent.click(control);
    await nextFrame();
    expect(element.open).toBe(true);
    expect(element.selectedValues).toEqual(["user-lydia-bauer", "user-katri-athokas"]);
    expect(listbox.shadowRoot!.activeElement).toBe(listbox.shadowRoot!.querySelector(".control"));
    element.handleTriggerClick();
    expect(element.value).toBe('["user-lydia-bauer","user-katri-athokas"]');
  });

  it("allows caret editing and contains text and composition events without cancelling defaults", async () => {
    const element = await renderPersonaPicker();
    const parentKeydown = vi.fn();
    const parentInput = vi.fn();
    document.body.addEventListener("keydown", parentKeydown);
    document.body.addEventListener("input", parentInput);
    try {
      element.handleTriggerClick();
      await nextFrame();
      await nextFrame();
      await userEvent.keyboard("ab{ArrowLeft}{Backspace}");
      const search = element.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
      expect(search.value).toBe("b");
      expect(element.filterQuery).toBe("b");
      for (const key of ["Escape", "Enter", "Backspace", "Tab"]) {
        const event = new KeyboardEvent("keydown", {
          key,
          isComposing: true,
          cancelable: true,
          bubbles: true,
          composed: true,
        });
        search.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
      }
      expect(element.open).toBe(true);
      expect(element.selectedValues).toEqual(["user-lydia-bauer"]);
      expect(parentKeydown).not.toHaveBeenCalled();
      expect(parentInput).not.toHaveBeenCalled();
    } finally {
      document.body.removeEventListener("keydown", parentKeydown);
      document.body.removeEventListener("input", parentInput);
    }
  });

  it("preserves native Tab and IME before the listbox primitive handles them", async () => {
    const element = await renderPersonaPicker();
    element.handleTriggerClick();
    await nextFrame();
    await nextFrame();
    const listbox = element.shadowRoot!.querySelector("violet-listbox")!;
    const control = listbox.shadowRoot!.querySelector(".control")!;
    for (const init of [
      { key: "Tab" },
      { key: "Enter", isComposing: true },
      { key: "Escape", keyCode: 229 },
    ]) {
      const event = new KeyboardEvent("keydown", {
        ...init,
        bubbles: true,
        composed: true,
        cancelable: true,
      });
      control.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(element.open).toBe(true);
      expect(element.selectedValues).toEqual(["user-lydia-bauer"]);
    }
  });

  it("closes when disabled and ignores disabled selection actions", async () => {
    const element = await renderPersonaPicker();
    element.handleTriggerClick();
    await nextFrame();
    element.disabled = true;
    element.toggleOption("user-morgan-snow");
    element.handleTriggerClick();
    await nextFrame();
    expect(element.open).toBe(false);
    expect(element.selectedValues).toEqual(["user-lydia-bauer"]);
    expect(element.shadowRoot!.querySelector<HTMLButtonElement>(".trigger")!.disabled).toBe(true);
  });

  it("escapes overflow clipping, tracks shadow-root scrolling, and removes listeners on close", async () => {
    const element = await renderPersonaPicker();
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    const scroller = document.createElement("div");
    scroller.style.cssText = "overflow:auto; height:45px; width:400px; margin:40px";
    root.append(scroller);
    scroller.append(element);
    document.body.append(host);
    await nextFrame();
    const removeScroll = vi.spyOn(root, "removeEventListener");
    const removeResize = vi.spyOn(window, "removeEventListener");
    element.handleTriggerClick();
    await nextFrame();
    await nextFrame();
    const panel = element.shadowRoot!.querySelector<HTMLElement>(".panel")!;
    expect(panel.matches(":popover-open")).toBe(true);
    expect(getComputedStyle(panel).position).toBe("fixed");
    const rect = panel.getBoundingClientRect();
    expect(rect.bottom).toBeGreaterThan(scroller.getBoundingClientRect().bottom);
    const hit = element.shadowRoot!.elementFromPoint(rect.left + 10, rect.bottom - 10);
    expect(hit === panel || panel.contains(hit)).toBe(true);
    const previousLeft = panel.style.left;
    element.style.marginInlineStart = "30px";
    scroller.dispatchEvent(new Event("scroll"));
    expect(panel.style.left).not.toBe(previousLeft);
    element.handleTriggerClick();
    expect(panel.matches(":popover-open")).toBe(false);
    expect(removeScroll.mock.calls.some(([type]) => type === "scroll")).toBe(true);
    expect(removeResize.mock.calls.some(([type]) => type === "resize")).toBe(true);
    const closedLeft = panel.style.left;
    element.style.marginInlineStart = "60px";
    scroller.dispatchEvent(new Event("scroll"));
    expect(panel.style.left).toBe(closedLeft);
  });

  it("disconnect cancels queued opening and removes an already-open popover", async () => {
    const element = await renderPersonaPicker();
    element.handleTriggerClick();
    element.remove();
    await nextFrame();
    expect(element.open).toBe(false);
    document.body.append(element);
    await nextFrame();
    element.handleTriggerClick();
    await nextFrame();
    const panel = element.shadowRoot!.querySelector<HTMLElement>(".panel")!;
    expect(panel.matches(":popover-open")).toBe(true);
    element.remove();
    expect(element.open).toBe(false);
    expect(panel.matches(":popover-open")).toBe(false);
  });
});
