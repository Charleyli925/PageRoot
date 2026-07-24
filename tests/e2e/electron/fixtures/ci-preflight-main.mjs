import {
  app,
  BrowserWindow,
} from "electron";
import path from "node:path";

const isolatedUserData = process.env.PAGEROOT_ELECTRON_PREFLIGHT_USER_DATA;
if (!isolatedUserData || !path.isAbsolute(isolatedUserData)) {
  throw new Error("PAGEROOT_ELECTRON_PREFLIGHT_USER_DATA must be an absolute path.");
}

app.setPath("userData", isolatedUserData);
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

let mainWindow = null;

app.whenReady().then(async () => {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 320,
    show: true,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.webContents.setBackgroundThrottling(false);
  await mainWindow.loadURL(
    "data:text/html;charset=utf-8,"
    + encodeURIComponent(
      "<!doctype html><html><body>"
      + '<main data-testid="electron-preflight-ready">Electron environment ready</main>'
      + "</body></html>",
    ),
  );
  mainWindow.show();
  mainWindow.focus();
});

app.on("window-all-closed", () => app.quit());
