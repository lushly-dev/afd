import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";

import "./violet-checkbox";
import { VioletCheckbox } from "./violet-checkbox";

function nextFrame(): Promise<void> {
    return new Promise(resolve => {
        requestAnimationFrame(() => resolve());
    });
}

async function renderCheckbox(
    options: {
        configure?: (checkbox: VioletCheckbox) => void;
        label?: string;
        supporting?: string;
        inForm?: boolean;
    } = {}
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
    const native = checkbox.shadowRoot?.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
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
            configure: el => {
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
        checkbox.addEventListener("change", event => {
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

    it("toggles when its label text is clicked", async () => {
        const { checkbox } = await renderCheckbox({ label: "Accept terms" });

        (checkbox.shadowRoot?.querySelector(".label") as HTMLElement).click();
        await nextFrame();

        expect(checkbox.checked).toBe(true);
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
            configure: el => {
                el.disabled = true;
            },
        });

        input(checkbox).click();
        (checkbox.shadowRoot?.querySelector(".label") as HTMLElement).click();
        await nextFrame();

        expect(checkbox.checked).toBe(false);
    });

    it("clears indeterminate once the user toggles the checkbox", async () => {
        const { checkbox } = await renderCheckbox({
            label: "Select all",
            configure: el => {
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

    describe("accessible name", () => {
        it("uses the slotted label text", async () => {
            const { checkbox } = await renderCheckbox({ label: "Accept terms" });

            expect(input(checkbox).getAttribute("aria-label")).toBe("Accept terms");
            expect(checkbox.controlAriaLabel).toBe("Accept terms");
        });

        it("prefers an explicit aria-label on the host", async () => {
            const { checkbox } = await renderCheckbox({
                label: "Accept terms",
                configure: el => {
                    el.setAttribute("aria-label", "Accept the terms and conditions");
                },
            });

            expect(input(checkbox).getAttribute("aria-label")).toBe("Accept the terms and conditions");
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
                withSupporting.shadowRoot?.querySelector('slot[name="supporting"]') as HTMLSlotElement
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
                configure: el => {
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
                configure: el => {
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
                configure: el => {
                    el.checked = true;
                },
            });

            expect(new FormData(form as HTMLFormElement).get("terms")).toBe("on");
        });

        it("omits the value from form data when disabled", async () => {
            const { form } = await renderCheckbox({
                label: "Accept",
                inForm: true,
                configure: el => {
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
                configure: el => {
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
                configure: el => {
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
                configure: el => {
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
                configure: el => {
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
                configure: el => {
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
});
