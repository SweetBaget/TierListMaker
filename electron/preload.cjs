/**
 * Мост между окном приложения и главным процессом Electron.
 * Изолированный контекст: страница получает только узкий API.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tierlist', {
  isElectron: true,
  platform: process.platform,
  saveTextFile: (payload) => ipcRenderer.invoke('dialog:saveText', payload),
  openTextFile: (payload) => ipcRenderer.invoke('dialog:openText', payload),
  pickImage: () => ipcRenderer.invoke('dialog:pickImage'),
  appInfo: () => ipcRenderer.invoke('app:info'),
  onMenuAction: (handler) => {
    const listener = (_event, action) => handler(action);
    ipcRenderer.on('menu:action', listener);
    return () => ipcRenderer.removeListener('menu:action', listener);
  },
});
