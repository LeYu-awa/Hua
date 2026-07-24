import { useEffect, useMemo, useRef, useState } from "react";

interface HeatmapCellData {
  date: string;
  count: number;
}

interface HeatmapViewProps {
  data: HeatmapCellData[];
  cellSize?: number;
  cellGap?: number;
}

const LEVEL_COLORS = [
  "#E5E5E5", // 0 — 浅灰（可见但低调）
  "#DCFCE7", // 1 — 淡绿
  "#BBF7D0", // 2 — 浅绿
  "#86EFAC", // 3 — 中绿
  "#4ADE80", // 4 — 亮绿
];

function getLevel(count: number): number {
  if (count >= 8) return 4;
  if (count >= 5) return 3;
  if (count >= 3) return 2;
  if (count >= 1) return 1;
  return 0;
}

function dateToStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

interface MonthSpan {
  label: string;
  weekCount: number;
}

export function HeatmapView({ data, cellSize = 12, cellGap = 5 }: HeatmapViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // ----- build the 365-day grid (same as SpringNode's `slots`) -----
  const grid = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const heatmapStart = new Date(today);
    heatmapStart.setFullYear(today.getFullYear() - 1);

    const totalDays = Math.floor((today.getTime() - heatmapStart.getTime()) / 86_400_000) + 1;

    // weekday of start date: JS getDay() returns 0=Sun, convert to Mon=0…Sun=6
    const startDayOfWeek = (heatmapStart.getDay() + 6) % 7;
    const startOffset = startDayOfWeek;
    const totalWeeks = Math.ceil((startOffset + totalDays) / 7);
    const pitch = cellSize + cellGap;
    const gridWidth = totalWeeks * cellSize + (totalWeeks - 1) * cellGap;
    const gridHeight = 7 * cellSize + 6 * cellGap;

    // slots — flat array: weekIndex × 7 + dayIndex (0=Mon…6=Sun)
    const slots: (Date | null)[] = Array.from({ length: totalWeeks * 7 }, () => null);
    const monthLabels: string[] = Array.from({ length: totalWeeks }, () => "");
    let lastMonth = -1;

    for (let i = 0; i < totalDays; i++) {
      const date = new Date(heatmapStart);
      date.setDate(heatmapStart.getDate() + i);
      const slotIndex = startOffset + i;
      slots[slotIndex] = date;
      const weekIndex = Math.floor(slotIndex / 7);
      if (date.getMonth() !== lastMonth) {
        monthLabels[weekIndex] = `${date.getMonth() + 1}月`;
        lastMonth = date.getMonth();
      }
    }

    // group consecutive weeks belonging to the same month into spans
    // each span reserves (weekCount * pitch) width so labels never overlap
    const monthSpans: MonthSpan[] = [];
    let spanStart = -1;
    let spanLabel = "";
    for (let w = 0; w <= totalWeeks; w++) {
      const lbl = w < totalWeeks ? monthLabels[w] : "";
      if (lbl) {
        if (spanStart >= 0 && spanLabel) {
          monthSpans.push({ label: spanLabel, weekCount: w - spanStart });
        }
        spanStart = w;
        spanLabel = lbl;
      }
    }
    if (spanStart >= 0 && spanLabel) {
      monthSpans.push({ label: spanLabel, weekCount: totalWeeks - spanStart });
    }

    return { slots, monthSpans, pitch, gridWidth, gridHeight };
  }, [cellSize, cellGap]);

  // ----- activity look-up -----
  const activityByDate = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of data) map.set(item.date, item.count);
    return map;
  }, [data]);

  // ----- auto-scroll to the latest (rightmost) -----
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, []);

  // ----- tooltip state -----
  const [tooltip, setTooltip] = useState<{
    date: Date;
    count: number;
    x: number;
    y: number;
  } | null>(null);

  const [hoveredSlot, setHoveredSlot] = useState<number | null>(null);

  const handleCellEnter = (slotIndex: number, e: React.MouseEvent) => {
    const date = grid.slots[slotIndex];
    if (!date) return;
    const count = activityByDate.get(dateToStr(date)) ?? 0;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top;
    setTooltip({ date, count, x, y });
    setHoveredSlot(slotIndex);
  };

  const handleCellLeave = () => {
    setTooltip(null);
    setHoveredSlot(null);
  };

  const { slots, monthSpans, pitch, gridWidth, gridHeight } = grid;

  return (
    <div className="overflow-x-auto" ref={scrollRef}>
      <div className="inline-flex flex-col py-3">
        {/* ── month labels (positioned with minimum gap to prevent overlap) ── */}
        <div className="relative h-5" style={{ marginLeft: 30 }}>
          {(() => {
            let leftPos = 0;
            return monthSpans.map((m) => {
              const el = (
                <span
                  key={m.label}
                  className="absolute text-[11px] text-ink-ghost whitespace-nowrap leading-none"
                  style={{ left: leftPos, lineHeight: "20px" }}
                >
                  {m.label}
                </span>
              );
              // at least 3 columns width per month label to prevent text overlap
              leftPos += Math.max(m.weekCount, 3) * pitch;
              return el;
            });
          })()}
        </div>

        <div style={{ height: 8 }} />

        {/* ── weekday labels + cell grid ── */}
        <div className="flex">
          {/* weekday labels (一 三 五 only) */}
          <div className="flex flex-col shrink-0" style={{ width: 22 }}>
            {[0, 1, 2, 3, 4, 5, 6].map((dayIndex) => (
              <div
                key={dayIndex}
                className="flex items-center"
                style={{
                  height: cellSize,
                  marginBottom: dayIndex === 6 ? 0 : cellGap,
                }}
              >
                <span
                  className="text-[11px] text-ink-ghost/60 leading-none"
                  style={{ lineHeight: `${cellSize}px` }}
                >
                  {dayIndex === 1 ? "一" : dayIndex === 3 ? "三" : dayIndex === 5 ? "五" : ""}
                </span>
              </div>
            ))}
          </div>

          <div style={{ width: 8 }} />

          {/* cell grid */}
          <div ref={gridRef} className="relative" style={{ width: gridWidth, height: gridHeight }}>
            {slots.map((date, slotIndex) => {
              if (date === null) return null;
              const weekIndex = Math.floor(slotIndex / 7);
              const dayIndex = slotIndex % 7;
              const count = activityByDate.get(dateToStr(date)) ?? 0;
              const level = getLevel(count);

              return (
                <div
                  key={slotIndex}
                  className="absolute cursor-pointer"
                  style={{
                    left: weekIndex * pitch,
                    top: dayIndex * pitch,
                    width: cellSize,
                    height: cellSize,
                    borderRadius: 3,
                    backgroundColor: LEVEL_COLORS[level],
                    border: "1px solid #D4D4D4",
                    transform: hoveredSlot === slotIndex ? "scale(1.1)" : "scale(1)",
                    transition: "transform 150ms ease-out",
                  }}
                  onMouseEnter={(e) => handleCellEnter(slotIndex, e)}
                  onMouseLeave={handleCellLeave}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* ── tooltip overlay (fixed, like SpringNode's OverlayEntry) ── */}
      {tooltip && (
        <div
          className="fixed pointer-events-none z-50"
          style={{
            left: tooltip.x,
            top: tooltip.y - 42,
            transform: "translateX(-50%)",
          }}
        >
          <div className="bg-cloud border border-paper-deep rounded-lg px-2.5 py-1.5 shadow-[0_8px_18px_rgba(0,0,0,0.12)]">
            {tooltip.count > 0 ? (
              <>
                <span className="text-[11px] font-semibold text-ink">{tooltip.count} 次记录</span>
                <span className="text-[11px] text-ink-faint"> 于 </span>
              </>
            ) : (
              <>
                <span className="text-[11px] text-ink-ghost">无记录 于 </span>
              </>
            )}
            <span className="text-[11px] font-semibold text-ink-soft">
              {dateToStr(tooltip.date)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export type { HeatmapCellData };
