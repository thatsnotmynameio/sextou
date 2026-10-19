import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { errorPageURL } from './error-page';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
    },
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

  // Open the DevTools.
  mainWindow.webContents.openDevTools();
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
void app.whenReady().then(() => {
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
