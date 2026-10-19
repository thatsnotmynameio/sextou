import { app, BrowserWindow, session, shell } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { errorPageURL } from './error-page';
import { linkAction } from './link-policy';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Hands a link to the default browser or mail app. On Linux this rejects when
// no app handles the scheme; the window has nothing to do about it.
const openExternally = (url: string) => {
  shell.openExternal(new URL(url).href).catch(() => undefined);
};

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      // Electron's defaults, stated so a change can't drop them silently.
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  // The window stays on the web app. A link to another site opens in the
  // default browser instead, and anything else opens nothing.
  mainWindow.webContents.on('will-navigate', (event) => {
    const action = linkAction(SEXTOU_WEB_URL, event.url);
    if (action !== 'allow') {
      event.preventDefault();
    }
    if (action === 'external') {
      openExternally(event.url);
    }
  });
  // A server redirect to another origin is stopped too. On the first load
  // there is no page to stay on, and a stopped navigation doesn't emit
  // did-fail-load, so the window shows the error page.
  mainWindow.webContents.on('will-redirect', (event) => {
    if (
      event.isMainFrame &&
      linkAction(SEXTOU_WEB_URL, event.url) !== 'allow'
    ) {
      event.preventDefault();
      if (mainWindow.webContents.getURL() === '') {
        void mainWindow.loadURL(errorPageURL(SEXTOU_WEB_URL));
      }
    }
  });
  // The app never opens a second window: a link that asks for one opens in
  // the default browser, even when it points at the web app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (linkAction(SEXTOU_WEB_URL, url) !== 'block') {
      openExternally(url);
    }
    return { action: 'deny' };
  });

  // Load the web app. When it can't load (offline, server down), show the
  // bundled error page instead. -3 (ERR_ABORTED) is a navigation another one
  // replaced, not a failure.
  mainWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, _description, _url, isMainFrame) => {
      if (isMainFrame && errorCode !== -3) {
        void mainWindow.loadURL(errorPageURL(SEXTOU_WEB_URL));
      }
    },
  );
  // did-fail-load handles a failure; the rejected promise has nothing to add.
  mainWindow.loadURL(SEXTOU_WEB_URL).catch(() => undefined);

  // Open the DevTools in development. The packaged app keeps them in the
  // View menu.
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
void app.whenReady().then(() => {
  // Deny every permission a page asks for (camera, microphone, location,
  // notifications...) without prompting. Electron grants them all otherwise.
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => {
      callback(false);
    },
  );
  session.defaultSession.setPermissionCheckHandler(() => false);

  createWindow();

  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
