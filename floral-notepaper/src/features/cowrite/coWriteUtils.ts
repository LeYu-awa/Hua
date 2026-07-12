import type { AuthorBlock, CoWriteSession, CoWriteStats } from "./types";

export function splitBlocksByAuthor(blocks: AuthorBlock[]): {
  human: AuthorBlock[];
  ai: AuthorBlock[];
} {
  const human: AuthorBlock[] = [];
  const ai: AuthorBlock[] = [];
  for (const block of blocks) {
    if (block.author === "human") {
      human.push(block);
    } else {
      ai.push(block);
    }
  }
  return { human, ai };
}

export function getCurrentTurn(blocks: AuthorBlock[]): "human" | "ai" {
  if (blocks.length === 0) return "human";
  const last = blocks[blocks.length - 1];
  return last.author === "human" ? "ai" : "human";
}

export function formatSessionPreview(blocks: AuthorBlock[]): string {
  if (blocks.length === 0) return "";
  const first = blocks[0].text.trim();
  return first.length > 60 ? first.slice(0, 60) + "…" : first;
}

export function blocksToText(blocks: AuthorBlock[]): string {
  return blocks
    .map((block) => {
      const tag = block.author === "human" ? "<human>" : "<ai>";
      return `${tag}${block.text}</${block.author}>`;
    })
    .join("\n\n");
}

export function blocksToMarkdown(blocks: AuthorBlock[]): string {
  return blocks.map((block) => block.text).join("\n\n");
}

export function sessionWordCount(session: CoWriteSession): number {
  let count = 0;
  for (const block of session.blocks) {
    count += block.text.replace(/\s/g, "").length;
  }
  return count;
}

export function sessionDuration(session: CoWriteSession): number {
  if (session.blocks.length === 0) return 0;
  const first = session.blocks[0].timestamp;
  const last = session.blocks[session.blocks.length - 1].timestamp;
  return last - first;
}

export function computeCoWriteStats(session: CoWriteSession): CoWriteStats {
  const humanBlocks: AuthorBlock[] = [];
  const aiBlocks: AuthorBlock[] = [];
  for (const block of session.blocks) {
    if (block.author === "human") humanBlocks.push(block);
    else aiBlocks.push(block);
  }

  const humanChars = humanBlocks.reduce((sum, b) => sum + b.text.replace(/\s/g, "").length, 0);
  const aiChars = aiBlocks.reduce((sum, b) => sum + b.text.replace(/\s/g, "").length, 0);

  const lastActiveAt =
    session.blocks.length > 0
      ? session.blocks[session.blocks.length - 1].timestamp
      : new Date(session.updatedAt).getTime();

  return {
    humanBlocks: humanBlocks.length,
    aiBlocks: aiBlocks.length,
    humanChars,
    aiChars,
    totalTurns: session.blocks.length,
    durationMs: sessionDuration(session),
    lastActiveAt,
  };
}
