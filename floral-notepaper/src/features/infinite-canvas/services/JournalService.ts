import type { JournalEntry } from '../types';

export function createJournalEntry(content: string): JournalEntry {
  return {
    id: crypto.randomUUID(),
    content,
    createdAt: Date.now(),
    isPublished: false,
  };
}

export async function aiExpandContent(content: string, _providers?: unknown[]): Promise<string> {
  // Placeholder for AI expansion using existing agent system
  // Will integrate with src/features/agent/
  return content + '\n\n（AI 扩写内容待集成）';
}
