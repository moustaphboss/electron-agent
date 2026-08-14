import { test, expect, _electron as electron } from "@playwright/test";
import path from "node:path";

const APP_DIR = path.resolve(__dirname, "..");

test("asking for a specific photo renders its image end-to-end", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;

  const app = await electron.launch({ args: [APP_DIR], env });
  const page = await app.firstWindow();

  await page
    .locator("#agent-input")
    .fill("Show me the details for photo id 1.");
  await page.locator("#agent-ask-btn").click();

  // Ask re-enables once agent-done/agent-error fires — the real signal that
  // the full round trip (IPC -> agent loop -> MCP tool -> SQLite) finished.
  await expect(page.locator("#agent-ask-btn")).toBeEnabled({ timeout: 45_000 });

  // Deterministic, model-wording-independent proof the full stack ran.
  await expect(page.locator("#agent-chat img").first()).toBeVisible();

  await app.close();
});
