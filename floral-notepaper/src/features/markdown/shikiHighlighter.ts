import { createHighlighter } from "shiki";
import type { ThemedToken } from "@shikijs/types";
import type { CSSProperties } from "react";

/** 预载语言：覆盖常见笔记代码块，控制体积（按需动态加载） */
const LANGUAGES = [
  "javascript",
  "typescript",
  "jsx",
  "tsx",
  "json",
  "jsonc",
  "markdown",
  "css",
  "scss",
  "html",
  "xml",
  "python",
  "go",
  "rust",
  "java",
  "kotlin",
  "swift",
  "c",
  "cpp",
  "csharp",
  "bash",
  "powershell",
  "yaml",
  "toml",
  "sql",
  "diff",
  "dockerfile",
  "ruby",
  "php",
  "lua",
];

export const SHIKI_THEME = "one-dark-pro";

/** 代码块默认背景色（One Dark Pro 编辑器底色） */
export const SHIKI_BG = "#282c34";
/** 代码块默认前景色（One Dark Pro 基础文字色） */
export const SHIKI_FG = "#abb2bf";

type Highlighter = Awaited<ReturnType<typeof createHighlighter>>;

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [SHIKI_THEME],
      langs: LANGUAGES,
    }).catch((error) => {
      highlighterPromise = null;
      throw error;
    });
  }
  return highlighterPromise;
}

const LANG_ALIASES: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  "c++": "cpp",
  cs: "csharp",
  "c#": "csharp",
  py: "python",
  rb: "ruby",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  ps1: "powershell",
  pwsh: "powershell",
  yml: "yaml",
  md: "markdown",
  mdx: "markdown",
  txt: "plaintext",
  text: "plaintext",
  plain: "plaintext",
  console: "plaintext",
  json5: "json",
};

/** 归一化围栏语言名，未知语言回退 plaintext */
export function normalizeLanguage(language: string | undefined): string {
  const raw = (language ?? "").trim().toLowerCase().split(/[\s{?]/)[0];
  if (!raw) return "plaintext";
  if (LANG_ALIASES[raw]) return LANG_ALIASES[raw];
  if (LANGUAGES.includes(raw)) return raw;
  return "plaintext";
}

/** 渲染 FontStyle 位标志（0 无样式 / 1 斜体 / 2 粗体 / 3 斜体+粗体） */
export function fontStyleFromToken(token: ThemedToken): CSSProperties {
  const style: CSSProperties = {};
  const fontStyle = token.fontStyle ?? 0;
  if (fontStyle & 1) style.fontStyle = "italic";
  if (fontStyle & 2) style.fontWeight = 700;
  return style;
}

/** 异步获取 TextMate token 矩阵（行 → token[]），失败时返回 null */
export async function highlightTokens(
  code: string,
  language: string | undefined,
): Promise<ThemedToken[][] | null> {
  const lang = normalizeLanguage(language);
  try {
    const highlighter = await getHighlighter();
    return highlighter.codeToTokensBase(code, {
      lang: lang as Parameters<Highlighter["codeToTokensBase"]>[1]["lang"],
      theme: SHIKI_THEME,
    });
  } catch {
    return null;
  }
}

export type { ThemedToken };
