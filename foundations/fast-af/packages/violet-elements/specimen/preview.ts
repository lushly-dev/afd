import { setCustomElementsManifest } from "@lushly-dev/specimen/preview";
import type { Preview } from "@lushly-dev/specimen/types";

import customElementsManifest from "../custom-elements.json";
import { applyVioletThemePreset, installVioletTheme } from "../src/theme";

type VioletThemePreset = Parameters<typeof applyVioletThemePreset>[1];

// What every story gets. These are the values upstream's Storybook preview set, without what only
// its toolbar and addons read.
setCustomElementsManifest(customElementsManifest);
installVioletTheme();

function applyTheme(preset: VioletThemePreset): void {
  applyVioletThemePreset(document, preset);
  document.documentElement.style.colorScheme = preset === "dark" ? "dark" : "light";
  document.documentElement.style.backgroundColor = "var(--color-surface-page)";
  document.body.style.backgroundColor = "var(--color-surface-page)";
  document.body.style.color = "var(--color-text-primary)";
}

applyTheme("light");

const preview: Preview = {
  initialGlobals: {
    theme: "light",
    viewport: "responsive",
  },
  globalTypes: {
    theme: {
      description: "Violet runtime theme preset.",
      toolbar: {
        items: [
          { value: "light", title: "Light" },
          { value: "dark", title: "Dark" },
        ],
      },
    },
  },
  parameters: {
    layout: "padded",
    a11y: {
      test: "error",
    },
    viewport: {
      options: {
        responsive: {
          name: "Responsive",
          styles: {
            width: "100%",
            height: "100%",
          },
          type: "desktop",
        },
      },
      defaultViewport: "responsive",
    },
  },
  decorators: [
    (story, context) => {
      applyTheme((context.globals.theme ?? "light") as VioletThemePreset);
      return story();
    },
  ],
};

export default preview;
