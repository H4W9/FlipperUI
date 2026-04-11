import { useRef, useState, useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { X } from "lucide-react";
import { useFlipperStore } from "../../store/useFlipperStore";
import { useStorage } from "../../hooks/useStorage";
import { cliStart, cliSend, cliStop } from "../../lib/tauri";

const MIN_HEIGHT = 100;
const MAX_HEIGHT = 600;
const DEFAULT_HEIGHT = 208; // ~h-52

export function CliPanel() {
  const {
    cliHistory,
    cliConnected,
    addCliLine,
    clearCli,
    setCliVisible,
    setCliConnected,
    currentPath,
  } = useFlipperStore();
  const { refresh } = useStorage();
  const [input, setInput] = useState("");
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isDragging = useRef(false);

  // Auto-scroll to bottom when history changes
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [cliHistory]);

  // Enter CLI mode on mount, exit on unmount
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let mounted = true;

    (async () => {
      try {
        unlisten = await listen<string>("cli-output", (event) => {
          if (!mounted) return;
          addCliLine({ type: "output", text: event.payload });
        });

        await cliStart();
        if (mounted) setCliConnected(true);
      } catch (err) {
        if (mounted) {
          addCliLine({
            type: "error",
            text: `Failed to enter CLI: ${err}`,
          });
        }
      }
    })();

    return () => {
      mounted = false;
      unlisten?.();

      cliStop()
        .then(() => {
          setCliConnected(false);
          refresh(currentPath);
        })
        .catch(() => {
          setCliConnected(false);
        });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Focus input when connected
  useEffect(() => {
    if (cliConnected) inputRef.current?.focus();
  }, [cliConnected]);

  // Resize drag handling
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    const startY = e.clientY;
    const startHeight = height;

    const onMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = startY - ev.clientY;
      setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, startHeight + delta)));
    };

    const onUp = () => {
      isDragging.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height]);

  const handleSubmit = async () => {
    const trimmed = input.trim();
    if (!trimmed) {
      await cliSend("").catch(() => {});
      setInput("");
      return;
    }

    if (trimmed === "clear") {
      clearCli();
      setInput("");
      return;
    }

    setCmdHistory((prev) => [...prev, trimmed]);
    setHistoryIdx(-1);
    setInput("");

    try {
      await cliSend(trimmed);
    } catch (err) {
      addCliLine({ type: "error", text: String(err) });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSubmit();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (cmdHistory.length === 0) return;
      const newIdx =
        historyIdx === -1
          ? cmdHistory.length - 1
          : Math.max(0, historyIdx - 1);
      setHistoryIdx(newIdx);
      setInput(cmdHistory[newIdx]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIdx === -1) return;
      const newIdx = historyIdx + 1;
      if (newIdx >= cmdHistory.length) {
        setHistoryIdx(-1);
        setInput("");
      } else {
        setHistoryIdx(newIdx);
        setInput(cmdHistory[newIdx]);
      }
    }
  };

  return (
    <div
      className="flex flex-col border-t border-flipper bg-app shrink-0"
      style={{ height }}
    >
      {/* Resize handle */}
      <div
        onMouseDown={handleDragStart}
        className="h-1 cursor-ns-resize bg-surface hover:bg-accent/40 transition-colors shrink-0"
      />

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-border-subtle bg-panel/50">
        <span className="text-xs text-secondary font-medium">
          Terminal
          {!cliConnected && (
            <span className="ml-2 text-dim">connecting...</span>
          )}
        </span>
        <button
          onClick={() => setCliVisible(false)}
          className="p-0.5 text-muted hover:text-primary rounded transition-colors"
        >
          <X size={12} />
        </button>
      </div>

      {/* Output */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 py-1.5 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all"
        onClick={() => inputRef.current?.focus()}
      >
        {cliHistory.map((line, i) => (
          <span
            key={i}
            className={
              line.type === "error" ? "text-danger" : "text-primary/80"
            }
          >
            {line.text}
          </span>
        ))}
      </div>

      {/* Input */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-t border-border-subtle">
        <span className="text-xs text-accent font-mono shrink-0">&gt;</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!cliConnected}
          className="flex-1 bg-transparent text-xs text-primary font-mono outline-none placeholder:text-dim disabled:opacity-40"
          placeholder={cliConnected ? "" : "connecting..."}
          spellCheck={false}
          autoComplete="off"
        />
      </div>
    </div>
  );
}
