export async function registerPrefsScripts(_window: Window): Promise<void> {
  // Prefs use native XUL preference bindings; no extra scripting required.
  addon.data.prefs = {
    window: _window,
    columns: [],
    rows: [],
  };
}
