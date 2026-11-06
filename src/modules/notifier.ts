import { ensureReaderHotkeys } from "./hotkeys";
import { ensureNoteIconScale } from "./noteIconScale";
import { ensureClipboardHandlers } from "./textAnnotationClipboard";
import { getActiveReader, waitForInternalReader } from "./readerBridge";

let notifierID: string | null = null;

async function onReaderReady(): Promise<void> {
  const reader = getActiveReader();
  if (!reader) {
    return;
  }
  await waitForInternalReader(reader);
  ensureReaderHotkeys();
  ensureClipboardHandlers();
  await ensureNoteIconScale(reader);
}

export function registerNotifier(): void {
  const callback = {
    notify: async (
      event: string,
      type: string,
      ids: Array<string | number>,
      extraData: { [key: string]: unknown },
    ) => {
      if (!addon?.data.alive) {
        if (notifierID) {
          unregisterNotifier();
        }
        return;
      }
      addon.hooks.onNotify(event, type, ids, extraData);
    },
  };

  notifierID = Zotero.Notifier.registerObserver(callback, ["tab"]);

  Zotero.Plugins.addObserver({
    shutdown: ({ id }) => {
      if (id === addon.data.config.addonID) {
        unregisterNotifier();
      }
    },
  });
}

export function unregisterNotifier(): void {
  if (!notifierID) {
    return;
  }
  Zotero.Notifier.unregisterObserver(notifierID);
  notifierID = null;
}

export async function handleNotify(
  event: string,
  type: string,
  ids: Array<string | number>,
  extraData: { [key: string]: unknown },
): Promise<void> {
  if (type !== "tab") {
    return;
  }
  if (event === "select" || event === "add") {
    const id = ids[0];
    const data = extraData?.[id as string] as { type?: string } | undefined;
    if (data?.type === "reader" || getActiveReader()) {
      await onReaderReady();
    }
  }
}
