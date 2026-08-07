import { useMemo, useState } from "react";
import { buildLineDiff } from "../../sidebarChat/writebackDiff";

export interface NoteChangeHistoryEntry {
  id: string;
  noteId: string;
  title: string;
  pathLabel: string;
  beforeContent: string;
  afterContent: string;
  additions: number;
  removals: number;
  createdAt: number;
}

interface NoteChangeHistoryPageProps {
  currentChange: NoteChangeHistoryEntry | null;
  history: NoteChangeHistoryEntry[];
}

export function NoteChangeHistoryPage({ currentChange, history }: NoteChangeHistoryPageProps) {
  const [selectedId, setSelectedId] = useState("current");
  const entries = useMemo(
    () => (currentChange ? [{ ...currentChange, id: "current" }, ...history] : history),
    [currentChange, history],
  );
  const activeEntry = entries.find((entry) => entry.id === selectedId) ?? entries[0] ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#171817] text-[#e6dfd5]">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-white/8 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold">历史更改</div>
            <div className="truncate text-[10px] text-[#8b857d]">
              {activeEntry ? `${activeEntry.title || "无标题笔记"} · ${entries.length} 条记录` : "暂无修改记录"}
            </div>
          </div>
        </div>
        {activeEntry && (
          <div className="flex shrink-0 items-center gap-2 font-mono text-[11px] font-semibold">
            <span className="text-emerald-300">+{activeEntry.additions}</span>
            <span className="text-red-300">-{activeEntry.removals}</span>
          </div>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-[13px] text-[#8b857d]">
          当前笔记暂无历史修改记录
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)] overflow-hidden">
          <aside className="min-h-0 overflow-y-auto border-r border-white/8 p-2">
            {entries.map((entry, index) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setSelectedId(entry.id)}
                className={`mb-1 w-full rounded-xl px-3 py-2 text-left transition-colors ${
                  activeEntry?.id === entry.id ? "bg-white/10" : "hover:bg-white/6"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[11px] font-semibold text-[#dcd5cc]">
                    {entry.id === "current" ? "当前未保存变更" : `历史变更 ${history.length - index + 1}`}
                  </span>
                  <span className="shrink-0 font-mono text-[10px]">
                    <span className="text-emerald-300">+{entry.additions}</span>
                    <span className="mx-1 text-[#6d6760]">/</span>
                    <span className="text-red-300">-{entry.removals}</span>
                  </span>
                </div>
                <div className="mt-1 truncate text-[10px] text-[#77716a]">
                  {formatChangeTime(entry.createdAt)} · {entry.pathLabel}
                </div>
              </button>
            ))}
          </aside>
          {activeEntry && <ChangeDiffViewer entry={activeEntry} />}
        </div>
      )}
    </div>
  );
}

function ChangeDiffViewer({ entry }: { entry: NoteChangeHistoryEntry }) {
  const lines = useMemo(
    () => buildLineDiff(entry.beforeContent, entry.afterContent),
    [entry.beforeContent, entry.afterContent],
  );

  return (
    <div className="min-h-0 overflow-y-auto bg-[#1b1d1b] py-3 font-mono text-[12px] leading-6">
      {lines.map((line, index) => {
        const isAdd = line.type === "add";
        const isRemove = line.type === "remove";
        return (
          <div
            key={`${entry.id}-${line.type}-${line.oldLine ?? ""}-${line.newLine ?? ""}-${index}`}
            className={`grid grid-cols-[42px_42px_24px_minmax(0,1fr)] gap-2 px-4 ${
              isAdd ? "bg-emerald-500/18 text-emerald-50" : isRemove ? "bg-red-500/20 text-red-50" : "text-[#cfc8bd]"
            }`}
          >
            <span className="select-none text-right text-[#68645e]">{line.oldLine ?? ""}</span>
            <span className="select-none text-right text-[#68645e]">{line.newLine ?? ""}</span>
            <span className={`select-none font-semibold ${isAdd ? "text-emerald-300" : isRemove ? "text-red-300" : "text-[#68645e]"}`}>
              {isAdd ? "+" : isRemove ? "-" : " "}
            </span>
            <span className="whitespace-pre-wrap break-words">{line.text || " "}</span>
          </div>
        );
      })}
    </div>
  );
}

export function getLineChangeStats(beforeContent: string, afterContent: string) {
  const diff = buildLineDiff(beforeContent, afterContent);
  return {
    additions: diff.filter((line) => line.type === "add").length,
    removals: diff.filter((line) => line.type === "remove").length,
  };
}

function formatChangeTime(value: number) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
