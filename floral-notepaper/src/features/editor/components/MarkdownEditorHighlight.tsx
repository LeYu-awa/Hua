import { forwardRef, Fragment, useDeferredValue, useMemo } from "react";
import type { ReactNode } from "react";
import "./markdown-editor-highlight.css";

interface MarkdownEditorHighlightProps {
  content: string;
  fontSize: number;
}

const HIGHLIGHT_CHAR_LIMIT = 40_000;

const CODE_KEYWORDS = new Set([
  "abstract",
  "async",
  "await",
  "boolean",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "default",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "from",
  "function",
  "if",
  "implements",
  "import",
  "in",
  "interface",
  "let",
  "new",
  "null",
  "number",
  "of",
  "private",
  "protected",
  "public",
  "readonly",
  "return",
  "string",
  "switch",
  "throw",
  "true",
  "try",
  "type",
  "undefined",
  "unknown",
  "var",
  "void",
  "while",
]);

type CodeFenceState = {
  marker: "`" | "~";
  length: number;
};

function getFenceMatch(line: string): { indent: string; fence: string; suffix: string; state: CodeFenceState } | null {
  const match = line.match(/^(\s*)((?:`{3,})|(?:~{3,}))(.*)$/);
  if (!match) return null;

  const fence = match[2];
  return {
    indent: match[1],
    fence,
    suffix: match[3],
    state: {
      marker: fence[0] as "`" | "~",
      length: fence.length,
    },
  };
}

function isClosingFence(line: string, fence: CodeFenceState): boolean {
  const pattern = fence.marker === "`" ? /^(\s*)(`{3,})(\s*)$/ : /^(\s*)(~{3,})(\s*)$/;
  const match = line.match(pattern);
  return Boolean(match && match[2].length >= fence.length);
}

function renderFenceLine(line: string): ReactNode {
  const fenceMatch = getFenceMatch(line);
  if (!fenceMatch) return line;

  return (
    <span className="mde-line mde-fence-line">
      {fenceMatch.indent}
      <span className="mde-fence-marker">{fenceMatch.fence}</span>
      <span className="mde-fence-language">{fenceMatch.suffix}</span>
    </span>
  );
}

function renderCodeComment(token: string, key: string): ReactNode {
  if (token.startsWith("//")) {
    return (
      <Fragment key={key}>
        <span className="mde-code-comment-marker">//</span>
        <span className="mde-code-comment-text">{token.slice(2)}</span>
      </Fragment>
    );
  }

  if (token.startsWith("/*") && token.endsWith("*/")) {
    return (
      <Fragment key={key}>
        <span className="mde-code-comment-marker">/*</span>
        <span className="mde-code-comment-text">{token.slice(2, -2)}</span>
        <span className="mde-code-comment-marker">*/</span>
      </Fragment>
    );
  }

  return (
    <span key={key} className="mde-code-comment-text">
      {token}
    </span>
  );
}

function tokenizeCode(line: string, keyPrefix: string): ReactNode[] {
  const tokens =
    line.match(
      /(\/\/.*|\/\*[\s\S]*?\*\/|`(?:\\.|[^`])*`|'(?:\\.|[^'])*'|"(?:\\.|[^"])*"|#(?:[\da-f]{3,8})\b|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b|[{}()[\].,;:+\-*/%=<>!&|?]+|\s+|.)/g,
    ) ?? [];

  return tokens.map((token, index) => {
    const key = `${keyPrefix}-${index}`;
    if (/^\/\//.test(token) || /^\/\*/.test(token)) return renderCodeComment(token, key);

    let className = "";
    if (/^(['"`])/.test(token)) className = "mde-code-string";
    else if (/^#([\da-f]{3,8})\b/i.test(token)) className = "mde-code-string";
    else if (/^\d+(\.\d+)?/.test(token)) className = "mde-code-number";
    else if (CODE_KEYWORDS.has(token)) className = "mde-code-keyword";
    else if (/^[A-Z][A-Za-z0-9_$]*$/.test(token)) className = "mde-code-type";
    else if (/^[a-zA-Z_$][\w$]*$/.test(token)) className = "mde-code-identifier";
    else if (/^[{}()[\].,;:+\-*/%=<>!&|?]+$/.test(token)) className = "mde-code-punctuation";

    return className ? (
      <span key={key} className={className}>
        {token}
      </span>
    ) : (
      token
    );
  });
}

function renderInlineCode(token: string, key: string) {
  return (
    <Fragment key={key}>
      <span className="mde-inline-code mde-inline-marker">`</span>
      <span className="mde-inline-code mde-inline-code-text">{token.slice(1, -1)}</span>
      <span className="mde-inline-code mde-inline-marker">`</span>
    </Fragment>
  );
}

function renderLink(token: string, key: string) {
  const match = token.match(/^(!?)\[([^\]]*)\]\(([^)]*)\)$/);
  if (!match) return null;

  return (
    <Fragment key={key}>
      {match[1] && <span className="mde-syntax-marker">!</span>}
      <span className="mde-syntax-marker">[</span>
      <span className="mde-link-text">{match[2]}</span>
      <span className="mde-syntax-marker">]</span>
      <span className="mde-syntax-marker">(</span>
      <span className="mde-link-url">{match[3]}</span>
      <span className="mde-syntax-marker">)</span>
    </Fragment>
  );
}

function renderMarkdownMarker(token: string, key: string) {
  return (
    <span key={key} className="mde-syntax-marker">
      {token}
    </span>
  );
}

function tokenizeInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const tokens =
    text.match(
      /(`[^`]*`|!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\)|\*\*|__|~~|[*_$]|<[^>\n]+>|https?:\/\/\S+|\|+|\s+|.)/g,
    ) ?? [];

  return tokens.map((token, index) => {
    const key = `${keyPrefix}-${index}`;
    if (/^`/.test(token)) return renderInlineCode(token, key);

    const link = renderLink(token, key);
    if (link) return link;

    if (/^(\*\*|__|~~|[*_$])$/.test(token)) return renderMarkdownMarker(token, key);

    if (/^https?:\/\//.test(token)) {
      return (
        <span key={key} className="mde-link-url">
          {token}
        </span>
      );
    }
    if (/^</.test(token)) {
      return (
        <span key={key} className="mde-html">
          {token}
        </span>
      );
    }
    if (/^\|+$/.test(token)) {
      return (
        <span key={key} className="mde-table-pipe">
          {token}
        </span>
      );
    }

    return token;
  });
}

function renderMarkdownLine(line: string, index: number, activeFence: CodeFenceState | null): ReactNode {
  const keyPrefix = `mde-${index}`;
  if (activeFence) {
    if (isClosingFence(line, activeFence)) return renderFenceLine(line);
    return <span className="mde-line mde-code-line">{tokenizeCode(line, keyPrefix)}</span>;
  }

  if (getFenceMatch(line)) return renderFenceLine(line);

  const heading = line.match(/^(#{1,6})(\s+.*)?$/);
  if (heading) {
    return (
      <span className={`mde-line mde-heading-line mde-heading-${heading[1].length}`}>
        <span className="mde-heading-marker">{heading[1]}</span>
        {tokenizeInlineMarkdown(heading[2] ?? "", keyPrefix)}
      </span>
    );
  }

  const task = line.match(/^(\s*[-*+]\s+\[[ xX]\])(\s+.*)?$/);
  if (task) {
    return (
      <span className="mde-line mde-task-line">
        <span className="mde-list-marker">{task[1]}</span>
        {tokenizeInlineMarkdown(task[2] ?? "", keyPrefix)}
      </span>
    );
  }

  const list = line.match(/^(\s*(?:[-*+]|\d+\.))(\s+.*)?$/);
  if (list) {
    return (
      <span className="mde-line mde-list-line">
        <span className="mde-list-marker">{list[1]}</span>
        {tokenizeInlineMarkdown(list[2] ?? "", keyPrefix)}
      </span>
    );
  }

  const quote = line.match(/^(\s*>+)(\s?.*)$/);
  if (quote) {
    return (
      <span className="mde-line mde-quote-line">
        <span className="mde-quote-marker">{quote[1]}</span>
        {tokenizeInlineMarkdown(quote[2] ?? "", keyPrefix)}
      </span>
    );
  }

  if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
    return <span className="mde-line mde-hr-line">{line}</span>;
  }

  if (line.includes("|") && /^\s*\|?.+\|.+\|?\s*$/.test(line)) {
    return <span className="mde-line mde-table-line">{tokenizeInlineMarkdown(line, keyPrefix)}</span>;
  }

  return <span className="mde-line">{tokenizeInlineMarkdown(line, keyPrefix)}</span>;
}

function renderMarkdown(content: string): ReactNode[] {
  const lines = content.split("\n");
  let activeFence: CodeFenceState | null = null;

  return lines.flatMap((line, index) => {
    const node = renderMarkdownLine(line, index, activeFence);

    if (activeFence) {
      if (isClosingFence(line, activeFence)) activeFence = null;
    } else {
      const openingFence = getFenceMatch(line);
      if (openingFence) activeFence = openingFence.state;
    }

    return index === lines.length - 1 ? [node] : [node, "\n"];
  });
}

export const MarkdownEditorHighlight = forwardRef<HTMLPreElement, MarkdownEditorHighlightProps>(
  function MarkdownEditorHighlight({ content, fontSize }, ref) {
    const deferredContent = useDeferredValue(content);
    const renderedContent = useMemo(() => {
      if (!deferredContent) return "";
      if (deferredContent.length > HIGHLIGHT_CHAR_LIMIT) return deferredContent;
      return renderMarkdown(deferredContent);
    }, [deferredContent]);

    return (
      <pre
        ref={ref}
        aria-hidden="true"
        className="markdown-editor-highlight-layer"
        style={{
          fontSize: `${fontSize}px`,
          tabSize: "var(--tab-indent-size, 2)",
        }}
      >
        {renderedContent}
      </pre>
    );
  },
);
