import { config } from "dotenv";
config();

import { app, BrowserWindow, Menu, ipcMain, dialog } from "electron";
import * as path from "path";
import Anthropic from "@anthropic-ai/sdk";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { connectMcpClient } from "./mcpClient";
import { runAgentLoop } from "./agentLoop";

let mainWindow: BrowserWindow | null = null;
let mcpClient: Client | null = null;
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

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

ipcMain.handle("ask-agent", async (_event, message: string) => {
  if (!mcpClient) {
    throw new Error("MCP client is not connected yet.");
  }
  try {
    return await runAgentLoop(message, mcpClient, anthropic);
  } catch (err) {
    console.error("[agent] failed:", err);
    if (err instanceof Anthropic.APIError && err.status && err.status >= 500) {
      return "The AI service is temporarily overloaded. Please try asking again in a moment.";
    }
    if (err instanceof Anthropic.APIError && err.status === 429) {
      return "Rate limit reached. Please wait a moment before asking again.";
    }
    return "Something went wrong answering that — please try again.";
  }
});

app.whenReady().then(async () => {
  createWindow();

  mcpClient = await connectMcpClient();
  const { tools } = await mcpClient.listTools();
  console.log(
    "[mcp] connected, tools:",
    tools.map((t) => t.name),
  );
});

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
