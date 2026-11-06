import { config } from "../../package.json";
import { getPref } from "../utils/prefs";
import {
  clampTextFontSize,
  getInternalReader,
  setTextStyle,
  syncTextStyleFromReader,
} from "./readerBridge";

const TOOLBAR_ID = `${config.addonRef}-text-style`;

const TEXT_COLORS = [
  "#000000",
  "#ffd400",
  "#ff6666",
  "#5fb236",
  "#2ea8e5",
  "#a28ae5",
  "#e56eee",
  "#f19837",
  "#aaaaaa",
];

function buildToolbar(doc: Document): HTMLElement {
  const root = doc.createElement("div");
  root.id = TOOLBAR_ID;
  root.style.cssText = [
    "display:flex",
    "align-items:center",
    "gap:4px",
    "margin-left:8px",
    "padding:0 4px",
    "font-size:12px",
    "user-select:none",
  ].join(";");

  const label = doc.createElement("span");
  label.textContent = "Aa";
  label.title = "Text annotation size / color";
  root.appendChild(label);

  const minus = doc.createElement("button");
  minus.type = "button";
  minus.textContent = "−";
  minus.title = "Decrease font size";
  minus.style.cssText = buttonStyle();
  root.appendChild(minus);

  const input = doc.createElement("input");
  input.type = "number";
  input.min = "4";
  input.max = "192";
  input.step = "1";
  input.value = String(clampTextFontSize(Number(getPref("text.fontSize"))));
  input.title = "Text annotation font size (pt)";
  input.style.cssText =
    "width:48px;height:22px;box-sizing:border-box;text-align:center;";
  root.appendChild(input);

  const plus = doc.createElement("button");
  plus.type = "button";
  plus.textContent = "+";
  plus.title = "Increase font size";
  plus.style.cssText = buttonStyle();
  root.appendChild(plus);

  const colorInput = doc.createElement("input");
  colorInput.type = "color";
  colorInput.value = normalizeColor(String(getPref("text.color") || "#000000"));
  colorInput.title = "Text annotation color";
  colorInput.style.cssText = "width:28px;height:22px;padding:0;border:none;";
  root.appendChild(colorInput);

  const swatchRow = doc.createElement("div");
  swatchRow.style.cssText = "display:flex;gap:2px;align-items:center;";
  for (const color of TEXT_COLORS) {
    const swatch = doc.createElement("button");
    swatch.type = "button";
    swatch.title = color;
    swatch.dataset.color = color;
    swatch.style.cssText = [
      "width:14px",
      "height:14px",
      "border-radius:2px",
      `background:${color}`,
      "border:1px solid #888",
      "padding:0",
      "cursor:pointer",
    ].join(";");
    swatch.addEventListener("click", () => {
      colorInput.value = normalizeColor(color);
      setTextStyle({ color });
      refreshFromPrefs(input, colorInput);
    });
    swatchRow.appendChild(swatch);
  }
  root.appendChild(swatchRow);

  const applySize = (raw: number) => {
    const size = clampTextFontSize(raw);
    input.value = String(size);
    setTextStyle({ size });
  };

  minus.addEventListener("click", () => {
    applySize(Number(input.value) - 1);
  });
  plus.addEventListener("click", () => {
    applySize(Number(input.value) + 1);
  });
  input.addEventListener("change", () => {
    applySize(Number(input.value));
  });
  colorInput.addEventListener("change", () => {
    setTextStyle({ color: colorInput.value });
  });

  return root;
}

function buttonStyle(): string {
  return [
    "width:22px",
    "height:22px",
    "line-height:1",
    "padding:0",
    "cursor:pointer",
  ].join(";");
}

function normalizeColor(color: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(color)) {
    return color.toLowerCase();
  }
  return "#000000";
}

function refreshFromPrefs(
  input: HTMLInputElement,
  colorInput: HTMLInputElement,
): void {
  input.value = String(clampTextFontSize(Number(getPref("text.fontSize"))));
  colorInput.value = normalizeColor(String(getPref("text.color") || "#000000"));
}

function onRenderToolbar(event: {
  reader?: unknown;
  doc: Document;
  append: (...nodes: Node[]) => void;
}): void {
  const existing = event.doc.getElementById(TOOLBAR_ID);
  if (existing) {
    existing.remove();
  }
  const toolbar = buildToolbar(event.doc);
  event.append(toolbar);

  // Keep prefs in sync if the stock slider changed the tool size/color.
  syncTextStyleFromReader(event.reader as never);
  const ir = getInternalReader(event.reader as never);
  if (ir?._state?.tool?.type === "text") {
    const input = toolbar.querySelector(
      'input[type="number"]',
    ) as HTMLInputElement | null;
    const colorInput = toolbar.querySelector(
      'input[type="color"]',
    ) as HTMLInputElement | null;
    if (input && colorInput) {
      refreshFromPrefs(input, colorInput);
    }
  }
}

export function registerToolbarEnhancements(): void {
  Zotero.Reader.registerEventListener(
    "renderToolbar",
    onRenderToolbar,
    config.addonID,
  );
}

export function unregisterToolbarEnhancements(): void {
  try {
    Zotero.Reader.unregisterEventListener("renderToolbar", onRenderToolbar);
  } catch (e) {
    ztoolkit.log("unregisterToolbarEnhancements failed", e);
  }
}
