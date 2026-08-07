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
if (process.platform === "darwin") app.setActivationPolicy("accessory");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

let mainWindow = null;

app.whenReady().then(async () => {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 320,
    show: false,
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
  mainWindow.showInactive();
});

app.on("window-all-closed", () => app.quit());
