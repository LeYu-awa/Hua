import { useState, type ReactNode } from "react";
import {
  BUILT_IN_LIVE2D_MODEL_OPTIONS,
  DEFAULT_COMPANION_CONFIG,
  HARU_LOCAL_MODEL_PATH,
  loadCompanionConfig,
  normalizeCompanionAssetPath,
  saveCompanionConfig,
} from "../companionConfig";
import { openCompanionWindow } from "../companionWindow";
import type { CompanionConfig, CompanionSensitivity } from "../types";

export function Live2DCompanionSettings() {
  const [config, setConfig] = useState<CompanionConfig>(() => loadCompanionConfig());

  const update = (patch: Partial<CompanionConfig>) => {
    setConfig(() => {
      const latest = loadCompanionConfig();
      const skinId = patch.skinId ?? latest.skinId;
      const builtInModel = BUILT_IN_LIVE2D_MODEL_OPTIONS.find((option) => option.skinId === skinId);
      const next = {
        ...latest,
        ...patch,
        renderer: "live2d" as const,
        inputMode: "keyboard" as const,
        skinId,
        skinRevision: builtInModel?.revision ?? patch.skinRevision ?? (skinId === "custom" ? "custom" : latest.skinRevision),
        modelPath: patch.modelPath ?? builtInModel?.modelPath ?? latest.modelPath,
        carousel: {
          ...latest.carousel,
          enabled: false,
          images: [],
          currentIndex: 0,
        },
        sensitivity: patch.sensitivity ? { ...latest.sensitivity, ...patch.sensitivity } : latest.sensitivity,
        motionMap: patch.motionMap ? { ...latest.motionMap, ...patch.motionMap } : latest.motionMap,
      };
      saveCompanionConfig(next);
      return next;
    });
  };

  const updateSensitivity = (patch: Partial<CompanionSensitivity>) => {
    update({ sensitivity: { ...config.sensitivity, ...patch } });
  };

  const useBuiltInModel = (skinId: CompanionConfig["skinId"]) => {
    const option = BUILT_IN_LIVE2D_MODEL_OPTIONS.find((item) => item.skinId === skinId);
    if (!option) return;

    update({
      renderer: "live2d",
      inputMode: "keyboard",
      skinId: option.skinId,
      skinRevision: option.revision,
      modelPath: option.modelPath,
      carousel: {
        ...config.carousel,
        enabled: false,
        images: [],
        currentIndex: 0,
      },
    });
  };

  const browseModel = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        title: "选择 Live2D model3.json",
        filters: [{ name: "Live2D Model", extensions: ["json"] }],
        multiple: false,
      });
      if (selected && typeof selected === "string") {
        update({
          modelPath: normalizeCompanionAssetPath(selected),
          skinId: "custom",
          renderer: "live2d",
          inputMode: "keyboard",
          carousel: {
            ...config.carousel,
            enabled: false,
            images: [],
            currentIndex: 0,
          },
        });
      }
    } catch {
      // 非 Tauri 环境下保持手动输入。
    }
  };

  const openFloatingWindow = async () => {
    const latest = loadCompanionConfig();
    const builtInModel = BUILT_IN_LIVE2D_MODEL_OPTIONS.find((option) => option.skinId === latest.skinId);
    const next = {
      ...latest,
      renderer: "live2d" as const,
      inputMode: "keyboard" as const,
      skinId: builtInModel?.skinId ?? latest.skinId,
      skinRevision: builtInModel?.revision ?? latest.skinRevision,
      modelPath: latest.modelPath || builtInModel?.modelPath || HARU_LOCAL_MODEL_PATH,
      mode: "floating" as const,
      visible: true,
      carousel: {
        ...latest.carousel,
        enabled: false,
        images: [],
        currentIndex: 0,
      },
    };
    setConfig(next);
    saveCompanionConfig(next);
    await openCompanionWindow(next);
  };

  const reset = () => update({ ...DEFAULT_COMPANION_CONFIG });

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl space-y-5">
        <section className="rounded-2xl border border-paper-deep/40 bg-cloud/70 p-5 shadow-[0_18px_48px_var(--color-shadow)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-bamboo">Live2D Companion</p>
              <h2 className="mt-1 text-xl font-display font-bold text-ink">Live2D 本地模型</h2>
              <p className="mt-2 max-w-2xl text-xs leading-6 text-ink-soft">
                可在 Haru 与水瓶座之恋之间切换，也支持手动指定 model3.json；不再挂载尤诺/Bongocat 图片层。
              </p>
            </div>
            <label className="flex items-center gap-2 text-xs font-medium text-ink-soft">
              <input
                type="checkbox"
                checked={config.enabled}
                onChange={(event) => update({ enabled: event.target.checked })}
              />
              启用
            </label>
          </div>
        </section>

        <section className="grid gap-4 rounded-2xl border border-paper-deep/40 bg-paper/80 p-5 md:grid-cols-2">
          <Field label="显示形态">
            <select value={config.mode} onChange={(event) => update({ mode: event.target.value as CompanionConfig["mode"] })} className="companion-field">
              <option value="embedded">主窗口内置透明层</option>
              <option value="floating">桌面悬浮窗</option>
            </select>
          </Field>
          <Field label="显示 / 隐藏">
            <button type="button" onClick={() => update({ visible: !config.visible })} className="companion-action-button w-full">
              {config.visible ? "隐藏 Live2D" : "显示 Live2D"}
            </button>
          </Field>
          <Field label="悬浮窗置顶">
            <label className="flex h-9 items-center gap-2 text-xs text-ink-soft">
              <input checked={config.alwaysOnTop} onChange={(event) => update({ alwaysOnTop: event.target.checked })} type="checkbox" />
              允许独立悬浮窗置顶
            </label>
          </Field>
          <Field label="悬浮窗">
            <button type="button" onClick={openFloatingWindow} className="companion-action-button w-full">
              打开桌面悬浮窗
            </button>
          </Field>
        </section>

        <section className="space-y-4 rounded-2xl border border-paper-deep/40 bg-paper/80 p-5">
          <Field label="内置 Live2D 模型">
            <select
              value={BUILT_IN_LIVE2D_MODEL_OPTIONS.some((option) => option.skinId === config.skinId) ? config.skinId : "custom"}
              onChange={(event) => {
                const skinId = event.target.value as CompanionConfig["skinId"];
                if (skinId !== "custom") useBuiltInModel(skinId);
              }}
              className="companion-field w-full"
            >
              {BUILT_IN_LIVE2D_MODEL_OPTIONS.map((option) => (
                <option key={option.skinId} value={option.skinId}>
                  {option.label}
                </option>
              ))}
              <option value="custom">自定义路径</option>
            </select>
          </Field>
          <Field label="Live2D 模型路径">
            <div className="flex gap-2">
              <input
                value={config.modelPath}
                onChange={(event) => update({ modelPath: normalizeCompanionAssetPath(event.target.value), skinId: "custom" })}
                className="companion-field flex-1 font-mono text-[11px]"
                placeholder="/live2d/haru/Haru.model3.json"
              />
              <button type="button" onClick={browseModel} className="companion-action-button shrink-0">
                浏览...
              </button>
            </div>
          </Field>
          <div className="flex flex-wrap gap-2">
            {BUILT_IN_LIVE2D_MODEL_OPTIONS.map((option) => (
              <button key={option.skinId} type="button" onClick={() => useBuiltInModel(option.skinId)} className="companion-action-button">
                使用 {option.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] leading-5 text-ink-ghost">
            内置模型位于 public/live2d；当前运行时路径为 {config.modelPath}。
          </p>
        </section>

        <section className="grid gap-5 rounded-2xl border border-paper-deep/40 bg-paper/80 p-5 md:grid-cols-2">
          <Range label="大小缩放" value={config.scale} min={0.5} max={2} step={0.05} onChange={(scale) => update({ scale })} />
          <Range label="透明度" value={config.opacity} min={0.2} max={1} step={0.05} onChange={(opacity) => update({ opacity })} />
          <Range label="输入动作强度" value={config.sensitivity.typingIntensity} min={0.2} max={1} step={0.05} onChange={(typingIntensity) => updateSensitivity({ typingIntensity })} />
          <Range label="鼠标跟随" value={config.sensitivity.mouseFollowStrength} min={0} max={1} step={0.05} onChange={(mouseFollowStrength) => updateSensitivity({ mouseFollowStrength })} />
          <Range label="停顿回 idle / ms" value={config.sensitivity.idleTimeoutMs} min={600} max={4000} step={100} onChange={(idleTimeoutMs) => updateSensitivity({ idleTimeoutMs })} />
          <Range label="动作冷却 / ms" value={config.sensitivity.motionCooldownMs} min={40} max={400} step={20} onChange={(motionCooldownMs) => updateSensitivity({ motionCooldownMs })} />
        </section>

        <div className="flex items-center gap-3 border-t border-paper-deep/30 pt-4">
          <button type="button" onClick={reset} className="companion-secondary-button">
            恢复默认模型
          </button>
          <span className="text-[11px] text-ink-ghost">配置会自动保存到本地，并实时同步到主窗口与桌面悬浮窗。</span>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-ink-soft">{label}</span>
      {children}
    </label>
  );
}

function Range({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-bamboo"
      />
      <div className="mt-1 text-right text-[11px] text-ink-ghost">{value}</div>
    </Field>
  );
}
