import { afterEach, describe, expect, it } from "vitest";
import { cdp, server } from "vitest/browser";

const isChromium = server.browser === "chromium";

import "../color-picker/violet-color-picker.define";
import "../combobox/violet-combobox.define";
import "../data-grid/violet-data-grid-pill-select.define";
import "../date-picker/violet-date-picker.define";
import "../date-range-picker/violet-date-range-picker.define";
import "../file-upload/violet-file-upload.define";
import "../option/violet-option.define";
import "../radio-group/violet-radio-group.define";
import "../radio/violet-radio.define";
import "../segment/violet-segment.define";
import "../segmented-control/violet-segmented-control.define";
import "../select/violet-select.define";
import "../slider/violet-range-slider.define";
import "../slider/violet-slider.define";
import "../time-picker/violet-time-picker.define";
import "../tree/violet-tree.define";
import "../tree-item/violet-tree-item.define";

import { resolveFieldErrorText } from "./field-error";

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

interface FieldErrorCase {
  tag: string;
  markup: string;
  hasSupporting: boolean;
  hasRequired: boolean;
  hasDisabled: boolean;
}

const FIELD_ERROR_CASES: FieldErrorCase[] = [
  {
    tag: "violet-color-picker",
    markup: `<violet-color-picker label="Accent" supporting-text="Choose an accent color." error-text="Pick a contrasting color."></violet-color-picker>`,
    hasSupporting: true,
    hasRequired: true,
    hasDisabled: true,
  },
  {
    tag: "violet-combobox",
    markup: `
            <violet-combobox label="Source" supporting-text="Pick a seed source." error-text="Choose a known source.">
                <violet-option value="coop">Local Co-op</violet-option>
            </violet-combobox>
        `,
    hasSupporting: true,
    hasRequired: true,
    hasDisabled: true,
  },
  {
    tag: "violet-data-grid-pill-select",
    markup: `<violet-data-grid-pill-select label="Method" error-text="Choose a supported method."></violet-data-grid-pill-select>`,
    hasSupporting: false,
    hasRequired: false,
    hasDisabled: false,
  },
  {
    tag: "violet-date-picker",
    markup: `<violet-date-picker label="Planting date" supporting-text="Choose a weekday." error-text="Pick a Monday."></violet-date-picker>`,
    hasSupporting: true,
    hasRequired: true,
    hasDisabled: true,
  },
  {
    tag: "violet-date-range-picker",
    markup: `<violet-date-range-picker label="Season" supporting-text="Choose start and end." error-text="Pick dates in season."></violet-date-range-picker>`,
    hasSupporting: true,
    hasRequired: true,
    hasDisabled: true,
  },
  {
    tag: "violet-file-upload",
    markup: `<violet-file-upload label="Field map" supporting-text="PDF or PNG." error-text="Attach a valid map."></violet-file-upload>`,
    hasSupporting: true,
    hasRequired: true,
    hasDisabled: true,
  },
  {
    tag: "violet-radio-group",
    markup: `
            <violet-radio-group label="Method" supporting-text="Pick one method." error-text="Select a valid method.">
                <violet-radio value="a">Option A</violet-radio>
            </violet-radio-group>
        `,
    hasSupporting: true,
    hasRequired: true,
    hasDisabled: true,
  },
  {
    tag: "violet-range-slider",
    markup: `<violet-range-slider label="Temperature" supporting-text="Safe range." error-text="Range is out of bounds."></violet-range-slider>`,
    hasSupporting: true,
    hasRequired: true,
    hasDisabled: true,
  },
  {
    tag: "violet-segmented-control",
    markup: `
            <violet-segmented-control label="View" supporting-text="Choose a layout." error-text="Pick a valid layout.">
                <violet-segment value="a">List</violet-segment>
            </violet-segmented-control>
        `,
    hasSupporting: true,
    hasRequired: true,
    hasDisabled: true,
  },
  {
    tag: "violet-select",
    markup: `
            <violet-select label="Bed" supporting-text="Pick a raised bed." error-text="Choose an active bed.">
                <violet-option value="north">North</violet-option>
            </violet-select>
        `,
    hasSupporting: true,
    hasRequired: true,
    hasDisabled: true,
  },
  {
    tag: "violet-slider",
    markup: `<violet-slider label="Moisture" supporting-text="Target moisture." error-text="Moisture is out of range."></violet-slider>`,
    hasSupporting: true,
    hasRequired: true,
    hasDisabled: true,
  },
  {
    tag: "violet-time-picker",
    markup: `<violet-time-picker label="Irrigation" supporting-text="Choose start time." error-text="Outside schedule window."></violet-time-picker>`,
    hasSupporting: true,
    hasRequired: true,
    hasDisabled: true,
  },
  {
    tag: "violet-tree",
    markup: `
            <violet-tree label="Zones" supporting-text="Choose a zone." error-text="Select an active zone.">
                <violet-tree-item value="north">North</violet-tree-item>
            </violet-tree>
        `,
    hasSupporting: true,
    hasRequired: false,
    hasDisabled: false,
  },
];

function visibleSupporting(el: HTMLElement): HTMLElement | null {
  const node = el.shadowRoot?.querySelector<HTMLElement>('[part="supporting-text"]') ?? null;
  return node && !node.hidden ? node : null;
}

function visibleError(el: HTMLElement): HTMLElement | null {
  const node = el.shadowRoot?.querySelector<HTMLElement>('[part="error-message"]') ?? null;
  return node && !node.hidden ? node : null;
}

describe("field-error rule (#1678)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("resolves visible error text only while invalid and editable", () => {
    expect(resolveFieldErrorText({ invalid: false, errorText: "Problem" })).toBe("");
    expect(resolveFieldErrorText({ invalid: true, disabled: true, errorText: "Problem" })).toBe("");
    expect(resolveFieldErrorText({ invalid: true, readonly: true, errorText: "Problem" })).toBe("");
    expect(resolveFieldErrorText({ invalid: true, errorText: "  Problem  " })).toBe("Problem");
    expect(
      resolveFieldErrorText({
        invalid: true,
        errorText: "   ",
        fallbackValidationMessage: "Native message",
      }),
    ).toBe("Native message");
    expect(resolveFieldErrorText({ invalid: true, errorText: "" })).toBe("");
  });

  for (const testCase of FIELD_ERROR_CASES) {
    it(`${testCase.tag} follows the invalid-only field-error contract`, async () => {
      await Promise.all([
        customElements.whenDefined(testCase.tag),
        customElements.whenDefined("violet-option"),
        customElements.whenDefined("violet-radio"),
        customElements.whenDefined("violet-segment"),
        customElements.whenDefined("violet-tree-item"),
      ]);
      document.body.innerHTML = testCase.markup;
      const el = document.querySelector(testCase.tag) as HTMLElement;
      await nextFrame();

      // 1. error-text alone (no invalid) renders no error; supporting-text stays visible.
      expect(visibleError(el)).toBeNull();
      if (testCase.hasSupporting) {
        expect(visibleSupporting(el)).not.toBeNull();
      }

      // required alone (no invalid) also renders no error.
      if (testCase.hasRequired) {
        el.setAttribute("required", "");
        await nextFrame();
        expect(visibleError(el)).toBeNull();
      }

      // 2. invalid + error-text renders part="error-message" with role="alert" and replaces supporting-text.
      el.setAttribute("invalid", "");
      await nextFrame();
      const err = visibleError(el);
      expect(err).not.toBeNull();
      expect(err?.getAttribute("role")).toBe("alert");
      expect(err?.textContent?.trim().length).toBeGreaterThan(0);
      if (testCase.hasSupporting) {
        expect(visibleSupporting(el)).toBeNull();
      }

      // 3. disabled suppresses the error and restores supporting-text.
      if (testCase.hasDisabled) {
        el.setAttribute("disabled", "");
        await nextFrame();
        expect(visibleError(el)).toBeNull();
        if (testCase.hasSupporting) {
          expect(visibleSupporting(el)).not.toBeNull();
        }
        el.removeAttribute("disabled");
        await nextFrame();
        expect(visibleError(el)).not.toBeNull();
      }

      // 4. removing error-text attribute (FAST passes null) must not throw and renders no fallback.
      const originalErrorText = el.getAttribute("error-text") ?? "";
      el.removeAttribute("required");
      el.removeAttribute("error-text");
      await nextFrame();
      expect(visibleError(el)).toBeNull();

      // 5. clearing invalid removes the error and restores supporting-text.
      el.setAttribute("error-text", originalErrorText);
      await nextFrame();
      expect(visibleError(el)).not.toBeNull();
      el.removeAttribute("invalid");
      await nextFrame();
      expect(visibleError(el)).toBeNull();
      if (testCase.hasSupporting) {
        expect(visibleSupporting(el)).not.toBeNull();
      }
    });
  }

  it("updates date-picker and time-picker native constraint errors reactively while invalid", async () => {
    await Promise.all([
      customElements.whenDefined("violet-date-picker"),
      customElements.whenDefined("violet-time-picker"),
    ]);
    document.body.innerHTML = `
            <violet-date-picker label="Date" required invalid></violet-date-picker>
            <violet-time-picker label="Time" required invalid></violet-time-picker>
        `;
    const datePicker = document.querySelector("violet-date-picker") as HTMLElement & {
      value: string;
      disabled: boolean;
      checkValidity(): boolean;
    };
    const timePicker = document.querySelector("violet-time-picker") as HTMLElement & {
      value: string;
      disabled: boolean;
      checkValidity(): boolean;
    };
    await nextFrame();

    // Both show their constraint message while required+empty+invalid without error-text.
    expect(visibleError(datePicker)?.textContent?.trim()).toBe("Please choose a date.");
    expect(visibleError(timePicker)?.textContent?.trim()).toBe("Please choose a time.");

    // Fixing the missing value clears the native constraint message even while invalid stays set.
    datePicker.value = "2026-03-15";
    timePicker.value = "09:30";
    await nextFrame();
    expect(visibleError(datePicker)).toBeNull();
    expect(visibleError(timePicker)).toBeNull();

    // Disabling dynamically clears form validity too.
    datePicker.disabled = true;
    timePicker.disabled = true;
    await nextFrame();
    expect(datePicker.checkValidity()).toBe(true);
    expect(timePicker.checkValidity()).toBe(true);
  });

  it("renders standalone violet-data-grid-pill-select error visibly and clips only in external mode", async () => {
    await customElements.whenDefined("violet-data-grid-pill-select");
    document.body.innerHTML = `
            <violet-data-grid-pill-select invalid error-text="Choose a method."></violet-data-grid-pill-select>
        `;
    const pill = document.querySelector("violet-data-grid-pill-select") as HTMLElement;
    await nextFrame();

    const err = visibleError(pill);
    expect(err).not.toBeNull();
    expect(err!.getBoundingClientRect().height).toBeGreaterThan(4);

    pill.setAttribute("error-announcement", "external");
    await nextFrame();
    expect(visibleError(pill)!.getBoundingClientRect().height).toBeLessThanOrEqual(2);
  });

  it("keeps radio-group and segmented-control caption elements live when invalid toggles", async () => {
    await Promise.all([
      customElements.whenDefined("violet-radio-group"),
      customElements.whenDefined("violet-radio"),
      customElements.whenDefined("violet-segmented-control"),
      customElements.whenDefined("violet-segment"),
    ]);
    document.body.innerHTML = `
            <violet-radio-group label="Method" supporting-text="Pick one." error-text="Invalid method.">
                <violet-radio value="a">Option A</violet-radio>
            </violet-radio-group>
            <violet-segmented-control label="View" supporting-text="Pick view." error-text="Invalid view.">
                <violet-segment value="a">List</violet-segment>
            </violet-segmented-control>
        `;
    const radioGroup = document.querySelector("violet-radio-group") as HTMLElement;
    const segControl = document.querySelector("violet-segmented-control") as HTMLElement;
    await nextFrame();
    await nextFrame();

    type FrameTree = { frame: { id: string; url: string }; childFrames?: FrameTree[] };
    const findFrame = (tree: FrameTree, url: string): string | undefined => {
      if (tree.frame.url === url) return tree.frame.id;
      for (const child of tree.childFrames ?? []) {
        const found = findFrame(child, url);
        if (found) return found;
      }
      return undefined;
    };

    const getAxDescription = async (name: string): Promise<string | undefined> => {
      const session = cdp() as unknown as {
        send(method: string, params?: object): Promise<unknown>;
      };
      const { frameTree } = (await session.send("Page.getFrameTree")) as { frameTree: FrameTree };
      const frameId = findFrame(frameTree, location.href);
      const { nodes } = (await session.send("Accessibility.getFullAXTree", { frameId })) as {
        nodes: Array<{
          role?: { value?: string };
          name?: { value?: string };
          description?: { value?: string };
        }>;
      };
      return nodes.find((node) => node.role?.value === "radiogroup" && node.name?.value === name)
        ?.description?.value;
    };

    for (const { host, label, supporting, error } of [
      { host: radioGroup, label: "Method", supporting: "Pick one.", error: "Invalid method." },
      { host: segControl, label: "View", supporting: "Pick view.", error: "Invalid view." },
    ]) {
      if (isChromium) {
        expect(await getAxDescription(label)).toBe(supporting);
      }

      host.setAttribute("invalid", "");
      await nextFrame();
      await nextFrame();
      const errEl = visibleError(host);
      expect(errEl).not.toBeNull();
      expect(errEl?.isConnected).toBe(true);
      expect(visibleSupporting(host)).toBeNull();
      if (isChromium) {
        expect(await getAxDescription(label)).toBe(error);
      }

      host.removeAttribute("invalid");
      await nextFrame();
      await nextFrame();
      const supEl = visibleSupporting(host);
      expect(supEl).not.toBeNull();
      expect(supEl?.isConnected).toBe(true);
      expect(visibleError(host)).toBeNull();
      if (isChromium) {
        expect(await getAxDescription(label)).toBe(supporting);
      }
    }
  });

  it("surfaces required constraint errors on select, combobox, radio-group and segmented-control when invalid without error-text", async () => {
    await Promise.all([
      customElements.whenDefined("violet-select"),
      customElements.whenDefined("violet-combobox"),
      customElements.whenDefined("violet-option"),
      customElements.whenDefined("violet-radio-group"),
      customElements.whenDefined("violet-radio"),
      customElements.whenDefined("violet-segmented-control"),
      customElements.whenDefined("violet-segment"),
    ]);
    document.body.innerHTML = `
            <violet-select label="Crop" supporting-text="Choose one." required invalid>
                <violet-option value="corn">Corn</violet-option>
            </violet-select>
            <violet-combobox label="Field" supporting-text="Type or choose." required invalid>
                <violet-option value="north">North</violet-option>
            </violet-combobox>
            <violet-radio-group label="Priority" supporting-text="Pick one." required invalid>
                <violet-radio value="high">High</violet-radio>
            </violet-radio-group>
            <violet-segmented-control label="Mode" supporting-text="Choose mode." required invalid>
                <violet-segment value="grid">Grid</violet-segment>
            </violet-segmented-control>
        `;
    const select = document.querySelector("violet-select") as HTMLElement & {
      value: string;
      errorId: string;
      supportingId: string;
    };
    const combobox = document.querySelector("violet-combobox") as HTMLElement & {
      value: string;
      errorId: string;
      supportingId: string;
    };
    const radioGroup = document.querySelector("violet-radio-group") as HTMLElement & {
      value: string;
    };
    const segmented = document.querySelector("violet-segmented-control") as HTMLElement & {
      value: string;
    };
    await nextFrame();

    // All four show their constraint message and replace supporting-text while empty+required+invalid.
    expect(visibleError(select)?.textContent?.trim()).toBe("Please select an option.");
    expect(visibleSupporting(select)).toBeNull();
    expect(select.shadowRoot?.querySelector(".trigger")?.getAttribute("aria-describedby")).toBe(
      select.errorId,
    );

    expect(visibleError(combobox)?.textContent?.trim()).toBe("Please choose an option.");
    expect(visibleSupporting(combobox)).toBeNull();
    expect(
      combobox.shadowRoot
        ?.querySelector('input[role="combobox"]')
        ?.getAttribute("aria-describedby"),
    ).toBe(combobox.errorId);

    expect(visibleError(radioGroup)?.textContent?.trim()).toBe("Please select an option.");
    expect(visibleSupporting(radioGroup)).toBeNull();

    expect(visibleError(segmented)?.textContent?.trim()).toBe("Please choose an option.");
    expect(visibleSupporting(segmented)).toBeNull();

    // Selecting values clears the constraint fallback and restores supporting-text.
    select.value = "corn";
    combobox.value = "north";
    radioGroup.value = "high";
    segmented.value = "grid";
    await nextFrame();
    expect(visibleError(select)).toBeNull();
    expect(visibleSupporting(select)).not.toBeNull();
    expect(visibleError(combobox)).toBeNull();
    expect(visibleSupporting(combobox)).not.toBeNull();
    expect(visibleError(radioGroup)).toBeNull();
    expect(visibleSupporting(radioGroup)).not.toBeNull();
    expect(visibleError(segmented)).toBeNull();
    expect(visibleSupporting(segmented)).not.toBeNull();
  });

  it("clears rejected file-upload alert when invalid clears and preserves author-owned invalid across rejection/acceptance", async () => {
    await customElements.whenDefined("violet-file-upload");
    document.body.innerHTML = `
            <violet-file-upload label="Attachment" supporting-text="PDF only." accept=".pdf"></violet-file-upload>
        `;
    const upload = document.querySelector("violet-file-upload") as HTMLElement & {
      invalid: boolean;
      errorText: string;
      validationMessage: string;
      checkValidity(): boolean;
      setFiles(files: readonly File[]): boolean;
    };
    await nextFrame();

    const rejected = upload.setFiles([new File(["a,b"], "bad.csv", { type: "text/csv" })]);
    await nextFrame();
    expect(rejected).toBe(false);
    expect(upload.invalid).toBe(true);
    expect(visibleError(upload)?.textContent?.trim()).toContain(
      "does not match the accepted file types",
    );
    expect(visibleSupporting(upload)).toBeNull();

    upload.invalid = false;
    await nextFrame();
    expect(visibleError(upload)).toBeNull();
    expect(visibleSupporting(upload)).not.toBeNull();

    // A live rejection reason takes precedence over generic errorText, and author-owned invalid
    // plus errorText survive once a subsequent valid file clears the rejection.
    upload.errorText = "Server rejected previous upload.";
    upload.invalid = true;
    await nextFrame();
    expect(upload.setFiles([new File(["a,b"], "bad.csv", { type: "text/csv" })])).toBe(false);
    await nextFrame();
    expect(upload.validationMessage).toContain("does not match the accepted file types");
    expect(visibleError(upload)?.textContent?.trim()).toContain(
      "does not match the accepted file types",
    );
    expect(upload.setFiles([new File(["%PDF"], "good.pdf", { type: "application/pdf" })])).toBe(
      true,
    );
    await nextFrame();
    expect(upload.invalid).toBe(true);
    expect(upload.checkValidity()).toBe(false);
    expect(visibleError(upload)?.textContent?.trim()).toBe("Server rejected previous upload.");
  });
});
