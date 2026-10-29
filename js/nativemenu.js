// In the Tauri desktop app the web menu bar is replaced by the native (macOS) system menu.
// Native menu item ids are CSS selectors of the web buttons, which are clicked on selection.
// Exceptions: Undo/Redo/Cut/Copy/Paste/Select All act on the focused text field if there is one, and Select All
// otherwise triggers the editor's own "select all" shortcut.
const tauri = window.__TAURI__;
export const isTauri = !!(tauri?.core && tauri?.event);

if (isTauri) {
  document.body.classList.add('native-menu');
  const inTextField = () => document.activeElement?.matches('textarea, input:not([type=checkbox],[type=color],[type=button],[type=range])');
  const textCmd = { '#undo': 'undo', '#redo': 'redo', '#cut': 'cut', '#copy': 'copy' };
  tauri.event.listen('menu-action', e => {
    const sel = e.payload;
    if (inTextField()) {
      if (sel === '#selectAll') return void document.activeElement.select();
      if (sel === '#paste') return void navigator.clipboard.readText().then(t => document.execCommand('insertText', false, t));
      if (textCmd[sel]) return void document.execCommand(textCmd[sel]);
    }
    if (sel === '#selectAll') {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }));
      return;
    }
    document.querySelector(sel)?.click();
  });
  // Mirror the enabled state of the web buttons (e.g. Undo/Redo) into the native menu
  for (const sel of ['#undo', '#redo', '#cut', '#copy', '#paste', '#dup', '#cloneRef', '#del']) {
    const btn = document.querySelector(sel);
    if (!btn) continue;
    const sync = () => tauri.core.invoke('set_menu_enabled', { id: sel, enabled: !btn.disabled });
    new MutationObserver(sync).observe(btn, { attributes: true, attributeFilter: ['disabled'] });
    sync();
  }
}
