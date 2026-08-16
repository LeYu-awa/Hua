export type WritebackDiffLineType = "same" | "add" | "remove";

export interface WritebackDiffLine {
  type: WritebackDiffLineType;
  text: string;
  oldLine?: number;
  newLine?: number;
}

const MAX_LCS_CELLS = 250_000;

export function buildLineDiff(
  originalContent: string,
  generatedContent: string,
): WritebackDiffLine[] {
  const originalLines = splitLines(originalContent);
  const generatedLines = splitLines(generatedContent);
  const cells = (originalLines.length + 1) * (generatedLines.length + 1);

  if (cells > MAX_LCS_CELLS) {
    return buildFallbackDiff(originalLines, generatedLines);
  }

  const dp = Array.from(
    { length: originalLines.length + 1 },
    () => Array(generatedLines.length + 1).fill(0) as number[],
  );

  for (let i = originalLines.length - 1; i >= 0; i -= 1) {
    for (let j = generatedLines.length - 1; j >= 0; j -= 1) {
      dp[i][j] =
        originalLines[i] === generatedLines[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const diff: WritebackDiffLine[] = [];
  let i = 0;
  let j = 0;

  while (i < originalLines.length && j < generatedLines.length) {
    if (originalLines[i] === generatedLines[j]) {
      diff.push({ type: "same", text: originalLines[i], oldLine: i + 1, newLine: j + 1 });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      diff.push({ type: "remove", text: originalLines[i], oldLine: i + 1 });
      i += 1;
    } else {
      diff.push({ type: "add", text: generatedLines[j], newLine: j + 1 });
      j += 1;
    }
  }

  while (i < originalLines.length) {
    diff.push({ type: "remove", text: originalLines[i], oldLine: i + 1 });
    i += 1;
  }

  while (j < generatedLines.length) {
    diff.push({ type: "add", text: generatedLines[j], newLine: j + 1 });
    j += 1;
  }

  return diff;
}

function splitLines(content: string) {
  if (!content) return [""];
  return content.replace(/\r\n/g, "\n").split("\n");
}

function buildFallbackDiff(originalLines: string[], generatedLines: string[]): WritebackDiffLine[] {
  return [
    ...originalLines.map((text, index) => ({ type: "remove" as const, text, oldLine: index + 1 })),
    ...generatedLines.map((text, index) => ({ type: "add" as const, text, newLine: index + 1 })),
  ];
}
