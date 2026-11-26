import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";

import "../color-picker/violet-color-picker.define";
import "../combobox/violet-combobox.define";
import "../date-picker/violet-date-picker.define";
import "../date-range-picker/violet-date-range-picker.define";
import "../dialog/violet-dialog.define";
import "../file-upload/violet-file-upload.define";
import "../segment/violet-segment.define";
import "../segmented-control/violet-segmented-control.define";
import "../slider/violet-range-slider.define";
import "../slider/violet-slider.define";
import "../text-area/violet-text-area.define";
import "../text-field/violet-text-field.define";
import "../time-picker/violet-time-picker.define";

// What an application may rely on from a form control's host, without reaching into its shadow root:
// `focus()` reaches the control, a `value` write reaches what the person sees, and each edit reaches
// the host as one `input` event, the element's own, carrying the new value.

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

async function settle(): Promise<void> {
  await nextFrame();
  await nextFrame();
}

/** The focused element, descending through open shadow roots. */
function deepActiveElement(): Element | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) {
    active = active.shadowRoot.activeElement;
  }
  return active;
}

async function mount<T extends HTMLElement>(markup: string): Promise<T> {
  document.body.innerHTML = markup;
  const host = document.body.firstElementChild as T;
  await customElements.whenDefined(host.localName);
  await settle();
  return host;
}

function inner<T extends Element>(host: Element, selector: string): T {
  const element = host.shadowRoot?.querySelector<T>(selector);
  if (!element) {
    throw new Error(`${host.localName} did not render ${selector}`);
  }
  return element;
}

afterEach(() => {
  document.body.innerHTML = "";
});

interface Control {
  tag: string;
  markup: string;
  /** The element host `focus()` must reach. */
  focusTarget: (host: HTMLElement) => Element;
  /** The native control whose `input` event the host re-emits, and a value to enter. */
  edit?: { control: string; value: string };
}

const controls: Control[] = [
  {
    tag: "violet-text-field",
    markup: `<violet-text-field label="Name"></violet-text-field>`,
    focusTarget: (host) => inner(host, "input"),
    edit: { control: "input", value: "Basil" },
  },
  {
    tag: "violet-text-area",
    markup: `<violet-text-area label="Notes"></violet-text-area>`,
    focusTarget: (host) => inner(host, "textarea"),
    edit: { control: "textarea", value: "Water weekly" },
  },
  {
    tag: "violet-date-picker",
    markup: `<violet-date-picker label="Sown"></violet-date-picker>`,
    focusTarget: (host) => inner(host, '[part~="input"]'),
    edit: { control: '[part~="input"]', value: "2026-03-02" },
  },
  {
    tag: "violet-time-picker",
    markup: `<violet-time-picker label="Reminder"></violet-time-picker>`,
    focusTarget: (host) => inner(host, '[part~="input"]'),
    edit: { control: '[part~="input"]', value: "09:30" },
  },
  {
    tag: "violet-date-range-picker",
    markup: `<violet-date-range-picker label="Season"></violet-date-range-picker>`,
    focusTarget: (host) => host.shadowRoot?.querySelector("input, button, [tabindex]") as Element,
  },
  {
    tag: "violet-slider",
    markup: `<violet-slider label="Spacing" min="0" max="10" value="2"></violet-slider>`,
    focusTarget: (host) => inner(host, '[part~="input"]'),
    edit: { control: '[part~="input"]', value: "5" },
  },
  {
    tag: "violet-range-slider",
    markup: `<violet-range-slider label="Height" min="0" max="10" value-start="2" value-end="8"></violet-range-slider>`,
    focusTarget: (host) => inner(host, '[part~="input-start"]'),
    edit: { control: '[part~="input-start"]', value: "3" },
  },
  {
    tag: "violet-color-picker",
    markup: `<violet-color-picker label="Bed colour" value="#1670ca"></violet-color-picker>`,
    focusTarget: (host) => host.shadowRoot?.querySelector("input, button") as Element,
    edit: { control: '[part~="hex-input"]', value: "#2e7d32" },
  },
  {
    tag: "violet-combobox",
    markup: `<violet-combobox label="Plant"></violet-combobox>`,
    focusTarget: (host) => inner(host, '[part~="input"]'),
    edit: { control: '[part~="input"]', value: "Tom" },
  },
  {
    tag: "violet-file-upload",
    markup: `<violet-file-upload label="Photo"></violet-file-upload>`,
    focusTarget: (host) => inner(inner(host, '[part~="browse-button"]'), "button"),
  },
  {
    tag: "violet-segmented-control",
    markup: `<violet-segmented-control label="View" value="week"><violet-segment value="day">Day</violet-segment><violet-segment value="week">Week</violet-segment></violet-segmented-control>`,
    focusTarget: (host) =>
      inner(host.querySelector('violet-segment[value="week"]') as Element, "button"),
  },
];

describe("form control hosts", () => {
  for (const control of controls) {
    describe(control.tag, () => {
      it("moves focus to its control when the host is focused", async () => {
        const host = await mount<HTMLElement>(control.markup);
        const target = control.focusTarget(host);
        expect(target).toBeTruthy();

        host.focus();

        expect(deepActiveElement()).toBe(target);
      });

      const edit = control.edit;
      if (edit) {
        it("delivers one input event per edit, its own, carrying the value", async () => {
          const host = await mount<HTMLElement>(control.markup);
          const received: Event[] = [];
          host.addEventListener("input", (event) => received.push(event));

          const native = inner<HTMLInputElement>(host, edit.control);
          native.value = edit.value;
          native.dispatchEvent(new Event("input", { bubbles: true, composed: true }));

          expect(received).toHaveLength(1);
          expect(received[0]).toBeInstanceOf(CustomEvent);
          expect((received[0] as CustomEvent).detail).toBeTruthy();
        });
      }
    });
  }

  it("delivers one input event per keystroke from a real person typing", async () => {
    const host = await mount<HTMLElement & { value: string }>(
      `<violet-text-field label="Name"></violet-text-field>`,
    );
    const received: Array<{ value?: string }> = [];
    host.addEventListener("input", (event: Event) => received.push((event as CustomEvent).detail));

    await userEvent.type(inner(host, "input"), "Ba");

    expect(received).toEqual([{ value: "B" }, { value: "Ba" }]);
  });

  // A failed submission focuses the control's validation anchor, so the anchor must be what a person can use.
  for (const [markup, focusTarget] of [
    [
      `<violet-file-upload label="Photo" name="photo" required></violet-file-upload>`,
      (host: HTMLElement) => inner(inner(host, '[part~="browse-button"]'), "button"),
    ],
    [
      `<violet-segmented-control label="View" name="view" required><violet-segment value="day">Day</violet-segment><violet-segment value="week">Week</violet-segment></violet-segmented-control>`,
      (host: HTMLElement) =>
        inner(host.querySelector('violet-segment[value="day"]') as Element, "button"),
    ],
  ] as const) {
    const tag = markup.slice(1, markup.indexOf(" "));
    it(`${tag} takes focus on a failed form submission`, async () => {
      document.body.innerHTML = `<form><button type="button">Before</button>${markup}<button>Save</button></form>`;
      await customElements.whenDefined(tag);
      await settle();
      const form = document.querySelector("form") as HTMLFormElement;
      const host = form.querySelector(tag) as HTMLElement;
      form.querySelector("button")?.focus();

      form.requestSubmit();

      expect(deepActiveElement()).toBe(focusTarget(host));
    });
  }

  it("moves focus to a field focused when its dialog opens", async () => {
    document.body.innerHTML = `<button type="button">Edit</button><violet-dialog><span slot="title">Edit bed</span><violet-date-picker label="Sown"></violet-date-picker></violet-dialog>`;
    await customElements.whenDefined("violet-dialog");
    await settle();
    const dialog = document.querySelector("violet-dialog") as HTMLElement & { show(): void };
    const field = document.querySelector("violet-date-picker") as HTMLElement;
    document.querySelector("button")?.focus();
    dialog.addEventListener("open-change", () => field.focus());

    dialog.show();
    await settle();

    expect(deepActiveElement()).toBe(inner(field, '[part~="input"]'));
  });

  for (const [tag, selector] of [
    ["violet-text-field", "input"],
    ["violet-text-area", "textarea"],
  ] as const) {
    it(`${tag} shows a value written to the host after the person typed`, async () => {
      const host = await mount<HTMLElement & { value: string }>(`<${tag} label="Search"></${tag}>`);
      const native = inner<HTMLInputElement>(host, selector);

      await userEvent.type(native, "tomato");
      host.value = "";
      await settle();

      expect(native.value).toBe("");
    });
  }

  it("violet-date-picker shows a value written to the host", async () => {
    const host = await mount<HTMLElement & { value: string }>(
      `<violet-date-picker label="Sown" value="2026-03-01"></violet-date-picker>`,
    );

    host.value = "";
    await settle();

    expect(inner<HTMLInputElement>(host, '[part~="input"]').value).toBe("");
  });
});
