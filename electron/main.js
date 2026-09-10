/**
 * Главный процесс Electron: окно приложения, системные диалоги файлов,
 * отдача статики через защищённую схему app:// (нужна для ES-модулей и CSP).
 */

import { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DEV_URL = process.env.TIERLIST_DEV_URL || null;

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
  },
]);

/** Отдаём файлы приложения из корня проекта через app://tierlist/... */
function registerProtocol() {
  protocol.handle('app', async (request) => {
    try {
      const url = new URL(request.url);
      let rel = decodeURIComponent(url.pathname);
      if (rel === '/' || rel === '') rel = '/index.html';
      const target = path.normalize(path.join(ROOT, rel));
      if (!target.startsWith(ROOT)) return new Response('Forbidden', { status: 403 });
      return await net.fetch(pathToFileURL(target).toString());
    } catch (err) {
      return new Response(`Не найдено: ${err.message}`, { status: 404 });
    }
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#0f1116',
    show: false,
    title: 'Tier List Maker',
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  if (DEV_URL) win.loadURL(DEV_URL);
  else win.loadURL('app://tierlist/index.html');
  return win;
}

function buildMenu() {
  const template = [
    {
      label: 'Файл',
      submenu: [
        { label: 'Новый тир-лист', accelerator: 'CmdOrCtrl+N', click: (_i, win) => win?.webContents.send('menu:action', 'new') },
        { label: 'Импорт из JSON…', accelerator: 'CmdOrCtrl+O', click: (_i, win) => win?.webContents.send('menu:action', 'import') },
        { label: 'Экспорт в JSON…', accelerator: 'CmdOrCtrl+S', click: (_i, win) => win?.webContents.send('menu:action', 'export') },
        { type: 'separator' },
        { role: 'quit', label: 'Выход' },
      ],
    },
    {
      label: 'Правка',
      submenu: [
        { role: 'undo', label: 'Отменить' },
        { role: 'redo', label: 'Повторить' },
        { type: 'separator' },
        { role: 'cut', label: 'Вырезать' },
        { role: 'copy', label: 'Копировать' },
        { role: 'paste', label: 'Вставить' },
        { role: 'selectAll', label: 'Выделить всё' },
      ],
    },
    {
      label: 'Вид',
      submenu: [
        { role: 'reload', label: 'Обновить' },
        { role: 'toggleDevTools', label: 'Инструменты разработчика' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Масштаб 100%' },
        { role: 'zoomIn', label: 'Увеличить' },
        { role: 'zoomOut', label: 'Уменьшить' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Полный экран' },
      ],
    },
    {
      label: 'Справка',
      submenu: [
        {
          label: 'О приложении',
          click: (_i, win) =>
            dialog.showMessageBox(win, {
              type: 'info',
              title: 'Tier List Maker',
              message: `Tier List Maker ${app.getVersion()}`,
              detail:
                'Тир-лист с настраиваемыми зонами, шкалами оценки, весами и автоматической подстройкой баллов.\n' +
                `Electron ${process.versions.electron} · Chromium ${process.versions.chrome} · Node ${process.versions.node}`,
              buttons: ['ОК'],
            }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ------------------------------ файловые IPC ------------------------------ */

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
};

ipcMain.handle('dialog:saveText', async (event, payload = {}) => {
  const { suggestedName = 'tier-list.json', content = '', filters = [{ name: 'JSON', extensions: ['json'] }], title = 'Сохранить файл' } =
    payload;
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title,
    defaultPath: path.join(app.getPath('documents'), suggestedName),
    filters,
    properties: ['createDirectory', 'showOverwriteConfirmation'],
  });
  if (canceled || !filePath) return { canceled: true };
  try {
    await fs.writeFile(filePath, content, 'utf8');
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, error: `Не удалось записать файл: ${err.message}` };
  }
});

ipcMain.handle('dialog:openText', async (event, payload = {}) => {
  const { filters = [{ name: 'JSON', extensions: ['json'] }], title = 'Открыть файл' } = payload;
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, { title, filters, properties: ['openFile'] });
  if (canceled || !filePaths?.length) return { canceled: true };
  try {
    const content = await fs.readFile(filePaths[0], 'utf8');
    return { ok: true, content, path: filePaths[0] };
  } catch (err) {
    return { ok: false, error: `Не удалось прочитать файл: ${err.message}` };
  }
});

ipcMain.handle('dialog:pickImage', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Выберите картинку',
    filters: [{ name: 'Картинки', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths?.length) return { canceled: true };
  try {
    const filePath = filePaths[0];
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    const buffer = await fs.readFile(filePath);
    return { ok: true, dataUrl: `data:${mime};base64,${buffer.toString('base64')}`, path: filePath };
  } catch (err) {
    return { ok: false, error: `Не удалось прочитать картинку: ${err.message}` };
  }
});

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  platform: process.platform,
  versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
  userData: app.getPath('userData'),
}));

/* ------------------------------ запуск ------------------------------ */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    registerProtocol();
    buildMenu();
    createWindow();
    app.on('activate', () => {
      if (!BrowserWindow.getAllWindows().length) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
