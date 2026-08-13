import { config } from "dotenv";
config();

import { app, BrowserWindow, Menu, ipcMain, dialog, protocol } from "electron";
import * as path from "path";
import { readFile } from "fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { connectMcpClient } from "./mcpClient";
import { runAgentLoop } from "./agentLoop";
import { runLangGraphAgentLoop } from "./langGraphAgentLoop";

export type AgentMode = "hand-rolled" | "langgraph";

const APP_NAME = "Mustipix";
const iconPath = path.join(__dirname, "../../resources/icon.png");

app.setName(APP_NAME);

// Lets the renderer safely display local photo files without disabling
// Electron's webSecurity or exposing the filesystem directly.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "photo-file",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

let mainWindow: BrowserWindow | null = null;
let mcpClient: Client | null = null;
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 750,
    title: APP_NAME,
    icon: iconPath,
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

ipcMain.handle("list-mcp-connections", async () => {
  if (!mcpClient) {
    return [];
  }
  const { tools } = await mcpClient.listTools();
  return [
    {
      name: "mcp-server",
      tools: tools.map((t) => ({ name: t.name, description: t.description })),
    },
  ];
});

ipcMain.handle(
  "ask-agent",
  async (_event, message: string, mode: AgentMode = "hand-rolled") => {
    if (!mcpClient) {
      throw new Error("MCP client is not connected yet.");
    }
    try {
      return mode === "langgraph"
        ? await runLangGraphAgentLoop(message, mcpClient)
        : await runAgentLoop(message, mcpClient, anthropic);
    } catch (err) {
      console.error("[agent] failed:", err);
      if (
        err instanceof Anthropic.APIError &&
        err.status &&
        err.status >= 500
      ) {
        return {
          text: "The AI service is temporarily overloaded. Please try asking again in a moment.",
          images: [],
        };
      }
      if (err instanceof Anthropic.APIError && err.status === 429) {
        return {
          text: "Rate limit reached. Please wait a moment before asking again.",
          images: [],
        };
      }
      return {
        text: "Something went wrong answering that — please try again.",
        images: [],
      };
    }
  },
);

app.whenReady().then(async () => {
  if (process.platform === "darwin") {
    app.dock?.setIcon(iconPath);
  }

  protocol.handle("photo-file", async (request) => {
    const url = new URL(request.url);
    const filePath = decodeURIComponent(url.pathname.slice(1));
    try {
      const data = await readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const contentType = ext === ".png" ? "image/png" : "image/jpeg";
      return new Response(data, { headers: { "content-type": contentType } });
    } catch {
      return new Response(null, { status: 404 });
    }
  });

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
