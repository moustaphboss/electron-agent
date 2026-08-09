import { useEffect, useState } from "react";

type PingResult = { source: "button" | "menu"; message: string; timestamp: number };
type SaveResult = { canceled: boolean; filePath: string | null };

function App() {
  const [pingResult, setPingResult] = useState<PingResult | null>(null);
  const [pinging, setPinging] = useState(false);
  const [saveResult, setSaveResult] = useState<SaveResult | null>(null);
  const [saving, setSaving] = useState(false);

  async function runPing(source: "button" | "menu") {
    setPinging(true);
    try {
      const result = await window.demoAPI.ping();
      setPingResult({ source, ...result });
    } finally {
      setPinging(false);
    }
  }

  async function runSaveDialog() {
    setSaving(true);
    try {
      const result = await window.demoAPI.showSaveDialog();
      setSaveResult(result);
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    window.demoAPI.onMenuPing(() => runPing("menu"));
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-8 text-slate-100">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-2xl">
        <h1 className="text-2xl font-semibold tracking-tight">Electron Demo</h1>
        <p className="mt-1 text-sm text-slate-400">
          Renderer <span className="text-slate-500">↔</span> Main process, over IPC.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            id="ping-btn"
            onClick={() => runPing("button")}
            disabled={pinging}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pinging ? "Pinging…" : "Ping Main Process"}
          </button>
          <button
            id="save-btn"
            onClick={runSaveDialog}
            disabled={saving}
            className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-slate-100 transition hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Waiting for dialog…" : "Save File Dialog"}
          </button>
        </div>

        <div className="mt-6 space-y-2 font-mono text-xs">
          <p id="ping-result" className="min-h-[1.25rem] text-emerald-400">
            {pingResult &&
              `[${pingResult.source}] ${pingResult.message} @ ${pingResult.timestamp}`}
          </p>
          <p id="save-result" className="min-h-[1.25rem] text-sky-400">
            {saveResult &&
              (saveResult.canceled
                ? "Save dialog canceled"
                : `Saved to: ${saveResult.filePath}`)}
          </p>
        </div>
      </div>
    </div>
  );
}

export default App;
