/**
 * 笔记打开事件桥（agent 产出闭环）
 *
 * TaskProgressPanel 落盘成功后 dispatchOpenNote(noteId) → AppShell 监听：
 * 切换到"笔记"视图并打开该笔记。
 */

export const OPEN_NOTE_EVENT = "floral:open-note";

/** 请求 AppShell 打开指定笔记（切到笔记视图） */
export function dispatchOpenNote(noteId: string): void {
  window.dispatchEvent(new CustomEvent(OPEN_NOTE_EVENT, { detail: noteId }));
}

/** 订阅打开笔记请求，返回取消订阅函数 */
export function onOpenNote(callback: (noteId: string) => void): () => void {
  const handler = (event: Event) => {
    callback((event as CustomEvent<string>).detail);
  };
  window.addEventListener(OPEN_NOTE_EVENT, handler);
  return () => window.removeEventListener(OPEN_NOTE_EVENT, handler);
}
