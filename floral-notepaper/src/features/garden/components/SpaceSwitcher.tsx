import { useTranslation } from "react-i18next";

interface SpaceSwitcherProps {
  active: "public" | "personal";
  onChange: (tab: "public" | "personal") => void;
}

export function SpaceSwitcher({ active, onChange }: SpaceSwitcherProps) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1 bg-paper-warm/60 rounded-xl p-1">
      <button
        onClick={() => onChange("public")}
        className={`px-4 py-1.5 text-[13px] rounded-lg transition-colors cursor-pointer ${
          active === "public"
            ? "bg-paper text-ink-soft shadow-sm"
            : "text-ink-ghost hover:text-ink-soft"
        }`}
      >
        {t("garden.public", "公共花园")}
      </button>
      <button
        onClick={() => onChange("personal")}
        className={`px-4 py-1.5 text-[13px] rounded-lg transition-colors cursor-pointer ${
          active === "personal"
            ? "bg-paper text-ink-soft shadow-sm"
            : "text-ink-ghost hover:text-ink-soft"
        }`}
      >
        {t("garden.personal", "个人花园")}
      </button>
    </div>
  );
}
