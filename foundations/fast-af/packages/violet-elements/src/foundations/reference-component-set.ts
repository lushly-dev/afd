export type ReferenceComponentDefinition = {
  id: string;
  title: string;
  status: "done" | "next" | "planned";
  shape: string;
  validates: string[];
  whyItMatters: string;
};

export const referenceComponentSet: ReferenceComponentDefinition[] = [
  {
    id: "data-grid",
    title: "Data Grid",
    status: "done",
    shape: "Dense structured data, selection, sorting, scrolling, and composed controls.",
    validates: ["surface hierarchy", "row states", "selection", "spacing density", "focus visibility"],
    whyItMatters:
      "It is the richest composite in the set and pressure-tests nearly every foundational token family at once.",
  },
  {
    id: "button",
    title: "Button",
    status: "done",
    shape: "Primary action surface with text, icon, disabled, and focus states.",
    validates: ["action emphasis", "shape", "focus ring", "inline spacing"],
    whyItMatters:
      "Buttons set the tone for interaction hierarchy and quickly expose weak action or focus tokens.",
  },
  {
    id: "text-field",
    title: "Text Field",
    status: "done",
    shape: "Input shell with text, label, placeholder, focus, and helper/error adjacency.",
    validates: ["input surfaces", "border hierarchy", "text roles", "control sizing"],
    whyItMatters:
      "Text fields are one of the fastest ways to see whether the system has the right neutral control vocabulary.",
  },
  {
    id: "checkbox",
    title: "Checkbox",
    status: "done",
    shape: "Binary control with label, selected, hover, focus, and compact inline states.",
    validates: ["control geometry", "selection styling", "target size", "label spacing"],
    whyItMatters:
      "Checkboxes catch subtle issues with density, alignment, and interactive contrast in the smallest reusable control shapes.",
  },
  {
    id: "radio",
    title: "Radio",
    status: "done",
    shape: "Single-choice control with label, selected, focus, and compact inline states.",
    validates: ["control geometry", "selection styling", "target size", "label spacing"],
    whyItMatters:
      "Radio controls prove whether grouped selection states and compact control sizing still feel precise and intentional.",
  },
  {
    id: "switch",
    title: "Switch",
    status: "done",
    shape: "Binary toggle with on/off track, thumb motion, label, and focus treatment.",
    validates: ["binary state clarity", "motion cues", "control sizing", "target size"],
    whyItMatters:
      "Switches round out the core control family and force us to reconcile motion, binary contrast, and compact affordance sizing.",
  },
  {
    id: "tabs",
    title: "Tabs",
    status: "done",
    shape: "Horizontal navigation/selection pattern with active, hover, and focus states.",
    validates: ["navigation emphasis", "selected vs resting states", "divider logic"],
    whyItMatters:
      "Tabs clarify whether the token set distinguishes persistent selection from simple structure.",
  },
  {
    id: "slider",
    title: "Slider",
    status: "done",
    shape: "Continuous range control with track, thumb, active range, and labels.",
    validates: ["track contrast", "interactive target sizing", "focus visibility"],
    whyItMatters:
      "Sliders expose whether interactive accents and small control geometry hold up under motion and input pressure.",
  },
  {
    id: "card",
    title: "Card",
    status: "done",
    shape: "Contained content surface with title, metadata, body copy, and action region.",
    validates: ["surface nesting", "shadow usage", "content spacing", "text hierarchy"],
    whyItMatters:
      "Cards help us reconcile the broad visual language of the system outside of form controls.",
  },
  {
    id: "menu",
    title: "Menu / Popover",
    status: "done",
    shape: "Floating selection surface with grouped items, hover, selected, and focus states.",
    validates: ["floating surfaces", "elevation", "recessed structure", "menu-item spacing"],
    whyItMatters:
      "Menus prove whether floating tokens are actually distinct enough from cards and pages to feel intentional.",
  },
  {
    id: "carousel",
    title: "Carousel",
    status: "done",
    shape: "Paged horizontal surface with slotted slides, generated navigation, and active item state.",
    validates: ["scroll snapping", "overlay-free navigation", "active vs inactive content", "control grouping"],
    whyItMatters:
      "Carousels pressure-test how well the system handles reusable composite navigation around arbitrary content instead of one fixed media type.",
  },
  {
    id: "tree",
    title: "Tree",
    status: "done",
    shape: "Hierarchical navigation and selection surface with expansion, focus movement, and nested item metadata.",
    validates: ["hierarchy clarity", "keyboard traversal", "selection vs focus", "nested spacing", "branch indicators"],
    whyItMatters:
      "Trees prove whether the system can express hierarchy, expansion, and single selection without collapsing into listbox or accordion patterns.",
  },
  {
    id: "color-picker",
    title: "Color Picker",
    status: "done",
    shape: "Field-like color selection control with a swatch trigger, textual value, channel editing, and suggested presets.",
    validates: ["non-color value fallback", "popover composition", "token-driven previews", "form value clarity", "editable color channels"],
    whyItMatters:
      "Color pickers pressure-test whether the system can expose complex visual input without relying on color alone or falling back to browser-default chrome.",
  },
];
