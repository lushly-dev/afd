import type { VioletDataGridEditorOption } from "./violet-data-grid";

export function filterEditorOptions(
  options: VioletDataGridEditorOption[],
  query: string,
): VioletDataGridEditorOption[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return options;
  }

  return options.filter((option) => {
    const haystack = [
      option.label,
      option.value,
      option.description ?? "",
      ...(option.keywords ?? []),
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(normalizedQuery);
  });
}

export function optionForValue(
  options: VioletDataGridEditorOption[],
  value: string,
): VioletDataGridEditorOption | null {
  return options.find((option) => option.value === value) ?? null;
}

export function displayOptionForValue(
  options: VioletDataGridEditorOption[],
  value: string,
): VioletDataGridEditorOption {
  return (
    optionForValue(options, value) ?? {
      label: value,
      value,
    }
  );
}

export function optionStyle(option: VioletDataGridEditorOption): string {
  const visuals = resolveOptionVisuals(option);
  return `background:${visuals.background};color:${visuals.foreground};border-color:${visuals.borderColor};`;
}

export function resolveOptionVisuals(option: VioletDataGridEditorOption): {
  background: string;
  foreground: string;
  borderColor: string;
} {
  if (option.background || option.foreground || option.borderColor) {
    return {
      background: option.background ?? "var(--_surface-subtle)",
      foreground: option.foreground ?? "var(--_text-primary)",
      borderColor: option.borderColor ?? "transparent",
    };
  }

  switch (option.tone) {
    case "teal":
      return {
        background: "#0b7280",
        foreground: "#ffffff",
        borderColor: "transparent",
      };
    case "green":
      return {
        background: "#176c27",
        foreground: "#ffffff",
        borderColor: "transparent",
      };
    case "olive":
      return {
        background: "#547d46",
        foreground: "#f5fbf2",
        borderColor: "transparent",
      };
    case "gold":
      return {
        background: "#8b6b24",
        foreground: "#fff7de",
        borderColor: "transparent",
      };
    case "blue":
      return {
        background: "#416b89",
        foreground: "#ffffff",
        borderColor: "transparent",
      };
    case "gray":
      return {
        background: "#606672",
        foreground: "#f6f7fa",
        borderColor: "transparent",
      };
    default:
      return {
        background: "color-mix(in srgb, var(--_surface-subtle) 90%, white)",
        foreground: "var(--_text-primary)",
        borderColor: "color-mix(in srgb, var(--_border-subtle) 80%, transparent)",
      };
  }
}
