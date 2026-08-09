import { app, BrowserWindow, Menu, ipcMain, dialog } from "electron";
import * as path from "path";

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "..", "index.html"));

  const menu = Menu.buildFromTemplate([
    {
      label: "Demo",
      submenu: [
        {
          label: "Ping Renderer",
          click: () => {
            mainWindow?.webContents.send("menu-ping");
          },
        },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

ipcMain.handle("ping", async () => {
  return { message: "pong", timestamp: Date.now() };
});

ipcMain.handle("show-save-dialog", async () => {
  if (!mainWindow) {
    return { canceled: true };
  }
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Save Demo File",
    defaultPath: "demo.txt",
  });
  return { canceled: result.canceled, filePath: result.filePath ?? null };
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
