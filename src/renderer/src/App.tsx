import { useEffect, useRef, useState } from "react";
import type { McpConnection, UIBlock } from "../../preload/index";
import iconUrl from "./assets/icon.png";

type PingResult = {
  source: "button" | "menu";
  message: string;
  timestamp: number;
};
type SaveResult = { canceled: boolean; filePath: string | null };
type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  images?: string[];
  ui?: UIBlock[];
};
type ChatSession = { id: string; title: string; messages: ChatMessage[] };

function photoUrl(filePath: string): string {
  return `photo-file://local/${encodeURIComponent(filePath)}`;
}

function UITableBlock({ block }: { block: Extract<UIBlock, { type: "table" }> }) {
  return (
    <div className="mt-2 max-w-[85%] overflow-x-auto rounded-lg bg-slate-800 p-2">
      {block.title && (
        <p className="mb-1 text-xs font-semibold text-white">{block.title}</p>
      )}
      <table className="w-full text-left text-xs text-white">
        <thead>
          <tr>
            {block.columns.map((c) => (
              <th key={c.key} className="px-2 py-1 text-slate-400">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, i) => (
            <tr key={i} className="border-t border-slate-700">
              {block.columns.map((c) => (
                <td key={c.key} className="px-2 py-1">
                  {row[c.key] ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function App() {
  const [pingResult, setPingResult] = useState<PingResult | null>(null);
  const [pinging, setPinging] = useState(false);
  const [saveResult, setSaveResult] = useState<SaveResult | null>(null);
  const [saving, setSaving] = useState(false);

  const [agentMessage, setAgentMessage] = useState("");
  const [currentMessages, setCurrentMessages] = useState<ChatMessage[]>([]);
  const [pastChats, setPastChats] = useState<ChatSession[]>([]);
  const [viewingChatId, setViewingChatId] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [agentMode, setAgentMode] = useState<"hand-rolled" | "langgraph">(
    "hand-rolled",
  );
  const [a2uiEnabled, setA2uiEnabled] = useState(true);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const activeRequestId = useRef<string | null>(null);

  const [showExtensions, setShowExtensions] = useState(false);
  const [mcpConnections, setMcpConnections] = useState<McpConnection[]>([]);
  const [loadingConnections, setLoadingConnections] = useState(false);
  const [expandedImage, setExpandedImage] = useState<string | null>(null);

  const isReadOnly = viewingChatId !== null;
  const displayedMessages = viewingChatId
    ? (pastChats.find((c) => c.id === viewingChatId)?.messages ?? [])
    : currentMessages;

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

  function runAskAgent() {
    if (!agentMessage.trim() || isReadOnly) return;
    const userText = agentMessage;
    setCurrentMessages((prev) => [
      ...prev,
      { role: "user", content: userText },
    ]);
    setAgentMessage("");
    setStreamingText("");
    setAsking(true);
    const requestId = crypto.randomUUID();
    activeRequestId.current = requestId;
    window.demoAPI.askAgentStream(requestId, userText, agentMode, a2uiEnabled);
  }

  function startNewChat() {
    if (currentMessages.length > 0) {
      const firstUserMessage = currentMessages.find((m) => m.role === "user");
      const title = firstUserMessage
        ? firstUserMessage.content.slice(0, 40) +
          (firstUserMessage.content.length > 40 ? "…" : "")
        : "Untitled chat";
      setPastChats((prev) => [
        { id: crypto.randomUUID(), title, messages: currentMessages },
        ...prev,
      ]);
    }
    setCurrentMessages([]);
    setViewingChatId(null);
  }

  async function openExtensions() {
    setShowExtensions(true);
    setLoadingConnections(true);
    try {
      const connections = await window.demoAPI.listMcpConnections();
      setMcpConnections(connections);
    } finally {
      setLoadingConnections(false);
    }
  }

  useEffect(() => {
    window.demoAPI.onMenuPing(() => runPing("menu"));
  }, []);

  useEffect(() => {
    window.demoAPI.onAgentChunk((requestId, delta) => {
      if (requestId !== activeRequestId.current) return;
      setStreamingText((prev) => prev + delta);
    });
    window.demoAPI.onAgentReset((requestId) => {
      if (requestId !== activeRequestId.current) return;
      setStreamingText("");
    });
    window.demoAPI.onAgentDone((requestId, reply) => {
      if (requestId !== activeRequestId.current) return;
      activeRequestId.current = null;
      setCurrentMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: reply.text,
          images: reply.images,
          ui: reply.ui,
        },
      ]);
      setStreamingText("");
      setAsking(false);
    });
    window.demoAPI.onAgentError((requestId, message) => {
      if (requestId !== activeRequestId.current) return;
      activeRequestId.current = null;
      setCurrentMessages((prev) => [
        ...prev,
        { role: "assistant", content: message },
      ]);
      setStreamingText("");
      setAsking(false);
    });
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [displayedMessages, asking, streamingText]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setExpandedImage(null);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100">
      {/* Sidebar */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-slate-800 bg-slate-900 p-4">
        <div className="flex items-center gap-2">
          <img src={iconUrl} alt="" className="h-6 w-6 rounded" />
          <h1 className="text-lg font-semibold tracking-tight">Mustipix</h1>
        </div>

        <button
          id="new-chat-btn"
          onClick={startNewChat}
          className="mt-4 cursor-pointer rounded-lg bg-indigo-600 px-3 py-2 text-left text-sm font-medium text-white transition hover:bg-indigo-500"
        >
          + New Chat
        </button>
        <button
          id="extensions-btn"
          onClick={openExtensions}
          className="mt-2 cursor-pointer rounded-lg bg-slate-800 px-3 py-2 text-left text-sm font-medium text-slate-100 transition hover:bg-slate-700"
        >
          Extensions
        </button>

        <p className="mt-6 text-xs font-semibold uppercase tracking-wide text-slate-500">
          History
        </p>
        <div
          id="chat-history-list"
          className="mt-2 flex-1 space-y-1 overflow-y-auto"
        >
          {currentMessages.length > 0 && (
            <button
              onClick={() => setViewingChatId(null)}
              className={`w-full cursor-pointer truncate rounded-lg px-3 py-2 text-left text-xs transition ${
                !isReadOnly
                  ? "bg-slate-800 text-slate-100"
                  : "text-slate-400 hover:bg-slate-800/50"
              }`}
            >
              {currentMessages.find((m) => m.role === "user")?.content ??
                "Current chat"}
            </button>
          )}
          {pastChats.map((chat) => (
            <button
              key={chat.id}
              onClick={() => setViewingChatId(chat.id)}
              className={`w-full cursor-pointer truncate rounded-lg px-3 py-2 text-left text-xs transition ${
                viewingChatId === chat.id
                  ? "bg-slate-800 text-slate-100"
                  : "text-slate-400 hover:bg-slate-800/50"
              }`}
            >
              {chat.title}
            </button>
          ))}
          {pastChats.length === 0 && currentMessages.length === 0 && (
            <p className="px-3 text-xs text-slate-600">No chats yet.</p>
          )}
        </div>
      </aside>

      {/* Main content */}
      <main className="flex flex-1 flex-col overflow-y-auto p-8">
        <p className="text-sm text-slate-400">
          Renderer <span className="text-slate-500">↔</span> Main process, over
          IPC.
        </p>

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            id="ping-btn"
            onClick={() => runPing("button")}
            disabled={pinging}
            className="cursor-pointer rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pinging ? "Pinging…" : "Ping Main Process"}
          </button>
          <button
            id="save-btn"
            onClick={runSaveDialog}
            disabled={saving}
            className="cursor-pointer rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-slate-100 transition hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Waiting for dialog…" : "Save File Dialog"}
          </button>
        </div>

        <div className="mt-4 space-y-2 font-mono text-xs">
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

        <div className="mt-8 flex flex-1 flex-col border-t border-slate-800 pt-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-200">
              Ask Agent (photo library)
            </h2>
            <div className="flex gap-1 rounded-lg bg-slate-800 p-1 text-xs">
              <button
                id="mode-hand-rolled-btn"
                onClick={() => setAgentMode("hand-rolled")}
                className={`cursor-pointer rounded-md px-3 py-1.5 font-medium transition ${
                  agentMode === "hand-rolled"
                    ? "bg-indigo-600 text-white"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Hand-rolled loop
              </button>
              <button
                id="mode-langgraph-btn"
                onClick={() => setAgentMode("langgraph")}
                className={`cursor-pointer rounded-md px-3 py-1.5 font-medium transition ${
                  agentMode === "langgraph"
                    ? "bg-indigo-600 text-white"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                LangGraph
              </button>
            </div>
          </div>

          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-slate-400">
              A2UI (agent-driven table rendering)
            </span>
            <button
              id="a2ui-toggle-btn"
              type="button"
              role="switch"
              aria-checked={a2uiEnabled}
              onClick={() => setA2uiEnabled((v) => !v)}
              className={`inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                a2uiEnabled ? "bg-indigo-600" : "bg-slate-700"
              }`}
            >
              <span
                aria-hidden="true"
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                  a2uiEnabled ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          {isReadOnly && (
            <p className="mt-3 rounded-lg bg-amber-900/30 px-3 py-2 text-xs text-amber-400">
              Viewing a past chat. Start a New Chat to continue asking
              questions.
            </p>
          )}

          <div
            id="agent-chat"
            className="mt-3 flex-1 space-y-3 overflow-y-auto rounded-lg bg-slate-950/50 p-3"
          >
            {displayedMessages.length === 0 && (
              <p className="text-xs text-slate-500">
                Ask something to get started.
              </p>
            )}
            {displayedMessages.map((m, i) => (
              <div
                key={i}
                className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}
              >
                <p
                  className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-xs ${
                    m.role === "user"
                      ? "bg-indigo-600 text-white"
                      : "bg-slate-800 text-white"
                  }`}
                >
                  {m.content}
                </p>
                {m.images && m.images.length > 0 && (
                  <div className="mt-2 flex max-w-[85%] flex-wrap gap-2">
                    {m.images.map((imgPath) => (
                      <img
                        key={imgPath}
                        src={photoUrl(imgPath)}
                        alt={imgPath.split("/").pop()}
                        onClick={() => setExpandedImage(imgPath)}
                        className="h-24 w-24 cursor-pointer rounded-lg object-cover transition hover:opacity-80"
                      />
                    ))}
                  </div>
                )}
                {m.ui?.map((block, bi) => (
                  <UITableBlock key={bi} block={block} />
                ))}
              </div>
            ))}
            {asking && !isReadOnly && (
              <div className="flex justify-start">
                <p
                  className={`max-w-[85%] whitespace-pre-wrap rounded-lg bg-slate-800 px-3 py-2 text-xs ${
                    streamingText ? "text-white" : "text-slate-400"
                  }`}
                >
                  {streamingText || "Thinking…"}
                </p>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {!isReadOnly && (
            <div className="mt-3 flex gap-2">
              <input
                id="agent-input"
                type="text"
                value={agentMessage}
                onChange={(e) => setAgentMessage(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runAskAgent()}
                placeholder="e.g. find my Switzerland shots at f/8 or narrower"
                disabled={asking}
                className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-50"
              />
              <button
                id="agent-ask-btn"
                onClick={runAskAgent}
                disabled={asking}
                className="cursor-pointer rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {asking ? "Thinking…" : "Ask"}
              </button>
            </div>
          )}
        </div>
      </main>

      {/* Extensions modal */}
      {showExtensions && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/60 p-8">
          <div
            id="extensions-modal"
            className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Connected MCP Servers</h2>
              <button
                id="extensions-close-btn"
                onClick={() => setShowExtensions(false)}
                className="cursor-pointer text-slate-400 hover:text-slate-200"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 space-y-4">
              {loadingConnections && (
                <p className="text-sm text-slate-400">Loading…</p>
              )}
              {!loadingConnections && mcpConnections.length === 0 && (
                <p className="text-sm text-slate-400">
                  No MCP servers connected.
                </p>
              )}
              {mcpConnections.map((conn) => (
                <div
                  key={conn.name}
                  className="rounded-lg border border-slate-800 bg-slate-950/50 p-3"
                >
                  <p className="flex items-center gap-2 text-sm font-medium text-slate-100">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    {conn.name}
                  </p>
                  <ul className="mt-2 space-y-1">
                    {conn.tools.map((tool) => (
                      <li key={tool.name} className="text-xs text-slate-400">
                        <span className="font-mono text-slate-300">
                          {tool.name}
                        </span>
                        {tool.description ? ` — ${tool.description}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Image lightbox */}
      {expandedImage && (
        <div
          id="image-lightbox"
          onClick={() => setExpandedImage(null)}
          className="fixed inset-0 flex cursor-pointer items-center justify-center bg-black/80 p-8"
        >
          <button
            id="image-lightbox-close-btn"
            onClick={() => setExpandedImage(null)}
            className="absolute top-6 right-6 cursor-pointer text-2xl text-slate-300 hover:text-white"
          >
            ✕
          </button>
          <img
            src={photoUrl(expandedImage)}
            alt={expandedImage.split("/").pop()}
            onClick={(e) => e.stopPropagation()}
            className="max-h-full max-w-full cursor-default rounded-lg object-contain shadow-2xl"
          />
        </div>
      )}
    </div>
  );
}

export default App;
