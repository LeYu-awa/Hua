export type FormatAction =
  | "bold"
  | "italic"
  | "heading"
  | "hr"
  | "ul"
  | "ol"
  | "code"
  | "quote"
  | "inlineMath"
  | "blockMath";

export type EditorCommand = "undo" | "redo";

export interface FormatLabels {
  boldText: string;
  italicText: string;
  headingText: string;
  listItem: string;
  codeText: string;
  quoteText: string;
}

export interface FormatSelectionInput {
  value: string;
  selectionStart: number;
  selectionEnd: number;
  action: FormatAction;
  labels: FormatLabels;
}

export interface FormatSelectionResult {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

export const TEXT_COLOR_OPTIONS = [
  "#8B0000",
  "#B45309",
  "#047857",
  "#0F766E",
  "#1D4ED8",
  "#6D28D9",
  "#BE185D",
  "#374151",
];

export const HIGHLIGHT_COLOR_OPTIONS = [
  "#FEF3C7",
  "#FDE68A",
  "#F9A8D4",
  "#BFDBFE",
  "#A7F3D0",
  "#DDD6FE",
  "#FDBA74",
  "#E5E7EB",
];

export function formatMarkdownSelection({
  value,
  selectionStart: start,
  selectionEnd: end,
  action,
  labels,
}: FormatSelectionInput): FormatSelectionResult {
  const selected = value.slice(start, end);
  const before = value.slice(0, start);
  const after = value.slice(end);
  const lineStart = before.lastIndexOf("\n") + 1;
  const currentLine = before.slice(lineStart);

  let result: string;
  let cursorStart: number;
  let cursorEnd: number;

  switch (action) {
    case "bold": {
      const text = selected || labels.boldText;
      const wrapped = `**${text}**`;
      result = before + wrapped + after;
      cursorStart = start + 2;
      cursorEnd = cursorStart + text.length;
      break;
    }
    case "italic": {
      const text = selected || labels.italicText;
      const wrapped = `*${text}*`;
      result = before + wrapped + after;
      cursorStart = start + 1;
      cursorEnd = cursorStart + text.length;
      break;
    }
    case "heading": {
      const prefix = currentLine.match(/^(#{1,5})\s/);
      if (prefix) {
        const newLevel = prefix[1].length < 5 ? "#".repeat(prefix[1].length + 1) : "#";
        const beforeLine = value.slice(0, lineStart);
        const afterPrefix = value.slice(lineStart + prefix[0].length);
        result = beforeLine + newLevel + " " + afterPrefix;
        const offset = newLevel.length + 1 - prefix[0].length;
        cursorStart = start + offset;
        cursorEnd = end + offset;
      } else if (currentLine.length > 0 && start === end) {
        result = value.slice(0, lineStart) + "## " + value.slice(lineStart);
        cursorStart = start + 3;
        cursorEnd = cursorStart;
      } else if (selected) {
        result = before + `## ${selected}` + after;
        cursorStart = start + 3;
        cursorEnd = cursorStart + selected.length;
      } else {
        result = before + `## ${labels.headingText}` + after;
        cursorStart = start + 3;
        cursorEnd = cursorStart + labels.headingText.length;
      }
      break;
    }
    case "hr": {
      const newlineBefore = before.endsWith("\n") || before === "" ? "" : "\n";
      const newlineAfter = after.startsWith("\n") || after === "" ? "" : "\n";
      result = before + `${newlineBefore}---${newlineAfter}` + after;
      cursorStart = cursorEnd = before.length + newlineBefore.length + 3;
      break;
    }
    case "ul": {
      if (selected.includes("\n")) {
        const lines = selected
          .split("\n")
          .map((line) => `- ${line}`)
          .join("\n");
        result = before + lines + after;
        cursorStart = start;
        cursorEnd = start + lines.length;
      } else {
        const text = selected || labels.listItem;
        const item = `- ${text}`;
        result = before + item + after;
        cursorStart = start + 2;
        cursorEnd = cursorStart + text.length;
      }
      break;
    }
    case "ol": {
      if (selected.includes("\n")) {
        const lines = selected
          .split("\n")
          .map((line, index) => `${index + 1}. ${line}`)
          .join("\n");
        result = before + lines + after;
        cursorStart = start;
        cursorEnd = start + lines.length;
      } else {
        const text = selected || labels.listItem;
        const item = `1. ${text}`;
        result = before + item + after;
        cursorStart = start + 3;
        cursorEnd = cursorStart + text.length;
      }
      break;
    }
    case "code": {
      if (selected.includes("\n")) {
        const wrapped = "```\n" + selected + "\n```";
        result = before + wrapped + after;
        cursorStart = start + 4;
        cursorEnd = cursorStart + selected.length;
      } else {
        const text = selected || labels.codeText;
        const wrapped = `\`${text}\``;
        result = before + wrapped + after;
        cursorStart = start + 1;
        cursorEnd = cursorStart + text.length;
      }
      break;
    }
    case "quote": {
      if (selected.includes("\n")) {
        const lines = selected
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n");
        result = before + lines + after;
        cursorStart = start;
        cursorEnd = start + lines.length;
      } else {
        const text = selected || labels.quoteText;
        const item = `> ${text}`;
        result = before + item + after;
        cursorStart = start + 2;
        cursorEnd = cursorStart + text.length;
      }
      break;
    }
    case "inlineMath": {
      const text = selected || "E=mc^2";
      const wrapped = `$${text}$`;
      result = before + wrapped + after;
      cursorStart = start + 1;
      cursorEnd = cursorStart + text.length;
      break;
    }
    case "blockMath": {
      const text = selected || "x^2 + y^2 = r^2";
      const wrapped = `\n$$\n${text}\n$$\n`;
      result = before + wrapped + after;
      cursorStart = start + 4;
      cursorEnd = cursorStart + text.length;
      break;
    }
  }

  return { value: result, selectionStart: cursorStart, selectionEnd: cursorEnd };
}

export function applyMarkdownFormat(
  textarea: HTMLTextAreaElement,
  action: FormatAction,
  labels: FormatLabels,
  setContent: (value: string) => void,
  markDirty: () => void,
) {
  const result = formatMarkdownSelection({
    value: textarea.value,
    selectionStart: textarea.selectionStart,
    selectionEnd: textarea.selectionEnd,
    action,
    labels,
  });

  textarea.focus();
  textarea.setSelectionRange(0, textarea.value.length);
  document.execCommand("insertText", false, result.value);
  setContent(result.value);
  markDirty();
  requestAnimationFrame(() => {
    textarea.setSelectionRange(result.selectionStart, result.selectionEnd);
  });
}

export function runEditorCommand(
  textarea: HTMLTextAreaElement | null,
  command: EditorCommand,
): boolean {
  if (!textarea || textarea.disabled) return false;
  textarea.focus();
  return document.execCommand(command);
}

export function pinTileButtonTitle(isPinned: boolean): string {
  return isPinned ? "取消钉屏" : "钉到屏幕";
}
