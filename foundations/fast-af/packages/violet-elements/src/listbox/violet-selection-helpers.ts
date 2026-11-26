import type { VioletOption } from "../option/violet-option";

export function normalizeMatchText(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

export function isOptionDisabled(option: VioletOption): boolean {
  const group = option.closest("violet-option-group") as { disabled?: boolean } | null;
  return Boolean(option.disabled || group?.disabled);
}

/**
 * The options a select, combobox or listbox owns, each upgraded. Parsed markup upgrades in tree
 * order, so the host's attribute and connected callbacks run before its options are upgraded and
 * would read a label or value they do not have yet (#1172).
 */
export function getOwnedOptions(host: Element): VioletOption[] {
  const selector = host.localName;
  const definition = customElements.get("violet-option");

  return Array.from(host.querySelectorAll("violet-option")).filter(
    (option): option is VioletOption => {
      if (option.closest(selector) !== host) {
        return false;
      }
      if (definition && !(option instanceof definition)) {
        customElements.upgrade(option);
      }
      return true;
    },
  );
}

export function getEnabledOptions(options: VioletOption[]): VioletOption[] {
  return options.filter((option) => !isOptionDisabled(option));
}

export function getSelectedOption(
  options: VioletOption[],
  value: string | null,
): VioletOption | null {
  if (value === null) {
    return options.find((option) => option.selected && !isOptionDisabled(option)) ?? null;
  }

  return options.find((option) => option.value === value && !isOptionDisabled(option)) ?? null;
}

export function getNextEnabledIndex(
  options: VioletOption[],
  currentIndex: number,
  step: 1 | -1,
): number {
  if (options.length === 0) {
    return -1;
  }

  let index = currentIndex;

  for (let count = 0; count < options.length; count += 1) {
    index = (index + step + options.length) % options.length;

    if (options[index] && !isOptionDisabled(options[index])) {
      return index;
    }
  }

  return -1;
}

export function findTypeaheadMatch(
  options: VioletOption[],
  buffer: string,
  active: VioletOption | string | null,
): VioletOption | null {
  const enabled = getEnabledOptions(options);

  if (enabled.length === 0 || !buffer) {
    return null;
  }

  const normalized = normalizeMatchText(buffer.trim());
  const currentIndex =
    active === null
      ? -1
      : typeof active === "string"
        ? enabled.findIndex((option) => option.value === active)
        : enabled.indexOf(active);
  const ordered =
    currentIndex >= 0
      ? [...enabled.slice(currentIndex + 1), ...enabled.slice(0, currentIndex + 1)]
      : enabled;

  return (
    ordered.find((option) => normalizeMatchText(option.labelText).startsWith(normalized)) ?? null
  );
}

export function observeAttribute(name: string): (def: { type: Function }) => void {
  return (def) => {
    const observed = (def.type as unknown as { observedAttributes: string[] }).observedAttributes;
    if (!observed.includes(name)) {
      observed.push(name);
    }
  };
}

export function reflectStringAttribute(element: Element, name: string, value: string | null): void {
  if (value === null) {
    if (element.hasAttribute(name)) {
      element.removeAttribute(name);
    }
  } else if (element.getAttribute(name) !== value) {
    element.setAttribute(name, value);
  }
}

export function resolveActiveOption(
  candidates: VioletOption[],
  current: VioletOption | null,
  activeValue: string,
  fallback: VioletOption | null,
): VioletOption | null {
  if (current && candidates.includes(current)) {
    return current;
  }
  if (current) {
    return candidates.find((option) => option.value === current.value) ?? fallback;
  }
  if (activeValue !== "") {
    return candidates.find((option) => option.value === activeValue) ?? fallback;
  }
  return fallback;
}

export function findOriginatingOption(event: Event, options: VioletOption[]): VioletOption | null {
  for (const node of event.composedPath()) {
    if (node instanceof Element && node.localName === "violet-option") {
      const option = node as VioletOption;
      if (options.includes(option) && !isOptionDisabled(option)) {
        return option;
      }
      return null;
    }
  }

  return null;
}

export function syncOptionSelection(
  options: VioletOption[],
  selectedOptions: ReadonlyArray<VioletOption>,
  activeOption: VioletOption | null,
): void {
  const selection = new Set(selectedOptions);

  for (const option of options) {
    option.groupDisabled = Boolean(
      (option.closest("violet-option-group") as { disabled?: boolean } | null)?.disabled,
    );
    option.selected = selection.has(option);
    option.active = activeOption !== null && option === activeOption;
  }
}
