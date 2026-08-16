import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { WritingReport } from "../features/agent/writingReport";
import { generateWritingReport } from "../features/agent/writingReport";
import { listHistoricalDocs } from "../features/agent/profileApi";
import {
  summarizeWritingProfile,
  type WritingProfileInsight,
} from "../features/agent/writingProfile";
import type { ProviderConfig } from "../features/settings/types";

interface WritingReportPageProps {
  noteId: string;
  providers: ProviderConfig[];
}

function formatDuration(ms: number): string {
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins} 分钟`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h} 小时 ${m} 分钟`;
}

export function WritingReportPage({ noteId, providers }: WritingReportPageProps) {
  const { t } = useTranslation();
  const [report, setReport] = useState<WritingReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 场景十二：跨项目写作画像
  const [profile, setProfile] = useState<WritingProfileInsight | null>(null);

  // 载入 / 生成报告后刷新跨项目画像（可降级：非 Tauri 环境返回空）
  const refreshProfile = async () => {
    const docs = await listHistoricalDocs();
    setProfile(summarizeWritingProfile(docs));
  };
  useEffect(() => {
    void refreshProfile();
  }, []);

  const handleGenerate = async () => {
    if (!noteId) return;
    if (providers.length === 0) {
      setError(t("report.noProvider", { defaultValue: "请先在设置中配置 AI 供应商" }));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await generateWritingReport(noteId, providers);
      setReport(result);
      void refreshProfile();
      if (!result) {
        setError(t("report.noData", { defaultValue: "还没有足够的写作数据" }));
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setReport(null);
    setError(null);
  }, [noteId]);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-paper p-6 overflow-y-auto">
      <div className="max-w-2xl mx-auto w-full">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-[16px] font-display font-medium text-ink-soft">
            {t("report.title", { defaultValue: "写作复盘" })}
          </h2>
          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={loading || !noteId}
            className="px-4 py-1.5 text-[12px] text-cloud bg-bamboo hover:bg-bamboo-light disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
          >
            {loading
              ? t("report.generating", { defaultValue: "生成中…" })
              : t("report.generate", { defaultValue: "生成报告" })}
          </button>
        </div>

        {error && (
          <div className="mb-4 px-4 py-3 rounded-lg bg-danger-bg text-red-400 text-[12px]">
            {error}
          </div>
        )}

        {/* 场景十二：跨项目写作画像（长期陪伴视角，独立于单篇报告） */}
        {profile && (
          <div className="mb-5 p-4 rounded-xl bg-paper-warm/40 border border-paper-deep/20 animate-fade-in">
            <div className="flex items-center gap-2 mb-1.5">
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="text-bamboo"
                aria-hidden="true"
              >
                <path d="M3 3v18h18" />
                <path d="M18 9l-5 5-3-3-4 4" />
              </svg>
              <span className="text-[12px] font-medium text-ink-faint">
                {t("report.profile", { defaultValue: "跨项目写作画像" })}
              </span>
              <span className="ml-auto text-[10px] text-ink-ghost">
                {profile.docCount} {t("report.docs", { defaultValue: "篇" })} ·{" "}
                {t("report.avgDelete", { defaultValue: "平均删改" })} {profile.avgDeleteRatio}%
              </span>
            </div>
            <p className="text-[13px] text-ink-soft leading-relaxed">{profile.summary}</p>
          </div>
        )}

        {!report && !error && (
          <div className="text-center text-ink-ghost/70 py-12 text-[13px]">
            {t("report.placeholder", {
              defaultValue: "点击生成报告，查看本次写作的流畅期、卡顿点和建议",
            })}
          </div>
        )}

        {report && (
          <div className="space-y-5 animate-fade-in">
            <div className="p-4 rounded-xl bg-bamboo-mist/40 border border-bamboo/20">
              <p className="text-[14px] text-ink-soft leading-relaxed">{report.summary}</p>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="p-3 rounded-xl bg-paper-warm/50 border border-paper-deep/20 text-center">
                <div className="text-[18px] font-medium text-ink-soft">
                  {formatDuration(report.stats.totalDurationMs)}
                </div>
                <div className="text-[10px] text-ink-ghost mt-0.5">
                  {t("report.duration", { defaultValue: "总时长" })}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-paper-warm/50 border border-paper-deep/20 text-center">
                <div className="text-[18px] font-medium text-ink-soft">
                  {report.stats.totalWords}
                </div>
                <div className="text-[10px] text-ink-ghost mt-0.5">
                  {t("report.words", { defaultValue: "字数" })}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-paper-warm/50 border border-paper-deep/20 text-center">
                <div className="text-[18px] font-medium text-ink-soft">
                  {Math.round(report.stats.deleteRatio * 100)}%
                </div>
                <div className="text-[10px] text-ink-ghost mt-0.5">
                  {t("report.deleteRatio", { defaultValue: "删除占比" })}
                </div>
              </div>
            </div>

            <section>
              <h3 className="text-[12px] font-medium text-ink-faint mb-2">
                {t("report.insights", { defaultValue: "关键洞察" })}
              </h3>
              <ul className="space-y-2">
                {report.insights.map((insight, i) => (
                  <li
                    key={i}
                    className="text-[13px] text-ink-soft leading-relaxed pl-3 border-l-2 border-bamboo/40"
                  >
                    {insight}
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <h3 className="text-[12px] font-medium text-ink-faint mb-2">
                {t("report.suggestions", { defaultValue: "下一次建议" })}
              </h3>
              <ul className="space-y-2">
                {report.suggestions.map((s, i) => (
                  <li
                    key={i}
                    className="text-[13px] text-ink-soft leading-relaxed pl-3 border-l-2 border-paper-deep/30"
                  >
                    {s}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
