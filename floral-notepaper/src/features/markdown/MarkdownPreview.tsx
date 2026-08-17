import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import { openUrl } from "@tauri-apps/plugin-opener";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Components } from "react-markdown";
import "katex/dist/katex.min.css";
import "./markdown-preview-skins.css";
import remarkAlerts from "./remarkAlerts";
import {
  SHIKI_BG,
  SHIKI_FG,
  highlightTokens,
  fontStyleFromToken,
  type ThemedToken,
} from "./shikiHighlighter";

function ShikiTokens({ lines }: { lines: ThemedToken[][] | null }) {
  if (!lines) {
    return <span className="md-shiki-plain">{/* 高亮器未就绪时仅显示纯文本（由外层兜底） */}</span>;
  }
  return (
    <>
      {lines.map((line, lineIndex) => (
        <span className="md-shiki-line" key={lineIndex}>
          {line.map((token, tokenIndex) => (
            <span
              key={tokenIndex}
              style={{
                color: token.color ?? SHIKI_FG,
                ...fontStyleFromToken(token),
              }}
            >
              {token.content}
            </span>
          ))}
        </span>
      ))}
    </>
  );
}

function CodeBlock({ children, language }: { children: React.ReactNode; language?: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [tokens, setTokens] = useState<ThemedToken[][] | null>(null);
  const [highlightReady, setHighlightReady] = useState(false);
  const codeText = extractText(children).replace(/\n$/, "");

  useEffect(() => {
    let cancelled = false;
    setHighlightReady(false);
    setTokens(null);
    void highlightTokens(codeText, language).then((result) => {
      if (cancelled) return;
      setTokens(result);
      setHighlightReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [codeText, language]);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(codeText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [codeText]);

  return (
    <pre
      className={`markdown-code-block group ${language ? "has-language" : ""}`}
      style={{ backgroundColor: SHIKI_BG }}
    >
      <span className="markdown-code-header">
        <span className="markdown-code-language">{language || "code"}</span>
        <button
          type="button"
          onClick={handleCopy}
          className={`markdown-code-copy ${copied ? "is-copied" : ""}`}
          aria-label={t("markdown.copyCode", { defaultValue: "复制代码" })}
        >
          {copied
            ? t("markdown.copied", { defaultValue: "已复制" })
            : t("markdown.copy", { defaultValue: "复制" })}
        </button>
      </span>
      <code className="markdown-code-content">
        {highlightReady && tokens ? (
          <ShikiTokens lines={tokens} />
        ) : (
          <span className="md-shiki-plain">{codeText}</span>
        )}
      </code>
    </pre>
  );
}

function extractText(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (node == null || typeof node === "boolean") return "";
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (typeof node === "object" && "props" in node) {
    return extractText((node as React.ReactElement<{ children?: React.ReactNode }>).props.children);
  }
  return "";
}

function parseInlineStyle(style: string): React.CSSProperties {
  return style.split(";").reduce<React.CSSProperties>((acc, declaration) => {
    const [rawProperty, rawValue] = declaration.split(":");
    const property = rawProperty?.trim();
    const value = rawValue?.trim();
    if (!property || !value) return acc;
    if (property === "color") {
      acc.color = value;
    }
    if (property === "background-color") {
      acc.backgroundColor = value;
    }
    return acc;
  }, {});
}

function normalizeMarkdownCodeFences(content: string): string {
  const lines = content.split("\n");
  let activeFence: { marker: "`" | "~"; length: number } | null = null;

  for (const line of lines) {
    if (activeFence) {
      const closeMatch = line.match(/^\s*((?:`{3,})|(?:~{3,}))\s*$/);
      if (
        closeMatch &&
        closeMatch[1][0] === activeFence.marker &&
        closeMatch[1].length >= activeFence.length
      ) {
        activeFence = null;
      }
      continue;
    }

    const openMatch = line.match(/^\s*((?:`{3,})|(?:~{3,}))/);
    if (openMatch) {
      activeFence = {
        marker: openMatch[1][0] as "`" | "~",
        length: openMatch[1].length,
      };
    }
  }

  if (!activeFence) return content;
  return `${content}\n${activeFence.marker.repeat(activeFence.length)}`;
}

interface MarkdownPreviewProps {
  content: string;
  fontSize?: number;
  renderHtml?: boolean;
  imageBaseDir?: string;
  /** 覆写主题 CSS 变量（磁贴等按背景色注入可读文字色，如 --md-text/--md-heading/--md-muted） */
  colorVars?: React.CSSProperties;
}

const remarkPlugins = [remarkGfm, remarkMath, remarkAlerts];
// KaTeX 解析失败时以红色原样展示，而不是抛异常导致整页白屏
const rehypeKatexOptions = { throwOnError: false, errorColor: "#e5484d" };
const rehypePluginsDefault = [
  [rehypeKatex, rehypeKatexOptions],
  rehypeSlug,
] as Parameters<typeof Markdown>[0]["rehypePlugins"];
// 开启 HTML 渲染（renderHtml）时必须先 rehypeRaw 再 sanitize：
// 只允许安全标签/属性，剥离 onerror/onclick 等事件属性与 javascript: 链接
const baseAttributes = defaultSchema.attributes ?? {};
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...baseAttributes,
    "*": [...(baseAttributes["*"] ?? []), ["className"], ["id"], ["title"]],
    span: [["className"], ["style"]],
    blockquote: [["className"], ["dataAlertType"], ["data-alert-type"]],
    code: [["className"]],
    img: [["src"], ["alt"], ["title"], ["width"], ["height"], ["loading"]],
    a: [["href"], ["title"], ["target"], ["rel"]],
    input: [["type"], ["checked"], ["disabled"]],
  },
};
const rehypePluginsWithHtml = [
  rehypeRaw,
  [rehypeSanitize, sanitizeSchema],
  [rehypeKatex, rehypeKatexOptions],
  rehypeSlug,
] as Parameters<typeof Markdown>[0]["rehypePlugins"];

function AlertIcon({ type }: { type: string }) {
  switch (type) {
    case "note":
      return (
        <svg viewBox="0 0 16 16" fill="currentColor">
          <path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" />
        </svg>
      );
    case "tip":
      return (
        <svg viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 1.5c-2.363 0-4 1.69-4 3.75 0 .984.424 1.625.984 2.304l.214.253c.223.264.47.556.673.848.284.411.537.896.621 1.49a.75.75 0 0 1-1.484.211c-.04-.282-.163-.547-.37-.847a8.456 8.456 0 0 0-.542-.68c-.084-.1-.173-.205-.268-.32C3.201 7.75 2.5 6.766 2.5 5.25 2.5 2.31 4.863 0 8 0s5.5 2.31 5.5 5.25c0 1.516-.701 2.5-1.328 3.259-.095.115-.184.22-.268.319-.207.245-.383.453-.541.681-.208.3-.33.565-.37.847a.751.751 0 0 1-1.485-.212c.084-.593.337-1.078.621-1.489.203-.292.45-.584.673-.848.075-.088.149-.176.214-.253.56-.679.984-1.32.984-2.304 0-2.06-1.637-3.75-4-3.75ZM5.75 12h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5ZM6 15.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z" />
        </svg>
      );
    case "important":
      return (
        <svg viewBox="0 0 16 16" fill="currentColor">
          <path d="M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25Zm7 2.25v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" />
        </svg>
      );
    case "warning":
      return (
        <svg viewBox="0 0 16 16" fill="currentColor">
          <path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.396A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.557ZM8.22 2.097a.25.25 0 0 0-.44 0L1.698 13.493a.25.25 0 0 0 .22.382h12.164a.25.25 0 0 0 .22-.382Z" />
          <path d="M8.75 5.75a.75.75 0 0 0-1.5 0v2.5a.75.75 0 0 0 1.5 0v-2.5ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" />
        </svg>
      );
    case "caution":
      return (
        <svg viewBox="0 0 16 16" fill="currentColor">
          <path d="M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .389.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25A.749.749 0 0 1 11 16H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.389.22-.53Zm.84 1.28L1.5 5.31v5.38l3.81 3.81h5.38l3.81-3.81V5.31L10.69 1.5ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" />
        </svg>
      );
    default:
      return null;
  }
}

function Blockquote({
  children,
  node,
}: {
  children?: React.ReactNode;
  node?: { properties?: Record<string, unknown> };
}) {
  const { t } = useTranslation();
  const alertType =
    ((node?.properties?.dataAlertType || node?.properties?.["data-alert-type"]) as string) ?? "";
  if (alertType) {
    const alertTitleMap: Record<string, string> = {
      note: t("markdown.alert.note", { defaultValue: "备注" }),
      tip: t("markdown.alert.tip", { defaultValue: "提示" }),
      important: t("markdown.alert.important", { defaultValue: "重要" }),
      warning: t("markdown.alert.warning", { defaultValue: "警告" }),
      caution: t("markdown.alert.caution", { defaultValue: "注意" }),
    };

    return (
      <div className={`markdown-alert markdown-alert-${alertType}`} role="note">
        <p className="markdown-alert-title">
          <AlertIcon type={alertType} />
          {alertTitleMap[alertType] ?? alertType.toUpperCase()}
        </p>
        {children}
      </div>
    );
  }
  return <blockquote className="markdown-blockquote">{children}</blockquote>;
}

const staticComponents: Components = {
  h1: ({ children, id }) => (
    <h1 id={id} className="markdown-heading markdown-heading-1">
      {children}
    </h1>
  ),
  h2: ({ children, id }) => (
    <h2 id={id} className="markdown-heading markdown-heading-2">
      {children}
    </h2>
  ),
  h3: ({ children, id }) => (
    <h3 id={id} className="markdown-heading markdown-heading-3">
      {children}
    </h3>
  ),
  h4: ({ children, id }) => (
    <h4 id={id} className="markdown-heading markdown-heading-4">
      {children}
    </h4>
  ),
  p: ({ children }) => <p className="markdown-paragraph">{children}</p>,
  strong: ({ children }) => <strong className="markdown-strong">{children}</strong>,
  em: ({ children }) => <em className="markdown-emphasis">{children}</em>,
  blockquote: Blockquote,
  ul: ({ children }) => <ul className="markdown-list markdown-list-unordered">{children}</ul>,
  ol: ({ children }) => <ol className="markdown-list markdown-list-ordered">{children}</ol>,
  li: ({ children }) => <li className="markdown-list-item">{children}</li>,
  hr: () => <hr className="markdown-divider" />,
  code: ({ className, children }) => {
    const isBlock = className?.startsWith("language-") || String(children).includes("\n");
    if (isBlock) {
      return <code className="markdown-code-raw">{children}</code>;
    }
    return <code className="markdown-inline-code">{children}</code>;
  },
  pre: ({ node, children }) => {
    // 语言信息位于 hast 中 code 子节点的 className（如 language-ts）。
    // 注意：components.code 渲染时会改写 className，不能依赖渲染后的 children。
    let language = "";
    const codeNode = node?.children?.[0];
    const codeClassName = (codeNode as
      | { properties?: { className?: unknown } }
      | undefined)?.properties?.className;
    const classNameStr = Array.isArray(codeClassName)
      ? codeClassName.join(" ")
      : String(codeClassName ?? "");
    const match = classNameStr.match(/language-(\S+)/);
    if (match) language = match[1];

    if (!language) {
      // 兼容兜底：从渲染后的 code 元素重新提取
      if (
        children != null &&
        typeof children === "object" &&
        "props" in (children as React.ReactElement)
      ) {
        const codeProps = (children as React.ReactElement<{ className?: string }>).props;
        const fallback = codeProps.className?.match(/language-(\S+)/);
        if (fallback) language = fallback[1];
      }
    }

    return <CodeBlock language={language}>{children}</CodeBlock>;
  },
  a: ({ href, children }) => (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        if (!href) return;
        if (/^https?:\/\//i.test(href)) {
          openUrl(href);
        } else if (href.startsWith("#")) {
          const id = decodeURIComponent(href.slice(1));
          document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
        }
      }}
      className="markdown-link"
    >
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="markdown-table-wrap">
      <table className="markdown-table">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="markdown-th">{children}</th>,
  td: ({ children }) => <td className="markdown-td">{children}</td>,
  input: ({ checked, ...props }) => (
    <input {...props} checked={checked} disabled className="mr-1.5 accent-bamboo" />
  ),
};

export function MarkdownPreview({
  content,
  fontSize = 14,
  renderHtml = false,
  imageBaseDir,
  colorVars,
}: MarkdownPreviewProps) {
  const { t } = useTranslation();
  const components = useMemo<Components>(
    () => ({
      ...staticComponents,
      span: ({ node, children, ...props }) => {
        const rawStyle = node?.properties?.style;
        const style = Array.isArray(rawStyle) ? rawStyle.join(";") : rawStyle;

        if (typeof style === "string") {
          return (
            <span {...props} style={parseInlineStyle(style)}>
              {children}
            </span>
          );
        }
        return <span {...props}>{children}</span>;
      },
      img: ({ src, alt, ...props }) => {
        let resolvedSrc = src ?? "";
        if (src?.startsWith("images/") && imageBaseDir) {
          resolvedSrc = convertFileSrc(imageBaseDir + "/" + src);
        }
        return (
          <img
            src={resolvedSrc}
            alt={alt ?? ""}
            loading="lazy"
            className="w-[50%] rounded my-2 mx-auto block"
            {...props}
          />
        );
      },
    }),
    [imageBaseDir],
  );
  const normalizedContent = useMemo(() => normalizeMarkdownCodeFences(content), [content]);

  return (
    <div
      className="markdown-preview"
      style={{ ...colorVars, fontSize: `${fontSize}px` }}
    >
      {normalizedContent.trim() ? (
        <Markdown
          remarkPlugins={remarkPlugins}
          rehypePlugins={renderHtml ? rehypePluginsWithHtml : rehypePluginsDefault}
          components={components}
        >
          {normalizedContent}
        </Markdown>
      ) : (
        <p className="markdown-empty">
          {t("markdown.emptyHint", { defaultValue: "预览区会显示当前笔记内容" })}
        </p>
      )}
    </div>
  );
}
