import { useState } from "react";
import { useTranslation } from "react-i18next";

interface CategoryCreatorProps {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, icon: string, color: string) => void;
}

const ICON_OPTIONS = ["📚", "🔬", "🎨", "📖", "💭", "🎵", "🎬", "🏛️", "🌍", "💻", "🧠", "✍️"];
const COLOR_OPTIONS = ["#6a9a5b", "#e8a87c", "#95b8d1", "#c9a0dc", "#f4b8c8", "#a8d8a8", "#f0d080"];

export function CategoryCreator({ open, onClose, onCreate }: CategoryCreatorProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("📚");
  const [color, setColor] = useState("#6a9a5b");

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-paper rounded-2xl shadow-xl border border-paper-deep/20 p-6 w-[360px]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-[15px] font-medium text-ink-soft mb-4">
          {t("garden.createCategory", "创建分类")}
        </h3>

        <div className="space-y-4">
          <div>
            <label className="text-[12px] text-ink-ghost mb-1 block">
              {t("garden.categoryName", "分类名称")}
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 text-[13px] bg-paper-warm/60 rounded-lg border border-paper-deep/20 outline-none focus:border-bamboo/50"
              placeholder={t("garden.categoryNamePlaceholder", "输入分类名称")}
            />
          </div>

          <div>
            <label className="text-[12px] text-ink-ghost mb-1 block">
              {t("garden.chooseIcon", "选择图标")}
            </label>
            <div className="flex flex-wrap gap-2">
              {ICON_OPTIONS.map((ico) => (
                <button
                  key={ico}
                  onClick={() => setIcon(ico)}
                  className={`w-8 h-8 flex items-center justify-center rounded-lg text-[16px] transition-colors cursor-pointer ${
                    icon === ico
                      ? "bg-bamboo-mist/60 ring-2 ring-bamboo/40"
                      : "hover:bg-paper-warm/80"
                  }`}
                >
                  {ico}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[12px] text-ink-ghost mb-1 block">
              {t("garden.chooseColor", "选择颜色")}
            </label>
            <div className="flex flex-wrap gap-2">
              {COLOR_OPTIONS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`w-7 h-7 rounded-full transition-transform cursor-pointer ${
                    color === c ? "ring-2 ring-offset-2 ring-bamboo scale-110" : ""
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-[13px] text-ink-ghost hover:text-ink-soft rounded-lg transition-colors cursor-pointer"
          >
            {t("common.cancel", "取消")}
          </button>
          <button
            onClick={() => {
              if (name.trim()) {
                onCreate(name.trim(), icon, color);
                setName("");
                onClose();
              }
            }}
            className="px-4 py-1.5 text-[13px] bg-bamboo text-cloud rounded-lg hover:bg-bamboo-light transition-colors cursor-pointer"
          >
            {t("common.create", "创建")}
          </button>
        </div>
      </div>
    </div>
  );
}
