import { useEffect, useMemo, useRef, useState } from "react";

interface HeatmapCellData {
  date: string;
  count: number;
}

interface HeatmapViewProps {
  data: HeatmapCellData[];
  cellSize?: number;
  cellGap?: number;
  rangeMode?: "recent" | "year";
}

const WEEKDAY_LABEL_WIDTH = 22;
const GRID_GUTTER = 8;
const MONTH_LABEL_MARGIN = WEEKDAY_LABEL_WIDTH + GRID_GUTTER;
const DEFAULT_VISIBLE_WEEKS = 13;
const RECENT_MAX_VISIBLE_WEEKS = 13;
const YEAR_VISIBLE_WEEKS = 53;

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

export function HeatmapView({
  data,
  cellSize = 12,
  cellGap = 5,
  rangeMode = "recent",
}: HeatmapViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const updateWidth = () => setContainerWidth(element.clientWidth);
    updateWidth();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWidth);
      return () => window.removeEventListener("resize", updateWidth);
    }

    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // ----- build a width-aware grid that always ends at today -----
  const grid = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const pitch = cellSize + cellGap;
    const availableGridWidth = Math.max(0, containerWidth - MONTH_LABEL_MARGIN);
    const widthBasedWeeks = containerWidth
      ? Math.min(
          rangeMode === "year" ? YEAR_VISIBLE_WEEKS : RECENT_MAX_VISIBLE_WEEKS,
          Math.max(1, Math.floor((availableGridWidth + cellGap) / pitch)),
        )
      : DEFAULT_VISIBLE_WEEKS;
    const visibleWeeks = rangeMode === "year" ? YEAR_VISIBLE_WEEKS : widthBasedWeeks;
    const todayDayIndex = (today.getDay() + 6) % 7;
    const heatmapStart = new Date(today);
    heatmapStart.setDate(today.getDate() - (visibleWeeks - 1) * 7 - todayDayIndex);

    const totalDays = Math.floor((today.getTime() - heatmapStart.getTime()) / 86_400_000) + 1;
    const gridWidth = visibleWeeks * cellSize + (visibleWeeks - 1) * cellGap;
    const gridHeight = 7 * cellSize + 6 * cellGap;

    const slots: (Date | null)[] = Array.from({ length: visibleWeeks * 7 }, () => null);
    const monthLabels: string[] = Array.from({ length: visibleWeeks }, () => "");
    monthLabels[0] = `${heatmapStart.getMonth() + 1}月`;
    let lastMonth = heatmapStart.getMonth();

    for (let i = 0; i < totalDays; i++) {
      const date = new Date(heatmapStart);
      date.setDate(heatmapStart.getDate() + i);
      slots[i] = date;
      const weekIndex = Math.floor(i / 7);
      if (date.getMonth() !== lastMonth) {
        monthLabels[weekIndex] = `${date.getMonth() + 1}月`;
        lastMonth = date.getMonth();
      }
    }

    const monthSpans: MonthSpan[] = [];
    let spanStart = -1;
    let spanLabel = "";
    for (let w = 0; w <= visibleWeeks; w++) {
      const lbl = w < visibleWeeks ? monthLabels[w] : "";
      if (lbl) {
        if (spanStart >= 0 && spanLabel) {
          monthSpans.push({ label: spanLabel, weekCount: w - spanStart });
        }
        spanStart = w;
        spanLabel = lbl;
      }
    }
    if (spanStart >= 0 && spanLabel) {
      monthSpans.push({ label: spanLabel, weekCount: visibleWeeks - spanStart });
    }

    return { slots, monthSpans, pitch, gridWidth, gridHeight };
  }, [cellSize, cellGap, containerWidth, rangeMode]);

  // ----- activity look-up -----
  const activityByDate = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of data) map.set(item.date, item.count);
    return map;
  }, [data]);

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
    <div className="w-full overflow-hidden" ref={scrollRef}>
      <div className="inline-flex max-w-full flex-col py-3">
        {/* ── month labels (positioned with minimum gap to prevent overlap) ── */}
        <div className="relative h-5" style={{ marginLeft: MONTH_LABEL_MARGIN }}>
          {(() => {
            let leftPos = 0;
            return monthSpans.map((m) => {
              const el = (
                <span
                  key={`${m.label}-${leftPos}`}
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
          <div className="flex flex-col shrink-0" style={{ width: WEEKDAY_LABEL_WIDTH }}>
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

          <div style={{ width: GRID_GUTTER }} />

          {/* cell grid */}
          <div
            ref={gridRef}
            className="relative shrink-0"
            style={{ width: gridWidth, height: gridHeight }}
          >
            {slots.map((date, slotIndex) => {
              if (date === null) return null;
              const weekIndex = Math.floor(slotIndex / 7);
              const dayIndex = slotIndex % 7;
              const count = activityByDate.get(dateToStr(date)) ?? 0;
              const level = getLevel(count);

              return (
                <div
                  key={dateToStr(date)}
                  title={dateToStr(date)}
                  aria-label={`${dateToStr(date)}，${count} 次记录`}
                  className="absolute cursor-pointer"
                  style={{
                    left: weekIndex * pitch,
                    top: dayIndex * pitch,
                    width: cellSize,
                    height: cellSize,
                    borderRadius: 3,
                    // 无记录（level 0）不填充，保持页面底色（浅色=白，深色=深）
                    backgroundColor: level === 0 ? "transparent" : `var(--heatmap-level-${level})`,
                    border: "1px solid var(--heatmap-cell-border)",
                    transform: hoveredSlot === slotIndex ? "scale(1.1)" : "scale(1)",
                    transition:
                      "transform 150ms ease-out, background-color 0.2s ease, border-color 0.2s ease",
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
          <div className="bg-cloud border border-paper-deep/50 rounded-lg px-2.5 py-1.5">
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
