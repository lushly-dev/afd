import { afterEach, describe, expect, it, vi } from "vitest";
import { cdp, server, userEvent } from "vitest/browser";

const isChromium = server.browser === "chromium";
const isWebKit = server.browser === "webkit";
// Chromium and Firefox advance MM/DD/YYYY segments on flat digit entry; WebKit on Windows degrades
// <input type="date"> to text and Linux WebKitGTK does not auto-advance date segments on flat digits.
const supportsSegmentedDateInput =
  !isWebKit &&
  (() => {
    const probe = document.createElement("input");
    probe.type = "date";
    return probe.type === "date";
  })();

import type { VioletCalendar } from "../calendar/violet-calendar";
import "./violet-date-picker.define";
import type { VioletDatePicker } from "./violet-date-picker";

function nextFrame(): Promise<void> {
  // FAST flushes template updates in its own animation-frame batch; wait two frames so the DOM has settled.
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

async function renderDatePicker(
  configure: (picker: VioletDatePicker) => void = () => undefined,
): Promise<VioletDatePicker> {
  document.body.innerHTML = "";
  const picker = document.createElement("violet-date-picker") as VioletDatePicker;
  picker.label = "Planting date";
  picker.supportingText = "Choose when this plan should begin.";
  picker.value = "2026-03-23";
  picker.min = "2026-03-01";
  picker.max = "2026-04-15";
  configure(picker);
  document.body.append(picker);
  await customElements.whenDefined("violet-date-picker");
  await nextFrame();
  return picker;
}

async function renderInForm(
  configure: (picker: VioletDatePicker) => void = () => undefined,
): Promise<{ form: HTMLFormElement; picker: VioletDatePicker }> {
  document.body.innerHTML = "";
  const form = document.createElement("form");
  const picker = document.createElement("violet-date-picker") as VioletDatePicker;
  picker.name = "planting";
  configure(picker);
  form.append(picker);
  document.body.append(form);
  await customElements.whenDefined("violet-date-picker");
  await nextFrame();
  return { form, picker };
}

function getInput(picker: VioletDatePicker): HTMLInputElement {
  const input = picker.shadowRoot?.querySelector<HTMLInputElement>('input[type="date"]');
  if (!input) {
    throw new Error("Expected the native date input to render.");
  }
  return input;
}

function getToggle(picker: VioletDatePicker): HTMLButtonElement {
  const toggle = picker.shadowRoot?.querySelector<HTMLButtonElement>(".toggle");
  if (!toggle) {
    throw new Error("Expected the toggle button to render.");
  }
  return toggle;
}

function getPanel(picker: VioletDatePicker): HTMLElement {
  const panel = picker.shadowRoot?.querySelector<HTMLElement>(".panel");
  if (!panel) {
    throw new Error("Expected the panel to render.");
  }
  return panel;
}

function getCalendar(picker: VioletDatePicker): VioletCalendar {
  const calendar = picker.shadowRoot?.querySelector<VioletCalendar>("violet-calendar");
  if (!calendar) {
    throw new Error("Expected the calendar to render.");
  }
  return calendar;
}

function calendarDay(picker: VioletDatePicker, iso: string): HTMLButtonElement {
  const button = getCalendar(picker).shadowRoot?.querySelector<HTMLButtonElement>(
    `button[data-date="${iso}"]`,
  );
  if (!button) {
    throw new Error(`Expected calendar day ${iso} to render.`);
  }
  return button;
}

function inputKeydown(
  picker: VioletDatePicker,
  key: string,
  init: KeyboardEventInit = {},
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    composed: true,
    ...init,
  });
  getInput(picker).dispatchEvent(event);
  return event;
}

describe("violet-date-picker", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  // The input reads "" while incomplete, as the default does, so a reset must write it anyway.
  it.runIf(supportsSegmentedDateInput)("clears an incomplete entry on form reset", async () => {
    document.body.innerHTML = `<form><violet-date-picker label="Due" name="when"></violet-date-picker></form>`;
    await customElements.whenDefined("violet-date-picker");
    await nextFrame();
    const form = document.querySelector("form") as HTMLFormElement;
    const picker = document.querySelector("violet-date-picker") as HTMLElement & { value: string };
    const input = picker.shadowRoot?.querySelector("input") as HTMLInputElement;

    await userEvent.click(input, { position: { x: 8, y: input.clientHeight / 2 } });
    await userEvent.keyboard("04");
    await nextFrame();
    expect(picker.value).toBe("");
    expect(input.validity.badInput).toBe(true);

    form.reset();
    await nextFrame();

    expect(input.validity.badInput).toBe(false);
    expect(input.value).toBe("");
    expect(picker.value).toBe("");
  });

  // #712: the input reads "" while a segment is incomplete, and a :value binding wrote that "" back,
  // erasing the segments already entered.
  it.runIf(supportsSegmentedDateInput)(
    "keeps the other segments while one is re-entered",
    async () => {
      document.body.innerHTML = `<violet-date-picker label="Due" value="2026-03-15"></violet-date-picker>`;
      await customElements.whenDefined("violet-date-picker");
      await nextFrame();
      const picker = document.querySelector("violet-date-picker") as VioletDatePicker;
      const input = picker.shadowRoot?.querySelector("input") as HTMLInputElement;

      await userEvent.click(input, { position: { x: 8, y: input.clientHeight / 2 } });
      await userEvent.keyboard("{Backspace}");
      await nextFrame();
      expect(picker.value).toBe("");
      await userEvent.keyboard("04");
      await nextFrame();

      expect(input.value).toBe("2026-04-15");
      expect(picker.value).toBe("2026-04-15");
    },
  );

  it("syncs its native date input from the value property", async () => {
    const picker = await renderDatePicker();
    const input = picker.shadowRoot?.querySelector('input[type="date"]') as HTMLInputElement | null;

    expect(input?.value).toBe("2026-03-23");
  });

  it("updates from native input events", async () => {
    const picker = await renderDatePicker();
    const input = picker.shadowRoot?.querySelector('input[type="date"]') as HTMLInputElement | null;

    input!.value = "2026-03-24";
    input?.dispatchEvent(new Event("input", { bubbles: true }));
    input?.dispatchEvent(new Event("change", { bubbles: true }));
    await nextFrame();

    expect(picker.value).toBe("2026-03-24");
  });

  it("commits calendar selection and closes the popup", async () => {
    const picker = await renderDatePicker();

    picker.show();
    picker.handleCalendarChange(
      new CustomEvent("change", {
        detail: { value: "2026-03-30" },
        bubbles: true,
      }),
    );
    await nextFrame();

    expect(picker.value).toBe("2026-03-30");
    expect(picker.open).toBe(false);
  });

  describe("rendering and ARIA", () => {
    it("labels the native input and passes min and max through", async () => {
      const picker = await renderDatePicker();
      const input = getInput(picker);
      const label = picker.shadowRoot?.querySelector("label");

      expect(label?.textContent?.trim()).toBe("Planting date");
      expect(label?.getAttribute("for")).toBe(input.id);
      expect(input.min).toBe("2026-03-01");
      expect(input.max).toBe("2026-04-15");
    });

    it("links supporting and error text through aria-describedby and aria-invalid", async () => {
      const picker = await renderDatePicker();
      expect(getInput(picker).getAttribute("aria-describedby")).toBe(picker.supportingId);
      expect(getInput(picker).getAttribute("aria-invalid")).toBe("false");

      const invalid = await renderDatePicker((element) => {
        element.errorText = "Pick a Monday.";
        element.invalid = true;
      });
      const input = getInput(invalid);
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect(input.getAttribute("aria-describedby")).toBe(invalid.errorId);
      expect(invalid.shadowRoot?.getElementById(invalid.supportingId)).toBeNull();
      expect(invalid.shadowRoot?.getElementById(invalid.errorId)?.getAttribute("role")).toBe(
        "alert",
      );
      expect(invalid.shadowRoot?.getElementById(invalid.errorId)?.textContent?.trim()).toBe(
        "Pick a Monday.",
      );
    });

    it("wires the toggle button to the popup panel", async () => {
      const picker = await renderDatePicker();
      const toggle = getToggle(picker);
      const panel = getPanel(picker);

      expect(toggle.getAttribute("aria-haspopup")).toBe("dialog");
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      expect(toggle.getAttribute("aria-controls")).toBe(picker.panelId);
      expect(panel.id).toBe(picker.panelId);
      expect(panel.getAttribute("role")).toBe("dialog");
      expect(panel.getAttribute("aria-label")).toBe("Planting date calendar");
      expect(panel.hidden).toBe(true);

      picker.label = "";
      await nextFrame();
      expect(panel.getAttribute("aria-label")).toBe("Choose date");
    });

    it("changes the toggle label depending on whether a date is chosen", async () => {
      const picker = await renderDatePicker();
      expect(getToggle(picker).getAttribute("aria-label")).toBe("Change date");

      picker.value = "";
      await nextFrame();
      expect(getToggle(picker).getAttribute("aria-label")).toBe("Choose date");
    });

    it("hands value, min, max and locale to the calendar in single mode", async () => {
      const picker = await renderDatePicker((element) => {
        element.locale = "de-DE";
      });
      const calendar = getCalendar(picker);

      expect(calendar.getAttribute("selection-mode")).toBe("single");
      expect(calendar.value).toBe("2026-03-23");
      expect(calendar.min).toBe("2026-03-01");
      expect(calendar.max).toBe("2026-04-15");
      expect(calendar.locale).toBe("de-DE");
    });

    it("formats a locale-aware display value", async () => {
      const picker = await renderDatePicker();
      expect(picker.displayValue).toBe("Mar 23, 2026");

      picker.locale = "de-DE";
      expect(picker.displayValue).toBe("23.03.2026");

      picker.value = "";
      expect(picker.displayValue).toBe("");
    });
  });

  describe("popup", () => {
    it("does not emit open-change or take focus when it connects, open or closed", async () => {
      document.body.innerHTML = "";
      const events: boolean[] = [];
      document.body.addEventListener("open-change", (event) =>
        events.push((event as CustomEvent<{ open: boolean }>).detail.open),
      );
      for (const open of [false, true]) {
        const picker = document.createElement("violet-date-picker") as VioletDatePicker;
        picker.label = "Planting window";
        picker.open = open;
        document.body.append(picker);
        await customElements.whenDefined("violet-date-picker");
        await nextFrame();
        await nextFrame();
        expect(getPanel(picker).hidden).toBe(!open);
        expect(picker.matches(":focus-within")).toBe(false);
        picker.remove();
      }
      expect(events).toEqual([]);
    });

    it("opens and closes, updating aria-expanded, the panel and emitting open-change", async () => {
      const picker = await renderDatePicker();
      const handler = vi.fn();
      picker.addEventListener("open-change", handler);

      picker.show();
      await nextFrame();
      expect(picker.open).toBe(true);
      expect(getPanel(picker).hidden).toBe(false);
      expect(getToggle(picker).getAttribute("aria-expanded")).toBe("true");
      expect(picker.shadowRoot?.querySelector(".control-shell")?.classList.contains("open")).toBe(
        true,
      );

      picker.hide();
      await nextFrame();
      expect(picker.open).toBe(false);
      expect(getPanel(picker).hidden).toBe(true);
      expect(getToggle(picker).getAttribute("aria-expanded")).toBe("false");

      expect(handler.mock.calls.map(([event]) => (event as CustomEvent).detail)).toEqual([
        { open: true },
        { open: false },
      ]);
    });

    it("toggles from the calendar button", async () => {
      const picker = await renderDatePicker();

      getToggle(picker).click();
      await nextFrame();
      expect(picker.open).toBe(true);

      getToggle(picker).click();
      await nextFrame();
      expect(picker.open).toBe(false);
    });

    it("moves focus to the tabbable calendar day when opened", async () => {
      const picker = await renderDatePicker();

      picker.show();

      await vi.waitFor(() => {
        expect(getCalendar(picker).shadowRoot?.activeElement?.getAttribute("data-date")).toBe(
          "2026-03-23",
        );
      });
    });

    it("opens with Alt+ArrowDown, leaves plain ArrowDown for segment editing, and closes with Escape from the input", async () => {
      const picker = await renderDatePicker();

      expect(inputKeydown(picker, "ArrowDown").defaultPrevented).toBe(false);
      await nextFrame();
      expect(picker.open).toBe(false);

      expect(inputKeydown(picker, "ArrowDown", { altKey: true }).defaultPrevented).toBe(true);
      await nextFrame();
      expect(picker.open).toBe(true);

      expect(inputKeydown(picker, "Escape").defaultPrevented).toBe(true);
      await nextFrame();
      expect(picker.open).toBe(false);
    });

    it("ignores Escape while closed", async () => {
      const picker = await renderDatePicker();
      const handler = vi.fn();
      picker.addEventListener("open-change", handler);

      inputKeydown(picker, "Escape");
      await nextFrame();

      expect(picker.open).toBe(false);
      expect(handler).not.toHaveBeenCalled();
    });

    it("closes with Escape from calendar focus and returns focus to the input", async () => {
      const picker = await renderDatePicker();
      const outer = vi.fn();
      document.body.addEventListener("keydown", outer);

      picker.show();
      await vi.waitFor(() => {
        expect(getCalendar(picker).shadowRoot?.activeElement?.getAttribute("data-date")).toBe(
          "2026-03-23",
        );
      });

      await userEvent.keyboard("{Escape}");
      await nextFrame();

      expect(picker.open).toBe(false);
      expect(picker.value).toBe("2026-03-23");
      expect(picker.shadowRoot?.activeElement).toBe(getInput(picker));
      // A handled Escape must not reach an enclosing dialog.
      expect(outer.mock.calls.some(([e]) => (e as KeyboardEvent).key === "Escape")).toBe(false);
      document.body.removeEventListener("keydown", outer);
    });

    it("lets Escape propagate when the popup is closed", async () => {
      const picker = await renderDatePicker();
      const outer = vi.fn();
      document.body.addEventListener("keydown", outer);

      const panel = getPanel(picker);
      const event = new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        composed: true,
        cancelable: true,
      });
      panel.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
      expect(outer).toHaveBeenCalledTimes(1);
      document.body.removeEventListener("keydown", outer);
    });

    it("does not open when disabled", async () => {
      const picker = await renderDatePicker((element) => {
        element.disabled = true;
      });

      picker.show();
      picker.toggleOpen();
      inputKeydown(picker, "ArrowDown", { altKey: true });
      await nextFrame();

      expect(picker.open).toBe(false);
      expect(getInput(picker).disabled).toBe(true);
      expect(getToggle(picker).disabled).toBe(true);
    });

    it("closes when the pointer goes down outside and stays open for presses inside", async () => {
      const picker = await renderDatePicker();
      picker.show();
      await nextFrame();

      getInput(picker).dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, composed: true }),
      );
      expect(picker.open).toBe(true);

      document.body.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, composed: true }),
      );
      expect(picker.open).toBe(false);
    });

    it("closes when Tab moves focus out of the open calendar", async () => {
      const picker = await renderDatePicker();
      const after = document.createElement("button");
      after.textContent = "Next field";
      document.body.append(after);

      picker.show();
      await vi.waitFor(() => {
        expect(getCalendar(picker).shadowRoot?.activeElement?.getAttribute("data-date")).toBe(
          "2026-03-23",
        );
      });

      await userEvent.tab();
      await nextFrame();

      expect(document.activeElement).toBe(after);
      expect(picker.open).toBe(false);
      expect(getPanel(picker).hidden).toBe(true);
      expect(getToggle(picker).getAttribute("aria-expanded")).toBe("false");
    });

    it("closes when focus leaves from the input or toggle, and stays open while it moves inside", async () => {
      const picker = await renderDatePicker();
      const after = document.createElement("input");
      document.body.append(after);

      picker.show();
      await vi.waitFor(() => {
        expect(getCalendar(picker).shadowRoot?.activeElement?.getAttribute("data-date")).toBe(
          "2026-03-23",
        );
      });

      getInput(picker).focus();
      getToggle(picker).focus();
      calendarDay(picker, "2026-03-24").focus();
      await nextFrame();
      expect(picker.open).toBe(true);

      getToggle(picker).focus();
      after.focus();
      await nextFrame();
      expect(picker.open).toBe(false);
    });

    describe("inside a focusable ancestor", () => {
      // Pressing a non-focusable part of the panel moves focus to the nearest focusable
      // ancestor, which is outside the picker; that is not focus leaving it.
      async function renderInside(host: HTMLElement): Promise<VioletDatePicker> {
        document.body.innerHTML = "";
        const picker = document.createElement("violet-date-picker") as VioletDatePicker;
        picker.label = "Planting date";
        picker.value = "2026-03-23";
        picker.min = "2026-03-10";
        picker.max = "2026-03-28";
        host.prepend(picker);
        document.body.append(host);
        await customElements.whenDefined("violet-date-picker");
        await nextFrame();
        return picker;
      }

      async function openAndExpectCalendarFocus(picker: VioletDatePicker): Promise<void> {
        picker.show();
        await vi.waitFor(() => {
          expect(getCalendar(picker).shadowRoot?.activeElement?.getAttribute("data-date")).toBe(
            "2026-03-23",
          );
        });
      }

      function heading(picker: VioletDatePicker): HTMLElement {
        const element = getCalendar(picker).shadowRoot?.querySelector<HTMLElement>(".heading");
        if (!element) {
          throw new Error("Expected the calendar heading to render.");
        }
        return element;
      }

      type Press = (element: HTMLElement) => Promise<void>;

      const click: Press = async (element) => {
        await userEvent.click(element, { force: true });
      };

      /**
       * A real touch tap through the Chrome DevTools Protocol. A tap fires pointerdown and
       * pointerup first, then the compatibility mousedown that moves focus, then click (none
       * on a disabled button). userEvent.click is mouse-only and never shows that order.
       */
      const tap: Press = async (element) => {
        const rect = element.getBoundingClientRect();
        const frame = window.frameElement?.getBoundingClientRect();
        const scale = frame ? frame.width / window.innerWidth : 1;
        const x = (frame?.left ?? 0) + (rect.left + rect.width / 2) * scale;
        const y = (frame?.top ?? 0) + (rect.top + rect.height / 2) * scale;
        const types = ["pointerdown", "pointerup", "mousedown", "click"];
        const seen: string[] = [];
        const record = (event: Event) => seen.push(event.type);
        for (const type of types) {
          document.addEventListener(type, record, true);
        }
        const session = cdp();
        await session.send("Emulation.setTouchEmulationEnabled", {
          enabled: true,
          maxTouchPoints: 1,
        });
        try {
          await session.send("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [{ x, y }],
          });
          await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
          if ((element as HTMLButtonElement).disabled) {
            // A disabled button gets no compatibility click; wait the tap out.
            await new Promise((resolve) => setTimeout(resolve, 150));
          } else {
            await vi.waitFor(() => expect(seen).toEqual(types));
          }
          await nextFrame();
          // The tap order that matters: focus moves after pointerup.
          expect(seen.slice(0, 2)).toEqual(["pointerdown", "pointerup"]);
        } finally {
          for (const type of types) {
            document.removeEventListener(type, record, true);
          }
          await session.send("Emulation.setTouchEmulationEnabled", { enabled: false });
        }
      };

      async function expectPressesKeepItOpen(
        picker: VioletDatePicker,
        press: Press = click,
      ): Promise<void> {
        await openAndExpectCalendarFocus(picker);

        await press(heading(picker));
        await nextFrame();
        expect(picker.open).toBe(true);

        const disabledDay = calendarDay(picker, "2026-03-05");
        expect(disabledDay.disabled).toBe(true);
        await press(disabledDay);
        await nextFrame();
        expect(picker.open).toBe(true);
        expect(picker.value).toBe("2026-03-23");
      }

      const presses: Array<{ input: string; press: Press }> = [
        { input: "mouse click", press: click },
        ...(isChromium ? [{ input: "touch tap", press: tap }] : []),
      ];

      it.each(presses)(
        "stays open for a $input on the heading and a disabled day in a tabindex=-1 wrapper",
        async ({ press }) => {
          const wrapper = document.createElement("div");
          wrapper.tabIndex = -1;
          const picker = await renderInside(wrapper);

          await expectPressesKeepItOpen(picker, press);
        },
      );

      it.each(presses)(
        "stays open for a $input on the heading and a disabled day in a scrolling violet-dialog",
        async ({ press }) => {
          await import("../dialog/violet-dialog.define");
          const dialog = document.createElement("violet-dialog") as HTMLElement & {
            show(): void;
            bodyScrollable: boolean;
          };
          const tall = document.createElement("div");
          tall.style.blockSize = "2000px";
          dialog.append(tall);
          const picker = await renderInside(dialog);
          await customElements.whenDefined("violet-dialog");
          dialog.show();
          await vi.waitFor(() => expect(dialog.bodyScrollable).toBe(true));

          await expectPressesKeepItOpen(picker, press);
        },
      );

      it.runIf(isChromium)(
        "still closes on Shift+Tab after a tap on a disabled day, which sends no click",
        async () => {
          const wrapper = document.createElement("div");
          wrapper.tabIndex = 0;
          wrapper.setAttribute("aria-label", "Form");
          const picker = await renderInside(wrapper);
          await openAndExpectCalendarFocus(picker);

          await tap(calendarDay(picker, "2026-03-05"));
          expect(picker.open).toBe(true);

          getInput(picker).focus();
          await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
          await nextFrame();

          expect(document.activeElement).toBe(wrapper);
          expect(picker.open).toBe(false);
        },
      );

      it("still closes on Shift+Tab onto a focusable ancestor", async () => {
        const wrapper = document.createElement("div");
        wrapper.tabIndex = 0;
        wrapper.setAttribute("aria-label", "Form");
        const picker = await renderInside(wrapper);
        await openAndExpectCalendarFocus(picker);

        getInput(picker).focus();
        await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
        await nextFrame();

        expect(document.activeElement).toBe(wrapper);
        expect(picker.open).toBe(false);
      });
    });

    it("stays open when focus leaves the window rather than moving elsewhere on the page", async () => {
      const picker = await renderDatePicker();
      picker.show();
      await nextFrame();

      getInput(picker).dispatchEvent(
        new FocusEvent("focusout", { bubbles: true, composed: true, relatedTarget: null }),
      );

      expect(picker.open).toBe(true);
    });

    it("stops reacting to outside presses once removed from the document", async () => {
      const picker = await renderDatePicker();
      picker.show();
      picker.remove();

      document.body.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, composed: true }),
      );

      expect(picker.open).toBe(true);
    });

    it("positions the panel next to the control frame", async () => {
      const picker = await renderDatePicker();
      picker.show();
      await nextFrame();

      const frame = picker.shadowRoot?.querySelector(".control-frame")?.getBoundingClientRect();
      expect(Number.parseFloat(getPanel(picker).style.inlineSize)).toBeGreaterThanOrEqual(
        Math.max(frame?.width ?? 0, 280),
      );
      expect(getPanel(picker).style.top).not.toBe("");
      expect(getPanel(picker).style.left).not.toBe("");
    });

    it("opens in the top layer under its field and receives pointer clicks inside a contained, transformed, clipping ancestor", async () => {
      document.body.innerHTML = "";
      const container = document.createElement("div");
      container.style.cssText =
        "position: relative; margin: 120px 0 0 32px; padding: 16px; contain: content; transform: translate(16px, 24px); overflow: hidden; block-size: 96px; inline-size: 260px;";
      const picker = document.createElement("violet-date-picker") as VioletDatePicker;
      picker.label = "Planting date";
      picker.value = "2026-03-23";
      picker.min = "2026-03-01";
      picker.max = "2026-04-15";
      container.append(picker);
      document.body.append(container);
      await customElements.whenDefined("violet-date-picker");
      await nextFrame();

      picker.show();
      await nextFrame();

      const panel = getPanel(picker);
      const frameRect = picker.shadowRoot!.querySelector(".control-frame")!.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();

      expect(Math.abs(panelRect.top - (frameRect.bottom + 4))).toBeLessThanOrEqual(2);
      expect(Math.abs(panelRect.left - frameRect.left)).toBeLessThanOrEqual(2);
      expect(panelRect.bottom).toBeGreaterThan(containerRect.bottom);
      expect(panel.getAttribute("popover")).toBe("manual");
      expect(panel.matches(":popover-open")).toBe(true);

      await userEvent.click(calendarDay(picker, "2026-03-25"));
      await nextFrame();

      expect(picker.value).toBe("2026-03-25");
      expect(picker.open).toBe(false);
      expect(panel.matches(":popover-open")).toBe(false);
      expect(panel.hidden).toBe(true);
    });

    it("defers top-layer promotion for an initially open picker inside a closed violet-dialog until the dialog opens", async () => {
      await import("../dialog/violet-dialog.define");
      document.body.innerHTML = "";
      const openButton = document.createElement("button");
      openButton.textContent = "Open dialog";
      const dialog = document.createElement("violet-dialog") as HTMLElement & {
        show(): void;
        hide(): void;
      };
      openButton.addEventListener("click", () => dialog.show());
      const picker = document.createElement("violet-date-picker") as VioletDatePicker;
      picker.label = "Planting date";
      picker.value = "2026-03-23";
      picker.min = "2026-03-01";
      picker.max = "2026-04-15";
      picker.open = true;
      dialog.append(picker);
      document.body.append(openButton, dialog);
      await customElements.whenDefined("violet-dialog");
      await customElements.whenDefined("violet-date-picker");
      await nextFrame();

      const panel = getPanel(picker);
      expect(panel.matches(":popover-open")).toBe(false);
      expect(panel.hidden).toBe(true);

      // Clicking the trigger fires a capture-phase outside pointerdown before opening the dialog.
      await userEvent.click(openButton);
      await nextFrame();

      const frameRect = picker.shadowRoot!.querySelector(".control-frame")!.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      expect(picker.open).toBe(true);
      expect(panel.matches(":popover-open")).toBe(true);
      expect(Math.abs(panelRect.top - (frameRect.bottom + 4))).toBeLessThanOrEqual(2);
      expect(Math.abs(panelRect.left - frameRect.left)).toBeLessThanOrEqual(2);

      // Closing and reopening the dialog hides and re-promotes the open picker cleanly.
      dialog.hide();
      await nextFrame();
      expect(picker.open).toBe(true);
      expect(panel.matches(":popover-open")).toBe(false);
      expect(panel.hidden).toBe(true);

      dialog.show();
      await nextFrame();
      expect(panel.matches(":popover-open")).toBe(true);

      await userEvent.click(calendarDay(picker, "2026-03-25"));
      await nextFrame();

      expect(picker.value).toBe("2026-03-25");
      expect(picker.open).toBe(false);
      expect(panel.matches(":popover-open")).toBe(false);
    });

    it("defers top-layer promotion inside a closed native dialog until showModal() and hides on close()", async () => {
      document.body.innerHTML = "";
      const dialog = document.createElement("dialog");
      dialog.style.cssText = "margin: 40px 0 0 24px; inline-size: 320px;";
      const picker = document.createElement("violet-date-picker") as VioletDatePicker;
      picker.label = "Planting date";
      picker.value = "2026-03-23";
      picker.min = "2026-03-01";
      picker.max = "2026-04-15";
      picker.open = true;
      dialog.append(picker);
      document.body.append(dialog);
      await customElements.whenDefined("violet-date-picker");
      await nextFrame();

      const panel = getPanel(picker);
      expect(panel.matches(":popover-open")).toBe(false);
      expect(panel.hidden).toBe(true);

      dialog.showModal();
      await nextFrame();

      expect(panel.matches(":popover-open")).toBe(true);
      const frameRect = picker.shadowRoot!.querySelector(".control-frame")!.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      expect(Math.abs(panelRect.top - (frameRect.bottom + 4))).toBeLessThanOrEqual(2);
      expect(Math.abs(panelRect.left - frameRect.left)).toBeLessThanOrEqual(2);

      dialog.close();
      await nextFrame();
      expect(panel.matches(":popover-open")).toBe(false);
      expect(panel.hidden).toBe(true);

      dialog.showModal();
      await nextFrame();
      await userEvent.click(calendarDay(picker, "2026-03-25"));
      await nextFrame();

      expect(picker.value).toBe("2026-03-25");
      expect(picker.open).toBe(false);
    });

    it("re-promotes an open panel to the top layer when reconnected", async () => {
      const picker = await renderDatePicker();
      picker.show();
      await nextFrame();
      const panel = getPanel(picker);
      expect(panel.matches(":popover-open")).toBe(true);

      picker.remove();
      expect(panel.matches(":popover-open")).toBe(false);

      const events: boolean[] = [];
      picker.addEventListener("open-change", (event) =>
        events.push((event as CustomEvent<{ open: boolean }>).detail.open),
      );
      document.body.append(picker);
      await nextFrame();

      expect(picker.open).toBe(true);
      expect(panel.matches(":popover-open")).toBe(true);
      expect(events).toEqual([]);
    });
  });

  describe("selection", () => {
    it("selects a day clicked in the calendar, closes and returns focus to the input", async () => {
      const picker = await renderDatePicker();
      picker.show();
      await nextFrame();

      calendarDay(picker, "2026-03-25").click();
      await nextFrame();

      expect(picker.value).toBe("2026-03-25");
      expect(getInput(picker).value).toBe("2026-03-25");
      expect(picker.open).toBe(false);
      expect(picker.shadowRoot?.activeElement).toBe(getInput(picker));
    });

    it("emits exactly one change with the chosen value and swallows the calendar change event", async () => {
      const picker = await renderDatePicker();
      const input = vi.fn();
      const change = vi.fn();
      picker.addEventListener("input", input);
      picker.addEventListener("change", change);
      picker.show();
      await nextFrame();

      calendarDay(picker, "2026-03-25").click();
      await nextFrame();

      expect(change).toHaveBeenCalledTimes(1);
      expect((change.mock.calls[0]![0] as CustomEvent).detail).toEqual({ value: "2026-03-25" });
      const inputDetails = input.mock.calls.map(([event]) => (event as CustomEvent).detail);
      expect(inputDetails).toContainEqual({ value: "2026-03-25" });
    });

    it("emits exactly one input event when a calendar day is chosen", async () => {
      const picker = await renderDatePicker();
      const input = vi.fn();
      picker.addEventListener("input", input);
      picker.show();
      await nextFrame();

      calendarDay(picker, "2026-03-25").click();
      await nextFrame();

      expect(input).toHaveBeenCalledTimes(1);
    });

    it("disables calendar days outside min and max", async () => {
      const picker = await renderDatePicker((element) => {
        element.min = "2026-03-10";
        element.max = "2026-03-20";
      });
      picker.show();
      await nextFrame();

      expect(calendarDay(picker, "2026-03-10").disabled).toBe(false);
      expect(calendarDay(picker, "2026-03-20").disabled).toBe(false);
      expect(calendarDay(picker, "2026-03-09").disabled).toBe(true);
      expect(calendarDay(picker, "2026-03-21").disabled).toBe(true);
    });

    it("does not commit a day outside min and max clicked in the calendar", async () => {
      const picker = await renderDatePicker((element) => {
        element.min = "2026-03-10";
        element.max = "2026-03-20";
      });
      const handler = vi.fn();
      picker.addEventListener("change", handler);
      picker.show();
      await nextFrame();

      calendarDay(picker, "2026-03-25").click();
      await nextFrame();

      expect(picker.value).toBe("2026-03-23");
      expect(handler).not.toHaveBeenCalled();
      expect(picker.open).toBe(true);
    });

    it("ignores calendar changes without a value", async () => {
      const picker = await renderDatePicker();
      const handler = vi.fn();
      picker.addEventListener("change", handler);
      picker.show();

      picker.handleCalendarChange(new CustomEvent("change", { detail: {}, bubbles: true }));

      expect(picker.value).toBe("2026-03-23");
      expect(picker.open).toBe(true);
      expect(handler).not.toHaveBeenCalled();
    });

    it("emits input then change with the typed value from the native input", async () => {
      const picker = await renderDatePicker();
      const input = vi.fn();
      const change = vi.fn();
      picker.addEventListener("input", input);
      picker.addEventListener("change", change);
      const native = getInput(picker);

      native.value = "2026-04-02";
      native.dispatchEvent(new Event("input", { bubbles: true }));
      native.dispatchEvent(new Event("change", { bubbles: true }));

      const details = (mock: ReturnType<typeof vi.fn>) =>
        mock.mock.calls.map(([event]) => (event as CustomEvent).detail).filter(Boolean);
      expect(details(input)).toEqual([{ value: "2026-04-02" }]);
      expect(details(change)).toEqual([{ value: "2026-04-02" }]);
    });

    it("clears the value when the native input is emptied", async () => {
      const picker = await renderDatePicker();
      const native = getInput(picker);

      native.value = "";
      native.dispatchEvent(new Event("input", { bubbles: true }));
      native.dispatchEvent(new Event("change", { bubbles: true }));

      await nextFrame();

      expect(picker.value).toBe("");
      expect(getToggle(picker).getAttribute("aria-label")).toBe("Choose date");
    });

    it("pushes programmatic value changes back into the native input", async () => {
      const picker = await renderDatePicker();

      picker.value = "2026-04-10";
      expect(getInput(picker).value).toBe("2026-04-10");

      picker.value = "";
      expect(getInput(picker).value).toBe("");
    });

    it.runIf(supportsSegmentedDateInput)(
      "lets a real keyboard type a date into the native input",
      async () => {
        const picker = await renderDatePicker((element) => {
          element.value = "";
          element.min = "";
          element.max = "";
          element.locale = "en-US";
        });
        getInput(picker).focus();

        await userEvent.keyboard("04152026");

        await vi.waitFor(() => expect(picker.value).toBe("2026-04-15"));
      },
    );
  });

  describe("form participation", () => {
    it("is form associated and reports its form", async () => {
      const { form, picker } = await renderInForm();

      expect(picker.form).toBe(form);
      expect(picker.willValidate).toBe(true);
    });

    it("submits its value under its name and omits it when empty", async () => {
      const { form, picker } = await renderInForm();
      expect(new FormData(form).has("planting")).toBe(false);

      picker.value = "2026-03-23";

      expect(new FormData(form).get("planting")).toBe("2026-03-23");

      picker.value = "";
      expect(new FormData(form).has("planting")).toBe(false);
    });

    it("submits a value chosen in the calendar", async () => {
      const { form, picker } = await renderInForm();
      picker.show();
      await nextFrame();
      const calendar = getCalendar(picker);
      const today = new Date();
      const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-15`;

      calendar.shadowRoot?.querySelector<HTMLButtonElement>(`button[data-date="${iso}"]`)?.click();
      await nextFrame();

      expect(new FormData(form).get("planting")).toBe(iso);
    });

    it("is valueMissing when required and empty, then valid once a date is set", async () => {
      const { form, picker } = await renderInForm((element) => {
        element.required = true;
      });

      expect(picker.validity.valueMissing).toBe(true);
      expect(picker.validationMessage).toBe("Please choose a date.");
      expect(picker.checkValidity()).toBe(false);
      expect(form.checkValidity()).toBe(false);

      picker.value = "2026-03-23";

      expect(picker.validity.valid).toBe(true);
      expect(picker.checkValidity()).toBe(true);
      expect(form.checkValidity()).toBe(true);
    });

    it("raises a custom error with the supplied error text when invalid", async () => {
      const { picker } = await renderInForm((element) => {
        element.value = "2026-03-23";
        element.invalid = true;
        element.errorText = "Not a planting day.";
      });

      expect(picker.validity.customError).toBe(true);
      expect(picker.validationMessage).toBe("Not a planting day.");
      expect(picker.checkValidity()).toBe(false);

      picker.invalid = false;
      expect(picker.validity.customError).toBe(false);
    });

    it("refreshes the validation message when error text changes after invalid is set", async () => {
      const { picker } = await renderInForm((element) => {
        element.invalid = true;
      });

      picker.errorText = "Not a planting day.";

      expect(picker.validationMessage).toBe("Not a planting day.");
    });

    it("falls back to a default message for invalid without error text", async () => {
      const { picker } = await renderInForm((element) => {
        element.invalid = true;
      });

      expect(picker.validationMessage).toBe("Select a valid date.");
    });

    it("reports badInput for a value that is not a real calendar date", async () => {
      const { picker } = await renderInForm();

      picker.value = "2026-02-31";

      expect(picker.validity.badInput).toBe(true);
      expect(picker.validationMessage).toBe("Enter a valid date.");

      picker.value = "2026-02-28";
      expect(picker.validity.valid).toBe(true);
    });

    it("reports rangeUnderflow and rangeOverflow for values outside min and max", async () => {
      const { picker } = await renderInForm((element) => {
        element.min = "2026-03-01";
        element.max = "2026-04-15";
      });

      picker.value = "2026-02-01";
      expect(picker.validity.rangeUnderflow).toBe(true);

      picker.value = "2026-05-01";
      expect(picker.validity.rangeOverflow).toBe(true);
    });

    it("restores the initial value on form reset", async () => {
      const { form, picker } = await renderInForm((element) => {
        element.value = "2026-03-23";
      });
      picker.value = "2026-04-02";
      expect(new FormData(form).get("planting")).toBe("2026-04-02");

      form.reset();
      await nextFrame();

      expect(picker.value).toBe("2026-03-23");
      expect(getInput(picker).value).toBe("2026-03-23");
      expect(new FormData(form).get("planting")).toBe("2026-03-23");
    });

    it("clears to empty on form reset when it started empty", async () => {
      const { form, picker } = await renderInForm();
      picker.value = "2026-04-02";

      form.reset();
      await nextFrame();

      expect(picker.value).toBe("");
      expect(new FormData(form).has("planting")).toBe(false);
    });
  });

  describe("native key handling", () => {
    it("does not cancel typing, Tab or arrow keys inside the native input", async () => {
      const picker = await renderDatePicker();

      for (const key of [
        "1",
        "Tab",
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Backspace",
      ]) {
        expect(inputKeydown(picker, key).defaultPrevented, key).toBe(false);
      }
      expect(picker.open).toBe(false);
    });

    it("does not cancel Escape while closed", async () => {
      const picker = await renderDatePicker();

      expect(inputKeydown(picker, "Escape").defaultPrevented).toBe(false);
    });

    it("still cancels Alt+ArrowDown and opens the panel", async () => {
      const picker = await renderDatePicker();

      expect(inputKeydown(picker, "ArrowDown", { altKey: true }).defaultPrevented).toBe(true);
      expect(picker.open).toBe(true);
    });
  });
});
