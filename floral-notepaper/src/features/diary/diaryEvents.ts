/**
 * 日记事件桥（diary S1）
 *
 * DiaryPage 与 SidebarChat 是兄弟组件，通过全局 CustomEvent 通信：
 * - DiaryPage 调 dispatchOpenChatTask(taskId) → SidebarChat 监听并激活对应对话任务
 * - SidebarChat 沉淀日记成功调 dispatchDiaryCreated() → DiaryPage 监听并刷新列表
 *
 * 事件名与载荷是跨组件契约，改动作业需同步更新两侧与单测。
 */

export const OPEN_CHAT_TASK_EVENT = "floral:open-chat-task";
export const DIARY_CREATED_EVENT = "floral:diary-created";

/** 请求 SidebarChat 打开并激活指定对话任务（taskId 即日记的 conversationId） */
export function dispatchOpenChatTask(taskId: string): void {
  window.dispatchEvent(new CustomEvent(OPEN_CHAT_TASK_EVENT, { detail: taskId }));
}

/** 订阅"打开对话任务"请求，返回取消订阅函数 */
export function onOpenChatTask(callback: (taskId: string) => void): () => void {
  const handler = (event: Event) => {
    callback((event as CustomEvent<string>).detail);
  };
  window.addEventListener(OPEN_CHAT_TASK_EVENT, handler);
  return () => window.removeEventListener(OPEN_CHAT_TASK_EVENT, handler);
}

/** 通知日记列表刷新（沉淀成功后由 SidebarChat 广播） */
export function dispatchDiaryCreated(): void {
  window.dispatchEvent(new CustomEvent(DIARY_CREATED_EVENT));
}

/** 订阅"日记已沉淀"事件，返回取消订阅函数 */
export function onDiaryCreated(callback: () => void): () => void {
  const handler = () => callback();
  window.addEventListener(DIARY_CREATED_EVENT, handler);
  return () => window.removeEventListener(DIARY_CREATED_EVENT, handler);
}
