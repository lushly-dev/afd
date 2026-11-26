import { afterEach, describe, expect, it } from "vitest";
import { cdp, page, server, userEvent } from "vitest/browser";

const isChromium = server.browser === "chromium";

import "./violet-checkbox.define";
import type { VioletCheckbox } from "./violet-checkbox";

interface FrameTree {
  frame: { id: string; url: string };
  childFrames?: FrameTree[];
}

interface AxNode {
  role?: { value?: string };
  name?: { value?: string };
  description?: { value?: string };
}

function findFrame(tree: FrameTree, url: string): string | undefined {
  if (tree.frame.url === url) {
    return tree.frame.id;
  }
  for (const child of tree.childFrames ?? []) {
    const found = findFrame(child, url);
    if (found) {
      return found;
    }
  }
  return undefined;
}

async function getAxNodes(): Promise<AxNode[]> {
  const session = cdp() as unknown as {
    send(method: string, params?: object): Promise<unknown>;
  };
  const { frameTree } = (await session.send("Page.getFrameTree")) as { frameTree: FrameTree };
  const frameId = findFrame(frameTree, location.href);
  const { nodes } = (await session.send("Accessibility.getFullAXTree", { frameId })) as {
    nodes: AxNode[];
  };
  return nodes;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

async function renderCheckbox(
  options: {
    configure?: (checkbox: VioletCheckbox) => void;
    label?: string;
    supporting?: string;
    inForm?: boolean;
  } = {},
): Promise<{ checkbox: VioletCheckbox; form: HTMLFormElement | null }> {
  document.body.innerHTML = "";

  const checkbox = document.createElement("violet-checkbox") as VioletCheckbox;
  checkbox.name = "terms";
  options.configure?.(checkbox);

  if (options.label) {
    checkbox.textContent = options.label;
  }

  if (options.supporting) {
    const supporting = document.createElement("span");
    supporting.slot = "supporting";
    supporting.textContent = options.supporting;
    checkbox.append(supporting);
  }

  let form: HTMLFormElement | null = null;
  if (options.inForm) {
    form = document.createElement("form");
    form.append(checkbox);
    document.body.append(form);
  } else {
    document.body.append(checkbox);
  }

  await customElements.whenDefined("violet-checkbox");
  await nextFrame();

  return { checkbox, form };
}

function input(checkbox: VioletCheckbox): HTMLInputElement {
  const native = checkbox.shadowRoot?.querySelector(
    'input[type="checkbox"]',
  ) as HTMLInputElement | null;
  if (!native) {
    throw new Error("violet-checkbox did not render its native input");
  }
  return native;
}

describe("violet-checkbox", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders unchecked with default property values", async () => {
    const { checkbox } = await renderCheckbox({ label: "Accept" });

    expect(checkbox.checked).toBe(false);
    expect(checkbox.indeterminate).toBe(false);
    expect(checkbox.disabled).toBe(false);
    expect(checkbox.required).toBe(false);
    expect(checkbox.invalid).toBe(false);
    expect(checkbox.value).toBe("on");
    expect(input(checkbox).checked).toBe(false);
  });

  it("maps attributes to properties and the native input", async () => {
    const { checkbox } = await renderCheckbox({
      label: "Accept",
      configure: (el) => {
        el.setAttribute("checked", "");
        el.setAttribute("value", "yes");
        el.setAttribute("name", "agreement");
        el.setAttribute("required", "");
      },
    });
    const native = input(checkbox);

    expect(checkbox.checked).toBe(true);
    expect(checkbox.value).toBe("yes");
    expect(checkbox.name).toBe("agreement");
    expect(checkbox.required).toBe(true);
    expect(native.checked).toBe(true);
    expect(native.value).toBe("yes");
    expect(native.name).toBe("agreement");
    expect(native.required).toBe(true);
  });

  it("reflects checked and disabled properties back to attributes", async () => {
    const { checkbox } = await renderCheckbox({ label: "Accept" });

    checkbox.checked = true;
    checkbox.disabled = true;
    await nextFrame();

    expect(checkbox.hasAttribute("checked")).toBe(true);
    expect(checkbox.hasAttribute("disabled")).toBe(true);
    expect(input(checkbox).checked).toBe(true);
    expect(input(checkbox).disabled).toBe(true);

    checkbox.checked = false;
    await nextFrame();

    expect(checkbox.hasAttribute("checked")).toBe(false);
    expect(input(checkbox).checked).toBe(false);
  });

  it("toggles on click and emits change with a checked detail", async () => {
    const { checkbox } = await renderCheckbox({ label: "Accept" });
    const details: Array<{ checked: boolean }> = [];
    checkbox.addEventListener("change", (event) => {
      const custom = event as CustomEvent<{ checked: boolean }>;
      if (custom.detail) {
        details.push(custom.detail);
      }
    });

    input(checkbox).click();
    await nextFrame();
    expect(checkbox.checked).toBe(true);

    input(checkbox).click();
    await nextFrame();
    expect(checkbox.checked).toBe(false);

    expect(details).toEqual([{ checked: true }, { checked: false }]);
  });

  it("toggles when its label text or control box is clicked, without toggling on supporting content", async () => {
    const wrapper = document.createElement("div");
    wrapper.className = "label";
    const { checkbox } = await renderCheckbox({ label: "Accept terms" });
    wrapper.append(checkbox);
    document.body.append(wrapper);

    const details = document.createElement("details");
    details.slot = "supporting";
    const summary = document.createElement("summary");
    summary.textContent = "Read policy";
    const body = document.createElement("p");
    body.textContent = "Details here.";
    details.append(summary, body);
    checkbox.append(details);
    await nextFrame();

    await userEvent.click(checkbox.shadowRoot!.querySelector(".label") as HTMLElement);
    await nextFrame();
    expect(checkbox.checked).toBe(true);

    // The box takes no pointer events (#1424); a click at its centre lands on the input in its shell.
    await userEvent.click(checkbox.shadowRoot!.querySelector(".control-shell") as HTMLElement);
    await nextFrame();
    expect(checkbox.checked).toBe(false);

    await userEvent.click(summary);
    await nextFrame();
    expect(details.open).toBe(true);
    expect(checkbox.checked).toBe(false);
  });

  it("toggles with the Space key when focused", async () => {
    const { checkbox } = await renderCheckbox({ label: "Accept" });

    checkbox.focus();
    expect(checkbox.shadowRoot?.activeElement).toBe(input(checkbox));

    await userEvent.keyboard("{ }");
    expect(checkbox.checked).toBe(true);

    await userEvent.keyboard("{ }");
    expect(checkbox.checked).toBe(false);
  });

  it("does not toggle when disabled", async () => {
    const { checkbox } = await renderCheckbox({
      label: "Accept",
      configure: (el) => {
        el.disabled = true;
      },
    });

    input(checkbox).click();
    (checkbox.shadowRoot!.querySelector(".label") as HTMLElement).click();
    await nextFrame();

    expect(checkbox.checked).toBe(false);
  });

  it("clears indeterminate once the user toggles the checkbox", async () => {
    const { checkbox } = await renderCheckbox({
      label: "Select all",
      configure: (el) => {
        el.indeterminate = true;
      },
    });

    expect(input(checkbox).indeterminate).toBe(true);

    input(checkbox).click();
    await nextFrame();

    expect(checkbox.indeterminate).toBe(false);
    expect(input(checkbox).indeterminate).toBe(false);
    expect(checkbox.checked).toBe(true);
  });

  // #1424: the aria-hidden box paints over the native input, so a role-based click landed on
  // the box, which a pointer hit-test reports as intercepting the click.
  describe("hit area", () => {
    function centerOf(target: Element): { x: number; y: number } {
      const rect = target.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }

    it("toggles from a role-based click without force", async () => {
      const { checkbox } = await renderCheckbox({ label: "Accept terms" });
      const changes: boolean[] = [];
      checkbox.addEventListener("change", () => changes.push(checkbox.checked));

      await page.getByRole("checkbox", { name: "Accept terms" }).click();
      expect(checkbox.checked).toBe(true);
      expect(input(checkbox).checked).toBe(true);

      await page.getByRole("checkbox", { name: "Accept terms" }).click();
      expect(checkbox.checked).toBe(false);
      expect(changes).toEqual([true, false]);
    });

    it("toggles an inline checkbox named only by aria-label from a role-based click", async () => {
      const { checkbox } = await renderCheckbox({
        configure: (el) => {
          el.inline = true;
          el.setAttribute("aria-label", "Select row");
        },
      });

      await page.getByRole("checkbox", { name: "Select row" }).click();
      expect(checkbox.checked).toBe(true);
    });

    it("hit-tests the visible box to the native input and toggles exactly once", async () => {
      const { checkbox } = await renderCheckbox({ label: "Accept terms" });
      const box = checkbox.shadowRoot?.querySelector(".box") as HTMLElement;
      const changes: boolean[] = [];
      checkbox.addEventListener("change", () => changes.push(checkbox.checked));

      const { x, y } = centerOf(box);
      expect(checkbox.shadowRoot?.elementFromPoint(x, y)).toBe(input(checkbox));

      // A real pointer at the box's centre: the shell contains the input, so Playwright's
      // hit-test accepts it and the click lands where a person's would.
      await userEvent.click(checkbox.shadowRoot?.querySelector(".control-shell") as HTMLElement);
      expect(checkbox.checked).toBe(true);
      expect(changes).toEqual([true]);
    });

    it("toggles from the keyboard after a role-based focus", async () => {
      const { checkbox } = await renderCheckbox({ label: "Accept terms" });
      input(checkbox).focus();

      await userEvent.keyboard(" ");
      expect(checkbox.checked).toBe(true);
    });

    it("does not toggle a disabled checkbox from a role-based click", async () => {
      const { checkbox } = await renderCheckbox({
        label: "Accept terms",
        configure: (el) => {
          el.disabled = true;
        },
      });

      await expect(page.getByRole("checkbox", { name: "Accept terms" })).toBeDisabled();
      await page.getByRole("checkbox", { name: "Accept terms" }).click({ force: true });
      expect(checkbox.checked).toBe(false);
    });
  });

  describe("accessible name", () => {
    it("names the input through its native label without duplicating aria-label (#1578)", async () => {
      const { checkbox } = await renderCheckbox({ label: "Accept terms" });
      const label = checkbox.shadowRoot?.querySelector("label.label") as HTMLLabelElement | null;

      expect(label?.htmlFor).toBe(input(checkbox).id);
      expect(input(checkbox).hasAttribute("aria-label")).toBe(false);
      expect(checkbox.controlAriaLabel).toBe("Accept terms");
    });

    it.runIf(isChromium)(
      "exposes the label once in the accessibility tree and keeps supporting text as description (#1578)",
      async () => {
        document.body.innerHTML = `
                <table>
                    <thead><tr><th>Violet</th><th>Native</th></tr></thead>
                    <tbody><tr>
                        <td id="violet-cell"><violet-checkbox>Send me updates<span slot="supporting">Once a week</span></violet-checkbox></td>
                        <td id="native-cell"><input id="native-cb" type="checkbox" aria-describedby="native-desc"><label for="native-cb">Send me updates</label><span id="native-desc">Once a week</span></td>
                    </tr></tbody>
                </table>
            `;
        await customElements.whenDefined("violet-checkbox");
        await nextFrame();

        const nodes = await getAxNodes();
        const checkboxes = nodes.filter((node) => node.role?.value === "checkbox");
        expect(checkboxes).toHaveLength(2);
        expect(checkboxes[0]?.name?.value).toBe("Send me updates");
        expect(checkboxes[0]?.description?.value).toBe("Once a week");
        expect(checkboxes[0]?.name?.value).toBe(checkboxes[1]?.name?.value);
        expect(checkboxes[0]?.description?.value).toBe(checkboxes[1]?.description?.value);

        const cells = nodes.filter((node) => node.role?.value === "cell");
        expect(cells).toHaveLength(2);
        expect(cells[0]?.name?.value).toBe(cells[1]?.name?.value);
        expect(cells[0]?.name?.value).not.toContain("Send me updates Send me updates");
      },
    );

    it("prefers an explicit aria-label on the host", async () => {
      const { checkbox } = await renderCheckbox({
        label: "Accept terms",
        configure: (el) => {
          el.setAttribute("aria-label", "Accept the terms and conditions");
        },
      });

      expect(input(checkbox).getAttribute("aria-label")).toBe("Accept the terms and conditions");

      checkbox.setAttribute("aria-label", "Updated label");
      await nextFrame();

      expect(input(checkbox).getAttribute("aria-label")).toBe("Updated label");
    });

    it("is described by its supporting text and the host's aria-describedby", async () => {
      const { checkbox } = await renderCheckbox({
        label: "Accept terms",
        supporting: "Read the policy first.",
      });
      const hint = document.createElement("p");
      hint.id = "terms-hint";
      hint.textContent = "Required to continue.";
      document.body.prepend(hint);
      checkbox.setAttribute("aria-describedby", "terms-hint");
      await nextFrame();

      const supporting = checkbox.shadowRoot?.querySelector('[part~="supporting-text"]');
      expect(input(checkbox).ariaDescribedByElements).toEqual([hint, supporting]);

      checkbox.querySelector('[slot="supporting"]')?.remove();
      await nextFrame();

      expect(input(checkbox).ariaDescribedByElements).toEqual([hint]);
    });

    it("links a described-by target that appears after it connects once focus arrives", async () => {
      const { checkbox } = await renderCheckbox({
        label: "Accept terms",
        configure: (el) => {
          el.setAttribute("aria-describedby", "terms-error");
        },
      });
      expect(input(checkbox).ariaDescribedByElements ?? []).toEqual([]);

      const error = document.createElement("p");
      error.id = "terms-error";
      error.textContent = "Accept the terms to continue.";
      document.body.append(error);
      input(checkbox).focus();

      expect(input(checkbox).ariaDescribedByElements).toEqual([error]);
    });

    it("omits aria-label when there is no label text", async () => {
      const { checkbox } = await renderCheckbox();

      expect(input(checkbox).hasAttribute("aria-label")).toBe(false);
    });

    it("mirrors the invalid property to aria-invalid", async () => {
      const { checkbox } = await renderCheckbox({ label: "Accept" });

      expect(input(checkbox).getAttribute("aria-invalid")).toBe("false");

      checkbox.invalid = true;
      await nextFrame();

      expect(input(checkbox).getAttribute("aria-invalid")).toBe("true");
    });
  });

  describe("layout sizing (#1579)", () => {
    it("includes the label's longest word in its minimum width inside a table cell", async () => {
      document.body.innerHTML = `
                <table style="width: 1px;">
                    <tr>
                        <td><violet-checkbox id="cb">Include archived items</violet-checkbox></td>
                    </tr>
                </table>
            `;
      await customElements.whenDefined("violet-checkbox");
      await nextFrame();

      const checkbox = document.getElementById("cb") as VioletCheckbox;
      const hostRect = checkbox.getBoundingClientRect();
      const label = checkbox.shadowRoot?.querySelector(".label") as HTMLElement;
      const control = checkbox.shadowRoot?.querySelector(".control-shell") as HTMLElement;

      expect(hostRect.width).toBeGreaterThan(control.getBoundingClientRect().width + 30);
      expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth + 1);
    });
  });

  describe("slots", () => {
    it("shows supporting text only when provided", async () => {
      const { checkbox } = await renderCheckbox({ label: "Accept" });
      const supporting = checkbox.shadowRoot?.querySelector(".supporting") as HTMLElement;

      expect(checkbox.hasSupporting).toBe(false);
      expect(supporting.hasAttribute("hidden")).toBe(true);

      const { checkbox: withSupporting } = await renderCheckbox({
        label: "Accept",
        supporting: "Read the policy first.",
      });
      const assigned = (
        withSupporting.shadowRoot!.querySelector('slot[name="supporting"]') as HTMLSlotElement
      ).assignedElements();

      expect(withSupporting.hasSupporting).toBe(true);
      expect(assigned).toHaveLength(1);
    });

    // Needs the @observable hasSupporting binding to re-run after slotchange.
    it("reveals the supporting wrapper once supporting text is slotted", async () => {
      const { checkbox } = await renderCheckbox({
        label: "Accept",
        supporting: "Read the policy first.",
      });
      await nextFrame();

      const supporting = checkbox.shadowRoot?.querySelector(".supporting") as HTMLElement;
      expect(supporting.hasAttribute("hidden")).toBe(false);
    });

    it("hides the label in inline mode when there is no label content", async () => {
      const { checkbox } = await renderCheckbox({
        configure: (el) => {
          el.inline = true;
          el.setAttribute("aria-label", "Select row");
        },
      });

      expect(checkbox.hasLabel).toBe(false);
      expect(checkbox.shadowRoot?.querySelector(".content")?.hasAttribute("hidden")).toBe(true);
      expect(input(checkbox).getAttribute("aria-label")).toBe("Select row");
    });
  });

  describe("form participation", () => {
    it("submits the value under its name only while checked", async () => {
      const { checkbox, form } = await renderCheckbox({
        label: "Accept",
        inForm: true,
        configure: (el) => {
          el.value = "agreed";
        },
      });

      expect(new FormData(form as HTMLFormElement).has("terms")).toBe(false);

      checkbox.checked = true;
      await nextFrame();

      expect(new FormData(form as HTMLFormElement).get("terms")).toBe("agreed");
      expect(checkbox.form).toBe(form);

      checkbox.checked = false;
      await nextFrame();

      expect(new FormData(form as HTMLFormElement).has("terms")).toBe(false);
    });

    it("defaults the submitted value to on", async () => {
      const { form } = await renderCheckbox({
        label: "Accept",
        inForm: true,
        configure: (el) => {
          el.checked = true;
        },
      });

      expect(new FormData(form as HTMLFormElement).get("terms")).toBe("on");
    });

    it("omits the value from form data when disabled", async () => {
      const { form } = await renderCheckbox({
        label: "Accept",
        inForm: true,
        configure: (el) => {
          el.checked = true;
          el.disabled = true;
        },
      });

      expect(new FormData(form as HTMLFormElement).has("terms")).toBe(false);
    });

    it("reports valueMissing while required and unchecked", async () => {
      const { checkbox } = await renderCheckbox({
        label: "Accept",
        inForm: true,
        configure: (el) => {
          el.required = true;
        },
      });

      expect(checkbox.checkValidity()).toBe(false);
      expect(checkbox.validity.valueMissing).toBe(true);
      expect(checkbox.validationMessage).not.toBe("");

      checkbox.checked = true;
      await nextFrame();

      expect(checkbox.checkValidity()).toBe(true);
      expect(checkbox.validity.valid).toBe(true);
    });

    it("reports a custom error while invalid", async () => {
      const { checkbox } = await renderCheckbox({
        label: "Accept",
        inForm: true,
        configure: (el) => {
          el.invalid = true;
        },
      });

      expect(checkbox.validity.customError).toBe(true);
      expect(checkbox.checkValidity()).toBe(false);

      checkbox.invalid = false;
      await nextFrame();

      expect(checkbox.checkValidity()).toBe(true);
    });

    it("skips validation when disabled", async () => {
      const { checkbox } = await renderCheckbox({
        label: "Accept",
        inForm: true,
        configure: (el) => {
          el.required = true;
          el.disabled = true;
        },
      });

      expect(checkbox.checkValidity()).toBe(true);
    });

    it("blocks form submission while a required checkbox is unchecked", async () => {
      const { checkbox, form } = await renderCheckbox({
        label: "Accept",
        inForm: true,
        configure: (el) => {
          el.required = true;
        },
      });

      expect((form as HTMLFormElement).checkValidity()).toBe(false);

      checkbox.checked = true;
      await nextFrame();

      expect((form as HTMLFormElement).checkValidity()).toBe(true);
    });

    it("restores its initial checked and indeterminate state on form reset", async () => {
      const { checkbox, form } = await renderCheckbox({
        label: "Accept",
        inForm: true,
        configure: (el) => {
          el.setAttribute("checked", "");
          el.indeterminate = true;
        },
      });

      input(checkbox).click();
      await nextFrame();
      expect(checkbox.checked).toBe(false);

      (form as HTMLFormElement).reset();
      await nextFrame();

      expect(checkbox.checked).toBe(true);
      expect(checkbox.indeterminate).toBe(true);
      expect(new FormData(form as HTMLFormElement).get("terms")).toBe("on");
    });

    it("resets an initially unchecked checkbox to unchecked", async () => {
      const { checkbox, form } = await renderCheckbox({ label: "Accept", inForm: true });

      input(checkbox).click();
      await nextFrame();
      expect(checkbox.checked).toBe(true);

      (form as HTMLFormElement).reset();
      await nextFrame();

      expect(checkbox.checked).toBe(false);
      expect(new FormData(form as HTMLFormElement).has("terms")).toBe(false);
    });
  });

  describe("field errors", () => {
    it("renders no error before invalid is set, even with required and error-text", async () => {
      const { checkbox } = await renderCheckbox({
        label: "Accept terms",
        supporting: "Read the policy first.",
        configure: (el) => {
          el.required = true;
          el.errorText = "Accept the terms to continue.";
        },
      });

      expect(checkbox.shadowRoot?.querySelector(".error")).toBeNull();
      expect(checkbox.shadowRoot?.querySelector(".supporting")?.hasAttribute("hidden")).toBe(false);
      expect(checkbox.checkValidity()).toBe(false);
    });

    it("replaces supporting text with error-text while invalid, announces it, and links it as description", async () => {
      const { checkbox } = await renderCheckbox({
        label: "Accept terms",
        supporting: "Read the policy first.",
        configure: (el) => {
          el.setAttribute("error-text", "Accept the terms to continue.");
        },
      });
      const hostHint = document.createElement("p");
      hostHint.id = "checkbox-host-hint";
      hostHint.textContent = "Required for checkout.";
      document.body.prepend(hostHint);
      checkbox.setAttribute("aria-describedby", "checkbox-host-hint");

      checkbox.invalid = true;
      await nextFrame();
      await nextFrame();

      const error = checkbox.shadowRoot?.querySelector(
        '[part~="error-message"]',
      ) as HTMLElement | null;
      const supporting = checkbox.shadowRoot?.querySelector(
        '[part~="supporting-text"]',
      ) as HTMLElement | null;
      expect(error?.textContent?.trim()).toBe("Accept the terms to continue.");
      expect(error?.getAttribute("role")).toBe("alert");
      expect(supporting?.hasAttribute("hidden")).toBe(true);
      expect(Array.from(input(checkbox).ariaDescribedByElements ?? [])).toEqual([hostHint, error]);
      expect(checkbox.validationMessage).toBe("Accept the terms to continue.");

      checkbox.invalid = false;
      await nextFrame();
      await nextFrame();

      expect(checkbox.shadowRoot?.querySelector(".error")).toBeNull();
      expect(supporting?.hasAttribute("hidden")).toBe(false);
      expect(Array.from(input(checkbox).ariaDescribedByElements ?? [])).toEqual([
        hostHint,
        supporting,
      ]);
    });

    it("falls back to the browser validation message when invalid and required without error-text", async () => {
      const { checkbox } = await renderCheckbox({
        label: "Accept terms",
        supporting: "Read the policy first.",
        configure: (el) => {
          el.required = true;
          el.invalid = true;
        },
      });
      await nextFrame();

      const error = checkbox.shadowRoot?.querySelector(
        '[part~="error-message"]',
      ) as HTMLElement | null;
      expect(error?.textContent?.trim()).toBe(input(checkbox).validationMessage);
      expect(error?.textContent?.trim()).not.toBe("");
      expect(checkbox.shadowRoot?.querySelector(".supporting")?.hasAttribute("hidden")).toBe(true);
    });

    it("suppresses the error message while disabled and reveals content for inline errors", async () => {
      const { checkbox } = await renderCheckbox({
        configure: (el) => {
          el.inline = true;
          el.setAttribute("aria-label", "Select row");
          el.errorText = "Select at least one row.";
          el.invalid = true;
        },
      });
      await nextFrame();

      expect(checkbox.shadowRoot?.querySelector(".content")?.hasAttribute("hidden")).toBe(false);
      expect(checkbox.shadowRoot?.querySelector(".error")?.textContent?.trim()).toBe(
        "Select at least one row.",
      );

      checkbox.disabled = true;
      await nextFrame();

      expect(checkbox.shadowRoot?.querySelector(".error")).toBeNull();
      expect(checkbox.shadowRoot?.querySelector(".content")?.hasAttribute("hidden")).toBe(true);
    });

    it("falls back to the browser validation message when error-text is only whitespace", async () => {
      const { checkbox } = await renderCheckbox({
        label: "Accept terms",
        configure: (el) => {
          el.required = true;
          el.errorText = "   ";
          el.invalid = true;
        },
      });
      await nextFrame();

      const error = checkbox.shadowRoot?.querySelector(
        '[part~="error-message"]',
      ) as HTMLElement | null;
      expect(error?.textContent?.trim()).toBe(input(checkbox).validationMessage);
      expect(error?.textContent?.trim()).not.toBe("");
    });

    it("suppresses the error message inside a disabled fieldset and restores it when re-enabled", async () => {
      document.body.innerHTML = "";
      const form = document.createElement("form");
      const fieldset = document.createElement("fieldset");
      fieldset.disabled = true;
      const checkbox = document.createElement("violet-checkbox") as VioletCheckbox;
      checkbox.textContent = "Accept terms";
      const supporting = document.createElement("span");
      supporting.slot = "supporting";
      supporting.textContent = "Helper.";
      checkbox.append(supporting);
      checkbox.errorText = "Accept the terms.";
      checkbox.invalid = true;
      fieldset.append(checkbox);
      form.append(fieldset);
      document.body.append(form);
      await customElements.whenDefined("violet-checkbox");
      await nextFrame();
      await nextFrame();

      expect(checkbox.shadowRoot?.querySelector(".error")).toBeNull();
      expect(checkbox.shadowRoot?.querySelector(".supporting")?.hasAttribute("hidden")).toBe(false);

      fieldset.disabled = false;
      await nextFrame();
      await nextFrame();

      expect(checkbox.shadowRoot?.querySelector(".error")?.textContent?.trim()).toBe(
        "Accept the terms.",
      );
      expect(checkbox.shadowRoot?.querySelector(".supporting")?.hasAttribute("hidden")).toBe(true);
    });

    it("keeps displayErrorText read-only", async () => {
      const { checkbox } = await renderCheckbox({ label: "Accept" });
      const descriptor = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(checkbox),
        "displayErrorText",
      );
      expect(descriptor?.set).toBeUndefined();
    });
  });
});
