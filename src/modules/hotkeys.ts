import { getPref } from "../utils/prefs";
import {
  AnnotationToolType,
  getActiveReader,
  isEditableTarget,
  setAnnotationTool,
} from "./readerBridge";

const TOOL_HOTKEYS: Record<string, AnnotationToolType> = {
  t: "text",
  b: "image",
  f: "ink",
  n: "note",
  u: "underline",
  i: "highlight",
  e: "eraser",
};

const attachedWindows = new WeakSet<Window>();

function handleToolHotkey(event: KeyboardEvent): void {
  if (!getPref("enableHotkeys")) {
    return;
  }
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
    return;
  }
  if (event.repeat) {
    return;
  }
  if (isEditableTarget(event.target)) {
    return;
  }

  const key = event.key.toLowerCase();
  const tool = TOOL_HOTKEYS[key];
  if (!tool) {
    return;
  }

  const reader = getActiveReader();
  if (!reader) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  setAnnotationTool(tool, { toggle: true });
}

export function registerHotkeys(): void {
  ztoolkit.Keyboard.register((ev) => {
    handleToolHotkey(ev);
  });
}

export function attachReaderHotkeys(win: Window): void {
  if (attachedWindows.has(win)) {
    return;
  }
  attachedWindows.add(win);
  win.addEventListener("keydown", handleToolHotkey, true);
}

export function ensureReaderHotkeys(): void {
  const reader = getActiveReader();
  const iframeWin = reader?._iframeWindow;
  if (iframeWin) {
    attachReaderHotkeys(iframeWin);
  }
}

export { TOOL_HOTKEYS };
