import { observable } from "@lushly-dev/fast-element";

interface FormDisabledHost extends HTMLElement {
    disabled: boolean;
    fieldsetDisabled: boolean;
    disabledChanged?: () => void;
}

/**
 * Returns true when `element` is disabled by an ancestor `<fieldset disabled>`.
 *
 * Mirrors the HTML "actually disabled" rule: only light-tree ancestors count, and
 * controls inside a disabled fieldset's first `<legend>` are exempt.
 */
export function isDisabledByFieldset(element: Element): boolean {
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        if (!(ancestor instanceof HTMLFieldSetElement) || !ancestor.hasAttribute("disabled")) {
            continue;
        }

        const legend = Array.from(ancestor.children).find(child => child instanceof HTMLLegendElement);

        if (!legend || !legend.contains(element)) {
            return true;
        }
    }

    return false;
}

type Callback = (this: FormDisabledHost) => void;

interface FormDisabledPrototype {
    connectedCallback?: Callback;
    disabledChanged?: Callback;
}

/**
 * Teaches a form-associated component to honour `<fieldset disabled>` without
 * touching the author's own `disabled` attribute or property.
 *
 * Installs, on the component prototype:
 * - an observable `fieldsetDisabled` flag (true while an ancestor fieldset disables the control),
 * - an `effectiveDisabled` getter (`disabled || fieldsetDisabled`) that the component should use
 *   everywhere it previously read `disabled`,
 * - `formDisabledCallback`, which the browser invokes when the form-disabled state changes,
 * - wrappers around `connectedCallback` and `disabledChanged` that re-evaluate the flag, because the
 *   browser does not call `formDisabledCallback` when the control's own `disabled` already masks the
 *   fieldset's effect (e.g. inserting or re-enabling inside an already-disabled fieldset).
 *
 * The component's own `disabledChanged` runs whenever either flag changes. Call once per class,
 * after the class body and before the element is defined; the class must declare
 * `fieldsetDisabled` and `effectiveDisabled` for typing.
 */
export function installFormDisabled(prototype: object): void {
    const target = prototype as FormDisabledPrototype;
    const connectedCallback = target.connectedCallback;
    const disabledChanged = target.disabledChanged;

    observable(prototype, "fieldsetDisabled");

    Object.defineProperty(prototype, "effectiveDisabled", {
        configurable: true,
        get(this: FormDisabledHost): boolean {
            return Boolean(this.disabled) || Boolean(this.fieldsetDisabled);
        },
    });

    Object.defineProperty(prototype, "formDisabledCallback", {
        configurable: true,
        writable: true,
        value(this: FormDisabledHost): void {
            this.fieldsetDisabled = isDisabledByFieldset(this);
        },
    });

    Object.defineProperty(prototype, "fieldsetDisabledChanged", {
        configurable: true,
        writable: true,
        value(this: FormDisabledHost): void {
            disabledChanged?.call(this);
        },
    });

    Object.defineProperty(prototype, "disabledChanged", {
        configurable: true,
        writable: true,
        value(this: FormDisabledHost): void {
            this.fieldsetDisabled = isDisabledByFieldset(this);
            disabledChanged?.call(this);
        },
    });

    Object.defineProperty(prototype, "connectedCallback", {
        configurable: true,
        writable: true,
        value(this: FormDisabledHost): void {
            this.fieldsetDisabled = isDisabledByFieldset(this);
            connectedCallback?.call(this);
        },
    });
}
