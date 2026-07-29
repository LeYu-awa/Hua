import { useEffect, useMemo, useState } from "react";
import { HeatmapView } from "../../../components/HeatmapView";
import { getStats } from "../stats";
import type { StatsData } from "../stats";
import type { ProviderConfig } from "../types";

type RangePreset = "all" | "recent30" | "lastMonth" | "lastQuarter" | "custom";

interface StatsDateRange {
  start: Date;
  end: Date;
  label: string;
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatCompactNumber(value: number): string {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}亿`;
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)}万`;
  return value.toLocaleString();
}

function rangeFor(preset: RangePreset, customStart: Date, customEnd: Date): StatsDateRange {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  switch (preset) {
    case "all":
      return { start: new Date(2000, 0, 1), end: today, label: "全部" };
    case "recent30": {
      const start = new Date(today);
      start.setDate(start.getDate() - 29);
      return { start, end: today, label: "最近 30 天" };
    }
    case "lastMonth": {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const end = new Date(today.getFullYear(), today.getMonth(), 0);
      return { start, end, label: "上个月" };
    }
    case "lastQuarter": {
      const quarterMonth = Math.floor(today.getMonth() / 3) * 3;
      const quarterStart = new Date(today.getFullYear(), quarterMonth, 1);
      const start = new Date(quarterStart.getFullYear(), quarterStart.getMonth() - 3, 1);
      const end = new Date(quarterStart.getTime() - 86_400_000);
      return { start, end, label: "上个季度" };
    }
    case "custom":
      return {
        start: customStart,
        end: customEnd,
        label: `${formatDate(customStart)} 至 ${formatDate(customEnd)}`,
      };
  }
}

export function StatsPanel({ providers }: { providers: ProviderConfig[] }) {
  const [preset, setPreset] = useState<RangePreset>("recent30");
  const [customStart, setCustomStart] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 29);
    date.setHours(0, 0, 0, 0);
    return date;
  });
  const [customEnd, setCustomEnd] = useState(() => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
  });
  const [statsData, setStatsData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);

  const range = rangeFor(preset, customStart, customEnd);

  useEffect(() => {
    setLoading(true);
    getStats()
      .then(setStatsData)
      .catch(() => setStatsData(null))
      .finally(() => setLoading(false));
  }, []);

  const filteredUsage = useMemo(() => {
    if (!statsData) return [];
    const rangeStart = formatDate(range.start);
    const rangeEnd = formatDate(range.end);
    return statsData.tokenUsage.filter((day) => day.date >= rangeStart && day.date <= rangeEnd);
  }, [statsData, range]);

  const maxTokens = Math.max(1, ...filteredUsage.map((day) => day.totalTokens));

  const heatmapData = useMemo(
    () => (statsData?.dailyActivity ?? []).map((day) => ({ date: day.date, count: day.count })),
    [statsData],
  );

  const handleSelectPreset = (nextPreset: RangePreset) => {
    if (nextPreset === "custom") {
      setPreset("custom");
      return;
    }
    setPreset(nextPreset);
  };

  return (
    <div className="flex-1 overflow-y-auto min-h-0">
      <div className="max-w-[1080px] mx-auto px-6 py-5 space-y-4">
        <RangeSelector
          selected={preset}
          loading={loading}
          onSelected={handleSelectPreset}
          onCustomConfirm={(start, end) => {
            setCustomStart(start);
            setCustomEnd(end);
            setPreset("custom");
          }}
          customStart={customStart}
          customEnd={customEnd}
        />

        <SectionCard title="年度热力图">
          {loading ? (
            <div className="h-[124px] flex items-center justify-center text-[12px] text-ink-ghost">
              加载中…
            </div>
          ) : (
            <HeatmapView data={heatmapData} />
          )}
        </SectionCard>

        <SectionCard title="总览">
          <MetricsGrid
            providers={providers}
            range={range}
            statsData={statsData}
            filteredUsage={filteredUsage}
          />
        </SectionCard>

        <SectionCard title="用量趋势" subtitle={range.label}>
          <UsageTrendChart data={filteredUsage} maxTokens={maxTokens} />
        </SectionCard>

        <div className="h-8" />
      </div>
    </div>
  );
}

function RangeSelector({
  selected,
  loading,
  onSelected,
  onCustomConfirm,
  customStart,
  customEnd,
}: {
  selected: RangePreset;
  loading: boolean;
  onSelected: (preset: RangePreset) => void;
  onCustomConfirm: (start: Date, end: Date) => void;
  customStart: Date;
  customEnd: Date;
}) {
  const items: { key: RangePreset; label: string }[] = [
    { key: "all", label: "全部" },
    { key: "recent30", label: "最近 30 天" },
    { key: "lastMonth", label: "上个月" },
    { key: "lastQuarter", label: "上个季度" },
    { key: "custom", label: "自定义" },
  ];
  const [showDialog, setShowDialog] = useState(false);

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        {items.map((item) => (
          <RangeChip
            key={item.key}
            label={item.label}
            selected={selected === item.key}
            onTap={() => {
              if (item.key === "custom") {
                setShowDialog(true);
              } else {
                onSelected(item.key);
              }
            }}
          />
        ))}
        {loading && (
          <div className="w-3 h-3 rounded-full border border-bamboo border-t-transparent animate-spin ml-2" />
        )}
      </div>
      {showDialog && (
        <CustomRangeDialog
          start={customStart}
          end={customEnd}
          onConfirm={(start, end) => {
            onCustomConfirm(start, end);
            setShowDialog(false);
          }}
          onCancel={() => setShowDialog(false)}
        />
      )}
    </>
  );
}

function RangeChip({ label, selected, onTap }: { label: string; selected: boolean; onTap: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      className={`relative h-[34px] rounded-full px-[15px] text-[12px] font-medium leading-none select-none transition-colors duration-200 cursor-pointer ${
        selected
          ? "bg-paper-deep text-ink"
          : hovered
            ? "bg-paper-warm text-ink-soft"
            : "bg-paper-warm/60 text-ink-faint"
      }`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onTap}
    >
      {label}
    </button>
  );
}

function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="w-full px-[18px] py-[18px] rounded-[18px] border border-paper-deep bg-cloud">
      <div className="flex items-center justify-between mb-[14px]">
        <span className="text-[13px] font-semibold text-ink leading-none">{title}</span>
        {subtitle && <span className="text-[12px] text-ink-ghost leading-none">{subtitle}</span>}
      </div>
      {children}
    </div>
  );
}

function MetricsGrid({
  providers,
  range,
  statsData,
  filteredUsage,
}: {
  providers: ProviderConfig[];
  range: StatsDateRange;
  statsData: StatsData | null;
  filteredUsage: StatsData["tokenUsage"];
}) {
  const totalTokens = filteredUsage.reduce((sum, day) => sum + day.totalTokens, 0);
  const inputTokens = filteredUsage.reduce((sum, day) => sum + day.inputTokens, 0);
  const outputTokens = filteredUsage.reduce((sum, day) => sum + day.outputTokens, 0);
  const cachedTokens = filteredUsage.reduce((sum, day) => sum + day.cachedTokens, 0);
  const providerCount = providers.length;
  const modelCount = providers.reduce((sum, provider) => sum + provider.models.length, 0);
  const dayCount = Math.floor((range.end.getTime() - range.start.getTime()) / 86_400_000) + 1;
  const totalSummaries = statsData?.totalSummaries ?? 0;

  const metrics: { label: string; value: string }[] = [
    { label: "总计 Tokens", value: formatCompactNumber(totalTokens) },
    { label: "输入 Tokens", value: formatCompactNumber(inputTokens) },
    { label: "输出 Tokens", value: formatCompactNumber(outputTokens) },
    { label: "缓存 Tokens", value: formatCompactNumber(cachedTokens) },
    { label: "AI 调用次数", value: formatCompactNumber(totalSummaries) },
    { label: "供应商", value: `${providerCount}` },
    { label: "可用模型", value: `${modelCount}` },
    { label: "活跃天数", value: `${dayCount}` },
  ];

  return (
    <div
      className="grid gap-[10px]"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}
    >
      {metrics.map((metric) => (
        <div
          key={metric.label}
          className="h-[72px] px-[14px] py-[13px] rounded-[13px] bg-paper-warm/60 flex flex-col justify-center"
        >
          <span className="text-[21px] font-bold text-ink leading-none truncate">{metric.value}</span>
          <span className="text-[11px] text-ink-faint leading-none mt-[7px]">{metric.label}</span>
        </div>
      ))}
    </div>
  );
}

function UsageTrendChart({
  data,
  maxTokens,
}: {
  data: { date: string; totalTokens: number; providerTokens: Record<string, number> }[];
  maxTokens: number;
}) {
  const totalDays = data.length;
  const metrics = usageDayMetrics(totalDays);
  const contentWidth = totalDays * metrics.width + Math.max(0, totalDays - 1) * metrics.gap;

  const legendColors = [
    "#2563EB",
    "#0F9B8E",
    "#F97316",
    "#8B5CF6",
    "#E11D48",
    "#22A65F",
    "#D08A00",
    "#1598A7",
    "#94A3B8",
  ];
  const providerNames = Array.from(new Set(data.flatMap((day) => Object.keys(day.providerTokens))));
  const topNames = providerNames.slice(0, 8);

  const [tooltipData, setTooltipData] = useState<{
    date: string;
    totalTokens: number;
    providerTokens: Record<string, number>;
    x: number;
    y: number;
  } | null>(null);

  return (
    <div>
      <div className="overflow-x-auto">
        <div className="relative" style={{ minWidth: contentWidth, height: 236 }}>
          <div className="absolute left-0 right-0 bottom-[39px] flex">
            {data.map((day, index) => (
              <div
                key={day.date}
                style={{ width: metrics.width, marginRight: index < data.length - 1 ? metrics.gap : 0 }}
                className="h-[4px] rounded-full bg-paper-deep/50"
              />
            ))}
          </div>
          <div className="absolute left-0 right-0 top-0 bottom-[39px] flex items-end">
            {data.map((day, index) => {
              const percentage = day.totalTokens / maxTokens;
              const barHeight = day.totalTokens > 0 ? Math.max(10, percentage * 197 * 0.92) : 0;
              return (
                <div
                  key={day.date}
                  className="relative flex flex-col justify-end cursor-pointer group"
                  style={{
                    width: metrics.width,
                    marginRight: index < data.length - 1 ? metrics.gap : 0,
                    height: 197,
                  }}
                  onMouseEnter={(event) => {
                    if (day.totalTokens <= 0) return;
                    const rect = event.currentTarget.getBoundingClientRect();
                    setTooltipData({
                      date: day.date,
                      totalTokens: day.totalTokens,
                      providerTokens: day.providerTokens,
                      x: rect.left + rect.width / 2,
                      y: rect.top,
                    });
                  }}
                  onMouseLeave={() => setTooltipData(null)}
                >
                  {barHeight > 0 && (
                    <div
                      className="w-full rounded-[4px] overflow-hidden flex flex-col justify-end"
                      style={{ height: barHeight }}
                    >
                      {topNames.map((name, nameIndex) => {
                        const tokens = day.providerTokens[name] || 0;
                        if (tokens <= 0) return null;
                        return (
                          <div
                            key={name}
                            style={{
                              flex: tokens / (day.totalTokens || 1),
                              backgroundColor: legendColors[nameIndex % legendColors.length],
                            }}
                          />
                        );
                      })}
                      {Object.keys(day.providerTokens).length === 0 && (
                        <div style={{ flex: 1 }} className="bg-paper-deep/50" />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-[10px] flex flex-wrap gap-x-4 gap-y-2">
        {topNames.length > 0 ? (
          topNames.map((name, index) => (
            <div key={name} className="flex items-center gap-[7px]">
              <div
                className="w-[14px] h-[14px] rounded-[4px]"
                style={{ backgroundColor: legendColors[index % legendColors.length] }}
              />
              <span className="text-[12px] text-ink-faint leading-none">{name}</span>
            </div>
          ))
        ) : (
          <span className="text-[12px] text-ink-ghost">暂无模型调用记录</span>
        )}
      </div>

      {tooltipData && (
        <div
          className="fixed pointer-events-none z-50"
          style={{
            left: tooltipData.x,
            top: tooltipData.y - 10,
            transform: "translateX(-50%)",
          }}
        >
          <div className="bg-cloud border border-paper-deep rounded-[12px] px-3 py-[11px] shadow-[0_12px_28px_rgba(0,0,0,0.08)]">
            <div className="flex items-center justify-between mb-[10px] gap-4">
              <span className="text-[13px] font-bold text-ink leading-none">
                {tooltipData.date}
              </span>
              <span className="text-[11px] font-semibold text-ink-faint leading-none">
                {formatCompactNumber(tooltipData.totalTokens)} tokens
              </span>
            </div>
            <div className="h-[1px] bg-paper-deep mb-[8px]" />
            {Object.entries(tooltipData.providerTokens).length > 0 ? (
              Object.entries(tooltipData.providerTokens)
                .sort(([, first], [, second]) => second - first)
                .slice(0, 5)
                .map(([name, tokens]) => (
                  <div key={name} className="flex items-center gap-[7px] mb-[7px] last:mb-0">
                    <div
                      className="w-[8px] h-[8px] rounded-full shrink-0"
                      style={{
                        backgroundColor:
                          legendColors[topNames.indexOf(name) % legendColors.length] || "#94A3B8",
                      }}
                    />
                    <span className="flex-1 text-[11px] font-medium text-ink-soft leading-[1.1] truncate">
                      {name}
                    </span>
                    <span className="text-[11px] font-semibold text-ink-faint leading-[1.1]">
                      {formatCompactNumber(tokens)}
                    </span>
                  </div>
                ))
            ) : (
              <>
                <div className="flex items-center gap-[7px] mb-[7px]">
                  <div className="w-[8px] h-[8px] rounded-full bg-ink-ghost" />
                  <span className="flex-1 text-[11px] font-medium text-ink-soft leading-[1.1]">
                    输入 Tokens
                  </span>
                  <span className="text-[11px] font-semibold text-ink-faint leading-[1.1]">0</span>
                </div>
                <div className="flex items-center gap-[7px] mb-[7px]">
                  <div className="w-[8px] h-[8px] rounded-full bg-paper-deep" />
                  <span className="flex-1 text-[11px] font-medium text-ink-soft leading-[1.1]">
                    输出 Tokens
                  </span>
                  <span className="text-[11px] font-semibold text-ink-faint leading-[1.1]">0</span>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function usageDayMetrics(totalDays: number): { width: number; gap: number } {
  if (totalDays >= 800) return { width: 4, gap: 4 };
  if (totalDays >= 365) return { width: 5, gap: 5 };
  if (totalDays >= 180) return { width: 7, gap: 6 };
  if (totalDays >= 90) return { width: 10, gap: 7 };
  return { width: 14, gap: 8 };
}

function CustomRangeDialog({
  start,
  end,
  onConfirm,
  onCancel,
}: {
  start: Date;
  end: Date;
  onConfirm: (start: Date, end: Date) => void;
  onCancel: () => void;
}) {
  const [selectedStart, setSelectedStart] = useState(start);
  const [selectedEnd, setSelectedEnd] = useState(end);
  const [dateField, setDateField] = useState<"start" | "end" | null>(null);

  const handleDatePicked = (date: Date) => {
    if (dateField === "start") {
      setSelectedStart(date);
      if (selectedEnd < date) setSelectedEnd(date);
      setDateField(null);
    } else {
      setSelectedEnd(date);
      if (selectedStart > date) setSelectedStart(date);
      setDateField(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/48" onClick={onCancel}>
      <div
        className="bg-cloud rounded-[22px] w-[540px] max-w-[90vw] px-[22px] pt-[20px] pb-[22px] shadow-xl border border-paper-deep"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-[14px]">
          <h3 className="text-[18px] font-semibold text-ink leading-none">自定义时间段</h3>
          <button
            className="w-[28px] h-[28px] flex items-center justify-center rounded-full hover:bg-paper-warm text-ink-faint"
            onClick={onCancel}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex gap-3 mb-[18px]">
          <DateField
            label="开始"
            date={selectedStart}
            active={dateField === "start"}
            onTap={() => setDateField("start")}
          />
          <DateField
            label="结束"
            date={selectedEnd}
            active={dateField === "end"}
            onTap={() => setDateField("end")}
          />
        </div>

        {dateField && (
          <div className="mb-[18px]">
            <CalendarMonth
              selected={dateField === "start" ? selectedStart : selectedEnd}
              onSelect={handleDatePicked}
            />
          </div>
        )}

        <div className="flex gap-3">
          <DialogButton label="取消" filled={false} onTap={onCancel} />
          <DialogButton label="应用" filled onTap={() => onConfirm(selectedStart, selectedEnd)} />
        </div>
      </div>
    </div>
  );
}

function DateField({
  label,
  date,
  active,
  onTap,
}: {
  label: string;
  date: Date;
  active: boolean;
  onTap: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const isActive = active || hovered || pressed;
  return (
    <button
      className={`flex-1 h-[72px] px-4 rounded-[16px] text-left transition-colors cursor-pointer ${
        isActive ? "bg-paper-deep" : "bg-paper-warm/60"
      }`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setPressed(false);
      }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onClick={onTap}
    >
      <div
        className={`text-[12px] font-semibold leading-none ${isActive ? "text-ink-faint" : "text-ink-ghost"}`}
      >
        {label}
      </div>
      <div className="mt-[9px] text-[15px] font-semibold text-ink leading-none">
        {formatDate(date)}
      </div>
    </button>
  );
}

function DialogButton({ label, filled, onTap }: { label: string; filled: boolean; onTap: () => void }) {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  return (
    <button
      className={`flex-1 h-[44px] rounded-[14px] text-[14px] font-semibold leading-none transition-colors cursor-pointer ${
        filled
          ? pressed
            ? "bg-paper-deep text-ink"
            : hovered
              ? "bg-paper-warm text-ink"
              : "bg-paper-deep/70 text-ink"
          : pressed
            ? "bg-paper-deep/70 text-ink-faint"
            : hovered
              ? "bg-paper-warm text-ink-faint"
              : "bg-paper-warm/60 text-ink-soft"
      }`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setPressed(false);
      }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onClick={onTap}
    >
      {label}
    </button>
  );
}

function CalendarMonth({ selected, onSelect }: { selected: Date; onSelect: (date: Date) => void }) {
  const [viewMonth, setViewMonth] = useState(
    () => new Date(selected.getFullYear(), selected.getMonth(), 1),
  );

  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrev = new Date(year, month, 0).getDate();
  const cells: number[] = [];

  for (let index = firstDay - 1; index >= 0; index--) cells.push(daysInPrev - index);
  for (let day = 1; day <= daysInMonth; day++) cells.push(day);
  for (let day = 1; day <= 42 - cells.length; day++) cells.push(day);

  return (
    <div className="rounded-[16px] bg-paper-warm/60 p-4">
      <div className="flex items-center justify-between mb-3">
        <button
          className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-paper-deep text-ink-ghost cursor-pointer"
          onClick={() => setViewMonth(new Date(year, month - 1, 1))}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <span className="text-[14px] font-semibold text-ink">
          {year}年{month + 1}月
        </span>
        <button
          className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-paper-deep text-ink-ghost cursor-pointer"
          onClick={() => setViewMonth(new Date(year, month + 1, 1))}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      </div>

      <div className="grid grid-cols-7 mb-1">
        {["日", "一", "二", "三", "四", "五", "六"].map((label) => (
          <div key={label} className="text-center text-[11px] text-ink-ghost leading-[28px] font-medium">
            {label}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {cells.map((day, index) => {
          const isCurrent =
            month === selected.getMonth() &&
            year === selected.getFullYear() &&
            day === selected.getDate();
          const isPrev = index < firstDay;
          const isNext = !isPrev && index >= firstDay + daysInMonth;
          const date = isPrev
            ? new Date(year, month - 1, day)
            : isNext
              ? new Date(year, month + 1, day)
              : new Date(year, month, day);

          return (
            <button
              key={index}
              className={`h-[36px] text-center text-[13px] font-medium rounded-full transition-colors cursor-pointer ${
                isCurrent
                  ? "bg-ink text-cloud"
                  : isPrev || isNext
                    ? "text-paper-deep"
                    : "text-ink-soft hover:bg-paper-deep"
              }`}
              onClick={() => onSelect(date)}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
