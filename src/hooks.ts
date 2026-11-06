import { initLocale } from "./utils/locale";
import { createZToolkit } from "./utils/ztoolkit";
import { registerPrefs } from "./modules/prefs";
import { registerPrefsScripts } from "./modules/preferenceScript";
import { handleNotify, registerNotifier } from "./modules/notifier";
import { registerHotkeys, ensureReaderHotkeys } from "./modules/hotkeys";
import {
  registerToolbarEnhancements,
  unregisterToolbarEnhancements,
} from "./modules/toolbarEnhancements";
import {
  registerTextAnnotationClipboard,
  ensureClipboardHandlers,
} from "./modules/textAnnotationClipboard";
import {
  registerNoteIconScale,
  unregisterNoteIconScale,
  ensureNoteIconScale,
} from "./modules/noteIconScale";

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();
  registerPrefs();
  registerNotifier();
  registerHotkeys();
  registerToolbarEnhancements();
  registerTextAnnotationClipboard();
  registerNoteIconScale();

  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );

  ensureReaderHotkeys();
  ensureClipboardHandlers();
  await ensureNoteIconScale();

  addon.data.initialized = true;
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  addon.data.ztoolkit = createZToolkit();

  win.MozXULElement.insertFTLIfNeeded(
    `${addon.data.config.addonRef}-mainWindow.ftl`,
  );

  ensureClipboardHandlers();
  ensureReaderHotkeys();
}

async function onMainWindowUnload(_win: Window): Promise<void> {
  ztoolkit.unregisterAll();
}

function onShutdown(): void {
  unregisterToolbarEnhancements();
  unregisterNoteIconScale();
  ztoolkit.unregisterAll();
  addon.data.alive = false;
  // @ts-expect-error - Plugin instance is not typed
  delete Zotero[addon.data.config.addonInstance];
}

async function onNotify(
  event: string,
  type: string,
  ids: Array<string | number>,
  extraData: { [key: string]: any },
) {
  await handleNotify(event, type, ids, extraData);
}

async function onPrefsEvent(type: string, data: { [key: string]: any }) {
  switch (type) {
    case "load":
      registerPrefsScripts(data.window);
      break;
    default:
      return;
  }
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onNotify,
  onPrefsEvent,
};
