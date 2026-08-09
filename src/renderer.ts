interface Window {
  demoAPI: {
    ping: () => Promise<{ message: string; timestamp: number }>;
    showSaveDialog: () => Promise<{ canceled: boolean; filePath: string | null }>;
    onMenuPing: (callback: () => void) => void;
  };
}

const pingBtn = document.getElementById("ping-btn") as HTMLButtonElement;
const saveBtn = document.getElementById("save-btn") as HTMLButtonElement;
const pingResult = document.getElementById("ping-result") as HTMLParagraphElement;
const saveResult = document.getElementById("save-result") as HTMLParagraphElement;

async function runPing(source: string): Promise<void> {
  const result = await window.demoAPI.ping();
  pingResult.textContent = `[${source}] ${result.message} @ ${result.timestamp}`;
}

pingBtn.addEventListener("click", () => runPing("button"));

saveBtn.addEventListener("click", async () => {
  const result = await window.demoAPI.showSaveDialog();
  saveResult.textContent = result.canceled
    ? "Save dialog canceled"
    : `Saved to: ${result.filePath}`;
});

window.demoAPI.onMenuPing(() => runPing("menu"));
