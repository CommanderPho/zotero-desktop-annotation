import {
  getActiveReader,
  ReaderInstance,
  waitForInternalReader,
} from "./readerBridge";

const SCRIPT_VERSION = 3;
const INSTALLED_FLAG = "__zdaAltDragInstalled";
const VERSION_FLAG = "__zdaAltDragVersion";

/**
 * Runs inside the reader iframe compartment. PDF pointer events target the
 * nested pdf.js iframe (`view._iframeWindow`), while `_reader` / PDFView live
 * on the outer reader window — patch the view, listen on the nested iframe.
 */
const CONTENT_SCRIPT = `(() => {
  const SCRIPT_VERSION = ${SCRIPT_VERSION};
  const ORIGIN = "__zdaAltDupOrigin";
  const PATCH = "__zdaAltDragPatch";
  const ORIG_FN = "__zdaAltDragOriginalGetAction";
  const VIEW_LISTENERS = "__zdaAltDragViewListeners";

  function views() {
    const r = window._reader;
    if (!r) {
      return [];
    }
    return [r._primaryView, r._secondaryView].filter(Boolean);
  }

  // Reinstall on version bump: restore originals before re-wrapping.
  if (window.${VERSION_FLAG} === SCRIPT_VERSION && window.${INSTALLED_FLAG}) {
    window.__zdaAltDragEnsure && window.__zdaAltDragEnsure();
    return;
  }
  for (const view of views()) {
    if (view && view[ORIG_FN]) {
      view.getActionAtPosition = view[ORIG_FN];
      delete view[PATCH];
    }
    // Allow re-binding listeners after version bump (text moves use HTML5 DnD).
    if (view && view._iframeWindow) {
      delete view._iframeWindow[VIEW_LISTENERS];
    }
  }
  window.${INSTALLED_FLAG} = true;
  window.${VERSION_FLAG} = SCRIPT_VERSION;

  function patchView(view) {
    if (!view || typeof view.getActionAtPosition !== "function") {
      return false;
    }
    if (view[PATCH] && window.${VERSION_FLAG} === SCRIPT_VERSION) {
      return false;
    }
    const orig = (view[ORIG_FN] || view.getActionAtPosition).bind(view);
    view[ORIG_FN] = view[ORIG_FN] || view.getActionAtPosition;
    view.getActionAtPosition = function (position, event) {
      if (
        event &&
        event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !this._readOnly
      ) {
        try {
          if (this._textAnnotationFocused && this._textAnnotationFocused()) {
            return orig(position, event);
          }
          let suppress = false;
          const selected = this.getSelectedAnnotations
            ? this.getSelectedAnnotations()
            : [];
          if (
            selected.length === 1 &&
            selected[0].type === "text" &&
            !selected[0].readOnly
          ) {
            const a =
              this.getSelectedAnnotationAction &&
              this.getSelectedAnnotationAction(selected[0], position);
            if (a && (a.type === "moveAndDrag" || a.type === "move")) {
              suppress = true;
            } else if (a) {
              return orig(position, event);
            }
          }
          if (!suppress) {
            const hit =
              (this.getSelectableAnnotations &&
                this.getSelectableAnnotations(position)) ||
              [];
            const first = hit[0];
            suppress = !!(first && first.type === "text" && !first.readOnly);
          }
          if (suppress) {
            // Do not Proxy the event — Firefox IDL getters (button,
            // pointerType, …) throw on a Proxy receiver. Override altKey
            // on the real event for the duration of the original call.
            try {
              Object.defineProperty(event, "altKey", {
                configurable: true,
                enumerable: true,
                get: function () {
                  return false;
                },
              });
            } catch (e) {
              return orig(position, event);
            }
            try {
              return orig(position, event);
            } finally {
              try {
                delete event.altKey;
              } catch (e) {}
            }
          }
        } catch (e) {
          console.warn("[ZDA alt-drag] getActionAtPosition", e);
        }
      }
      return orig(position, event);
    };
    view[PATCH] = true;
    return true;
  }

  function snapshot(ann) {
    return {
      type: "text",
      color: ann.color,
      comment: ann.comment || "",
      pageLabel: ann.pageLabel || "",
      sortIndex: ann.sortIndex,
      position: JSON.parse(JSON.stringify(ann.position)),
    };
  }

  function tryStayBehind(view) {
    const origin = view[ORIGIN];
    if (!origin) {
      return;
    }
    const action = view.action;
    if (
      !action ||
      action.type !== "moveAndDrag" ||
      !action.triggered ||
      !action.annotation ||
      action.annotation.type !== "text"
    ) {
      return;
    }
    view[ORIGIN] = null;
    try {
      view._onAddAnnotation(
        {
          type: "text",
          color: origin.color,
          comment: origin.comment || "",
          pageLabel: origin.pageLabel || "",
          sortIndex: origin.sortIndex,
          position: JSON.parse(JSON.stringify(origin.position)),
        },
        false,
      );
      console.log("[ZDA alt-drag] stay-behind created");
    } catch (e) {
      console.warn("[ZDA alt-drag] stay-behind", e);
    }
  }

  function attachViewListeners(view) {
    const iframeWin = view._iframeWindow;
    if (!iframeWin || iframeWin[VIEW_LISTENERS] === SCRIPT_VERSION) {
      return;
    }
    iframeWin[VIEW_LISTENERS] = SCRIPT_VERSION;

    const alive = () => window.${VERSION_FLAG} === SCRIPT_VERSION;

    // Bubble: PDFView capture mousedown has already set action.
    iframeWin.addEventListener(
      "mousedown",
      (event) => {
        if (!alive()) {
          return;
        }
        view[ORIGIN] = null;
        if (
          !event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.button !== 0
        ) {
          return;
        }
        const action = view.action;
        if (
          action &&
          action.type === "moveAndDrag" &&
          action.annotation &&
          action.annotation.type === "text" &&
          action.annotation.position
        ) {
          view[ORIGIN] = snapshot(action.annotation);
          console.log("[ZDA alt-drag] origin snapshotted");
        }
      },
      false,
    );

    // Text annotation moves are HTML5 DnD: position updates on dragover
    // (dataTransfer present → action.triggered), commit on drop.
    iframeWin.addEventListener(
      "dragover",
      () => {
        if (alive()) {
          tryStayBehind(view);
        }
      },
      false,
    );

    const onDragDone = () => {
      if (!alive()) {
        return;
      }
      tryStayBehind(view);
      view[ORIGIN] = null;
    };
    iframeWin.addEventListener("drop", onDragDone, true);
    iframeWin.addEventListener("dragend", onDragDone, true);
    iframeWin.addEventListener("pointerup", onDragDone, true);
    iframeWin.addEventListener("pointercancel", onDragDone, true);
  }

  function ensure() {
    let patched = 0;
    for (const view of views()) {
      if (patchView(view)) {
        patched++;
        console.log("[ZDA alt-drag] patched view");
      }
      attachViewListeners(view);
    }
    return patched;
  }

  window.__zdaAltDragEnsure = ensure;
  ensure();
})();`;

function getReaderIframeWindow(
  reader: ReaderInstance,
): Window | null {
  const win = reader._iframeWindow;
  if (!win || Components.utils.isDeadWrapper(win)) {
    return null;
  }
  return win;
}

function injectContentScript(win: Window): boolean {
  const raw =
    (win as Window & { wrappedJSObject?: Window }).wrappedJSObject || win;

  // Prefer eval in the reader compartment (avoids CSP/script-tag quirks).
  try {
    if (typeof (raw as Window & { eval: typeof eval }).eval === "function") {
      (raw as Window & { eval: typeof eval }).eval(CONTENT_SCRIPT);
      return true;
    }
  } catch (e) {
    ztoolkit.log("alt-drag eval inject failed, trying script tag", e);
  }

  const doc = win.document;
  if (!doc?.documentElement) {
    return false;
  }
  const parent = doc.head || doc.documentElement;
  const existing = doc.getElementById("zda-alt-drag-script");
  existing?.remove();

  ztoolkit.UI.appendElement(
    {
      tag: "script",
      id: "zda-alt-drag-script",
      properties: {
        innerHTML: CONTENT_SCRIPT,
      },
    },
    parent,
  );
  return true;
}

export function applyTextAnnotationAltDrag(
  reader?: ReaderInstance | null,
): void {
  const active = reader ?? getActiveReader();
  if (!active) {
    return;
  }
  try {
    const win = getReaderIframeWindow(active);
    if (!win) {
      return;
    }

    const raw =
      (win as Window & { wrappedJSObject?: Window }).wrappedJSObject || win;
    const installedVersion = (
      raw as Window & { [VERSION_FLAG]?: number }
    )[VERSION_FLAG];
    if (installedVersion === SCRIPT_VERSION) {
      (
        raw as Window & { __zdaAltDragEnsure?: () => number }
      ).__zdaAltDragEnsure?.();
      return;
    }

    // Force re-eval on version bump (clears Proxy-based patches).
    (raw as Window & { [INSTALLED_FLAG]?: boolean })[INSTALLED_FLAG] = false;

    if (injectContentScript(win)) {
      ztoolkit.log("alt-drag content script injected", SCRIPT_VERSION);
    }
  } catch (e) {
    ztoolkit.log("applyTextAnnotationAltDrag failed", e);
  }
}

export async function ensureTextAnnotationAltDrag(
  reader?: ReaderInstance | null,
): Promise<void> {
  const active = reader ?? getActiveReader();
  if (!active) {
    return;
  }
  await waitForInternalReader(active);
  applyTextAnnotationAltDrag(active);

  for (const delay of [500, 1500, 3000]) {
    Zotero.Promise.delay(delay).then(() => {
      if (!addon.data.alive) {
        return;
      }
      applyTextAnnotationAltDrag(active);
    });
  }
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

export function registerTextAnnotationAltDrag(): void {
  if (pollTimer) {
    return;
  }
  applyTextAnnotationAltDrag();
  pollTimer = setInterval(() => {
    if (!addon.data.alive) {
      return;
    }
    applyTextAnnotationAltDrag();
  }, 4000);
}

export function unregisterTextAnnotationAltDrag(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
