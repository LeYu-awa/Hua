import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  BUILT_IN_LINGCHAT_PET_OPTIONS,
  BUILT_IN_LIVE2D_MODEL_OPTIONS,
  COMPANION_MAX_SCALE,
  COMPANION_MIN_SCALE,
  loadCompanionConfig,
  saveCompanionConfig,
} from "../companionConfig";
import type { CompanionConfig, CompanionSkinId, PetEffectId } from "../types";
import { loadProactiveConfig, saveProactiveConfig, type LingChatProactiveConfig } from "../lingchatProactive";

/**
 * LingChat 桌宠设置面板（移植自 LingChat settings_pet SettingsPage，MIT）。
 * 四个 tab 与原版一一对应：
 *   01 宠物配置 PetTab    —— 角色 / 服装 / 缩放 / 粒子 / 音量 / 打字速度
 *   02 对话历史 HistoryTab —— 桌宠聊天记录（localStorage 适配）
 *   03 TODO TodoTab        —— 待办分组（localStorage 适配）
 *   04 主动系统 WindowTab  —— 主动问候间隔（localStorage 适配）
 */

type PetSettingsTab = "pet" | "history" | "todo" | "window";

const TODO_STORAGE_KEY = "lingchat_pet_todos";

interface PetTodoItem {
  id: string;
  text: string;
  done: boolean;
}

interface PetTodoGroup {
  id: string;
  title: string;
  todos: PetTodoItem[];
}

interface PetChatMessage {
  role: "user" | "assistant";
  content: string;
}

function loadPetChatMessages(): PetChatMessage[] {
  try {
    const raw = localStorage.getItem("lingchat_pet_chat_messages");
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PetChatMessage[];
    return Array.isArray(parsed) ? parsed.slice(-50) : [];
  } catch {
    return [];
  }
}

function loadTodoGroups(): PetTodoGroup[] {
  try {
    const raw = localStorage.getItem(TODO_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PetTodoGroup[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveTodoGroups(groups: PetTodoGroup[]) {
  localStorage.setItem(TODO_STORAGE_KEY, JSON.stringify(groups));
}

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

const PET_TABS: Array<{ key: PetSettingsTab; label: string; icon: string; index: string }> = [
  { key: "pet", label: "宠物配置", icon: "▦", index: "01" },
  { key: "history", label: "对话历史", icon: "≡", index: "02" },
  { key: "todo", label: "TODO", icon: "☑", index: "03" },
  { key: "window", label: "主动系统", icon: "◎", index: "04" },
];

/** 配置补丁：pet 允许部分字段，便于逐项修改 */
type CompanionConfigPatch = Omit<Partial<CompanionConfig>, "pet"> & {
  pet?: Partial<CompanionConfig["pet"]>;
};

export function LingChatPetSettings() {
  const [activeTab, setActiveTab] = useState<PetSettingsTab>("pet");
  const [config, setConfig] = useState<CompanionConfig>(() => loadCompanionConfig());

  const refresh = useCallback(() => setConfig(loadCompanionConfig()), []);

  useEffect(() => {
    return refresh;
  }, [refresh]);

  const update = useCallback((patch: CompanionConfigPatch) => {
    const latest = loadCompanionConfig();
    saveCompanionConfig({
      ...latest,
      ...patch,
      pet: { ...latest.pet, ...(patch.pet ?? {}) } as CompanionConfig["pet"],
    });
    setConfig(loadCompanionConfig());
  }, []);

  const updatePet = useCallback(
    (patch: Partial<CompanionConfig["pet"]>) => update({ pet: patch }),
    [update],
  );

  const selectCharacter = useCallback((skinId: CompanionSkinId) => {
    const option = BUILT_IN_LINGCHAT_PET_OPTIONS.find((item) => item.skinId === skinId);
    if (!option) return;
    update({
      renderer: "lingchat",
      inputMode: "keyboard",
      skinId: option.skinId,
      skinRevision: option.revision,
      modelPath: "",
      pet: { roleFolder: option.roleFolder, clothesName: "" },
    });
  }, [update]);

  const switchBackToLive2D = useCallback(() => {
    const haru = BUILT_IN_LIVE2D_MODEL_OPTIONS.find((item) => item.skinId === "haru-cdn");
    if (!haru) return;
    update({
      renderer: "live2d",
      inputMode: "keyboard",
      skinId: haru.skinId,
      skinRevision: haru.revision,
      modelPath: haru.modelPath,
    });
  }, [update]);

  const isLingChat = config.renderer === "lingchat";
  const clothesOptions =
    config.pet.roleFolder === "诺一钦灵"
      ? (["默认", "泳装"] as const)
      : (["默认"] as const);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 顶部导航（复刻 LingChat SettingsSidebar） */}
      <div className="flex shrink-0 items-center justify-between border-b-2 border-paper-deep/30 px-6 pb-2 pt-1">
        <div>
          <h2 className="mb-0.5 flex items-center gap-2 text-xl font-display font-bold text-ink">
            LingChat 桌宠
          </h2>
          <p className="text-xs font-medium text-ink-soft">2D 情绪立绘桌宠 · 气泡 / 音效 / 粒子</p>
        </div>
        <span className="select-none font-mono text-4xl font-bold italic text-bamboo-mist">
          {PET_TABS.find((tab) => tab.key === activeTab)?.index}
        </span>
      </div>

      {/* Tab 导航 */}
      <nav className="flex shrink-0 gap-1 border-b border-paper-deep/20 px-4 pt-2">
        {PET_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 rounded-t-lg px-4 py-2 text-xs font-semibold transition-all ${
              activeTab === tab.key
                ? "border border-b-0 border-paper-deep/40 bg-paper/90 text-bamboo"
                : "text-ink-ghost hover:bg-paper-warm hover:text-ink-soft"
            }`}
          >
            <span aria-hidden>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </nav>

      {/* 内容区 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {activeTab === "pet" && (
          <div className="mx-auto max-w-3xl space-y-5">
            {/* 角色选择 */}
            <Section title="角色" desc="选择 LingChat 桌宠角色（切换后立绘立即生效）">
              <div className="grid gap-3 sm:grid-cols-3">
                {BUILT_IN_LINGCHAT_PET_OPTIONS.map((option) => {
                  const selected =
                    isLingChat && config.skinId === option.skinId;
                  return (
                    <button
                      key={option.skinId}
                      type="button"
                      onClick={() => selectCharacter(option.skinId)}
                      className={`rounded-xl border p-4 text-left transition-all ${
                        selected
                          ? "border-cyan-400 bg-cyan-500/10 ring-2 ring-cyan-400/40"
                          : "border-paper-deep/40 bg-paper/70 hover:border-cyan-400/50 hover:bg-cyan-500/5"
                      }`}
                    >
                      <p className="text-sm font-bold text-ink">{option.label}</p>
                      <p className="mt-0.5 text-[11px] text-ink-ghost">
                        {option.roleFolder} · 21 情绪立绘
                      </p>
                      {selected && (
                        <p className="mt-1 text-[11px] font-semibold text-cyan-500">
                          ✓ 使用中
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
              {!isLingChat && (
                <p className="mt-2 text-[11px] leading-5 text-ink-ghost">
                  当前正在使用 Live2D 角色（{config.skinId}）。选择上方任一角色将切换到 LingChat 2D 桌宠。
                </p>
              )}
              {isLingChat && (
                <button
                  type="button"
                  onClick={switchBackToLive2D}
                  className="mt-2 text-[11px] font-medium text-ink-ghost underline-offset-2 hover:text-bamboo hover:underline"
                >
                  切换回 Live2D（Haru）
                </button>
              )}
            </Section>

            {/* 服装 */}
            <Section title="服装" desc="诺一钦灵含「泳装」子目录，其他角色仅默认">
              <select
                value={config.pet.clothesName || "默认"}
                onChange={(event) => updatePet({ clothesName: event.target.value === "默认" ? "" : event.target.value })}
                className="w-full rounded-lg border border-paper-deep/40 bg-paper/80 px-3 py-2 text-xs text-ink outline-none focus:border-cyan-400/60"
              >
                {clothesOptions.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </Section>

            {/* 缩放 */}
            <Section title="大小缩放" desc="整窗尺寸 240 × 485 等比缩放，与桌宠窗口联动">
              <div className="mb-1 flex items-end gap-3">
                <span className="text-3xl font-bold tracking-tighter text-cyan-500">
                  {Math.round(config.scale * 100)}%
                </span>
                <span className="mb-1 rounded bg-bamboo-mist/50 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase text-ink-ghost">
                  Current Scale
                </span>
              </div>
              <input
                type="range"
                min={COMPANION_MIN_SCALE}
                max={COMPANION_MAX_SCALE}
                step={0.01}
                value={config.scale}
                onChange={(event) => update({ scale: Number(event.target.value) })}
                className="w-full accent-cyan-500"
              />
              <div className="mt-1 flex justify-between font-mono text-[10px] font-bold text-ink-ghost">
                <span>MIN {Math.round(COMPANION_MIN_SCALE * 100)}%</span>
                <span className="text-cyan-500">DEF 100%</span>
                <span>MAX {Math.round(COMPANION_MAX_SCALE * 100)}%</span>
              </div>
            </Section>

            {/* 粒子特效 */}
            <Section title="粒子特效" desc="桌宠周围的环境粒子（对应 LingChat StarField / BA）">
              <div className="grid grid-cols-3 gap-3">
                {(
                  [
                    { value: "none", label: "无" },
                    { value: "starfield", label: "星空" },
                    { value: "ba", label: "BA" },
                  ] as Array<{ value: PetEffectId; label: string }>
                ).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => updatePet({ effect: option.value })}
                    className={`rounded-lg border px-4 py-2 text-sm font-medium transition-all ${
                      config.pet.effect === option.value
                        ? "border-cyan-400 bg-cyan-500 text-white shadow-md"
                        : "border-paper-deep/40 bg-paper/70 text-ink-soft hover:border-cyan-400/50"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </Section>

            {/* 音量 */}
            <Section title="音量" desc="气泡音效与角色语音的音量（对应 LingChat PetTab）">
              <Range
                label="气泡音效音量"
                value={config.pet.bubbleVolume}
                min={0}
                max={100}
                step={1}
                onChange={(value) => updatePet({ bubbleVolume: value })}
              />
              <div className="h-3" />
              <Range
                label="角色语音音量"
                value={config.pet.characterVolume}
                min={0}
                max={100}
                step={1}
                onChange={(value) => updatePet({ characterVolume: value })}
              />
            </Section>

            {/* 打字速度 */}
            <Section title="打字机速度" desc="气泡逐字显示的速率（字符/秒）">
              <Range
                label="气泡打字速度"
                value={config.pet.typeWriterSpeed}
                min={10}
                max={100}
                step={1}
                onChange={(value) => updatePet({ typeWriterSpeed: value })}
              />
            </Section>

            <p className="text-[11px] leading-5 text-ink-ghost">
              配置自动保存并实时同步到主窗口桌宠层；进入桌宠模式后窗口会按此缩放自动调整。
            </p>
          </div>
        )}

        {activeTab === "history" && <HistoryTab />}

        {activeTab === "todo" && <TodoTab />}

        {activeTab === "window" && <WindowTab />}
      </div>
    </div>
  );
}

// ---- 01 宠物配置子组件 ----

function Section({ title, desc, children }: { title: string; desc: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-paper-deep/40 bg-paper/80 p-5 shadow-sm">
      <h3 className="text-sm font-bold text-ink">{title}</h3>
      <p className="mb-4 mt-0.5 text-[11px] leading-5 text-ink-soft">{desc}</p>
      {children}
    </section>
  );
}

function Range({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium text-ink-soft">{label}</span>
        <span className="font-mono text-[11px] font-bold text-cyan-500">
          {Math.round(value)}{step < 1 ? "%" : ""}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-cyan-500"
      />
      <div className="mt-0.5 flex justify-between font-mono text-[10px] font-bold text-ink-ghost">
        <span>{min}{step < 1 ? "%" : ""}</span>
        <span>{max}{step < 1 ? "%" : ""}</span>
      </div>
    </div>
  );
}

// ---- 02 对话历史 ----

function HistoryTab() {
  const [messages, setMessages] = useState<PetChatMessage[]>(() => loadPetChatMessages());

  const clear = () => {
    localStorage.removeItem("lingchat_pet_chat_messages");
    setMessages([]);
  };

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-4 flex items-end justify-between border-b-2 border-paper-deep/30 pb-2">
        <div>
          <h2 className="mb-1 text-xl font-display font-bold text-ink">对话历史</h2>
          <p className="text-xs font-medium text-ink-soft">桌宠自己的聊天记录（点击气泡与桌宠对话产生）</p>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={clear}
            className="rounded-lg border border-danger/40 px-3 py-1.5 text-xs font-semibold text-danger transition-all hover:bg-danger/10"
          >
            清空历史
          </button>
        )}
      </header>

      {messages.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-paper-deep/30 p-10 text-ink-ghost">
          <p className="text-3xl" aria-hidden>
            💬
          </p>
          <p className="mt-3 text-sm font-bold tracking-wider">暂无对话记录</p>
          <p className="mt-1 text-[11px]">点击桌宠立绘，在底部输入条和 TA 说句话吧。</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {messages.map((message, index) => (
            <div
              key={index}
              className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-xs leading-6 shadow-sm ${
                  message.role === "user"
                    ? "rounded-br-md bg-cyan-500/90 text-white"
                    : "rounded-bl-md border border-paper-deep/30 bg-paper/90 text-ink"
                }`}
              >
                <p className={`mb-0.5 text-[10px] font-semibold ${message.role === "user" ? "text-white/70" : "text-cyan-500"}`}>
                  {message.role === "user" ? "我" : "桌宠"}
                </p>
                <p className="whitespace-pre-wrap break-words">{message.content}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- 03 TODO ----

function TodoTab() {
  const [groups, setGroups] = useState<PetTodoGroup[]>(() => loadTodoGroups());
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [newGroupTitle, setNewGroupTitle] = useState("");
  const [newTodoText, setNewTodoText] = useState("");

  const persist = (next: PetTodoGroup[]) => {
    setGroups(next);
    saveTodoGroups(next);
  };

  const activeGroup = groups.find((group) => group.id === activeGroupId) ?? null;

  const createGroup = () => {
    const title = newGroupTitle.trim();
    if (!title) return;
    persist([...groups, { id: uid(), title, todos: [] }]);
    setNewGroupTitle("");
  };

  const removeGroup = (id: string) => {
    persist(groups.filter((group) => group.id !== id));
    if (activeGroupId === id) setActiveGroupId(null);
  };

  const addTodo = () => {
    const text = newTodoText.trim();
    if (!activeGroup || !text) return;
    persist(
      groups.map((group) =>
        group.id === activeGroup.id
          ? { ...group, todos: [...group.todos, { id: uid(), text, done: false }] }
          : group,
      ),
    );
    setNewTodoText("");
  };

  const toggleTodo = (todoId: string) => {
    if (!activeGroup) return;
    persist(
      groups.map((group) =>
        group.id === activeGroup.id
          ? {
              ...group,
              todos: group.todos.map((todo) =>
                todo.id === todoId ? { ...todo, done: !todo.done } : todo,
              ),
            }
          : group,
      ),
    );
  };

  const removeTodo = (todoId: string) => {
    if (!activeGroup) return;
    persist(
      groups.map((group) =>
        group.id === activeGroup.id
          ? { ...group, todos: group.todos.filter((todo) => todo.id !== todoId) }
          : group,
      ),
    );
  };

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-4 flex items-end justify-between border-b-2 border-paper-deep/30 pb-2">
        <div>
          <h2 className="mb-1 text-xl font-display font-bold text-ink">
            {activeGroup ? activeGroup.title : "TODO 分组"}
          </h2>
          <p className="text-xs font-medium text-ink-soft">
            {activeGroup
              ? `共 ${activeGroup.todos.length} 项 · 已完成 ${activeGroup.todos.filter((todo) => todo.done).length} 项`
              : "把任务分组管理，桌宠会记住它们"}
          </p>
        </div>
        {activeGroup ? (
          <button
            type="button"
            onClick={() => setActiveGroupId(null)}
            className="rounded-lg border border-paper-deep/40 px-3 py-1.5 text-xs font-semibold text-ink-soft transition-all hover:bg-paper-warm"
          >
            ← 返回分组
          </button>
        ) : (
          <button
            type="button"
            onClick={createGroup}
            disabled={!newGroupTitle.trim()}
            className="rounded-lg border border-cyan-400/60 bg-cyan-500/10 px-3 py-1.5 text-xs font-bold text-cyan-600 transition-all hover:bg-cyan-500/20 disabled:opacity-40"
          >
            + 新建分组
          </button>
        )}
      </header>

      {!activeGroup ? (
        <div className="space-y-4">
          <div className="flex gap-2">
            <input
              value={newGroupTitle}
              onChange={(event) => setNewGroupTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") createGroup();
              }}
              placeholder="输入分组名称，回车创建…"
              className="min-w-0 flex-1 rounded-lg border border-paper-deep/40 bg-paper/80 px-3 py-2 text-xs text-ink outline-none focus:border-cyan-400/60"
            />
          </div>
          {groups.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-paper-deep/30 p-10 text-ink-ghost">
              <p className="text-3xl" aria-hidden>
                ☑
              </p>
              <p className="mt-3 text-sm font-bold tracking-wider">暂无 TODO 分组</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {groups.map((group) => (
                <div
                  key={group.id}
                  onClick={() => setActiveGroupId(group.id)}
                  className="group relative cursor-pointer overflow-hidden rounded-xl border border-paper-deep/40 bg-paper/80 p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-cyan-400/50"
                >
                  <div className="absolute left-0 top-0 h-full w-1 bg-cyan-300 transition-colors group-hover:bg-cyan-500" />
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      removeGroup(group.id);
                    }}
                    className="absolute right-3 top-3 text-xs text-ink-ghost opacity-0 transition-all hover:text-danger group-hover:opacity-100"
                    aria-label="删除分组"
                  >
                    ✕
                  </button>
                  <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-ink-ghost">
                    Todo Group
                  </p>
                  <h3 className="mt-1 truncate pr-6 text-[15px] font-bold text-ink">
                    {group.title}
                  </h3>
                  <p className="mt-2 font-mono text-xs text-ink-ghost">
                    {group.todos.length} 项任务
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex gap-2">
            <input
              value={newTodoText}
              onChange={(event) => setNewTodoText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") addTodo();
              }}
              placeholder="添加一项任务，回车确认…"
              className="min-w-0 flex-1 rounded-lg border border-paper-deep/40 bg-paper/80 px-3 py-2 text-xs text-ink outline-none focus:border-cyan-400/60"
            />
            <button
              type="button"
              onClick={addTodo}
              disabled={!newTodoText.trim()}
              className="rounded-lg border border-cyan-400/60 bg-cyan-500/10 px-4 text-xs font-bold text-cyan-600 transition-all hover:bg-cyan-500/20 disabled:opacity-40"
            >
              + 添加
            </button>
          </div>
          {activeGroup.todos.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-paper-deep/30 p-8 text-ink-ghost">
              <p className="text-sm font-bold tracking-wider">这个分组还没有任务</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {activeGroup.todos.map((todo) => (
                <li
                  key={todo.id}
                  className="flex items-center gap-3 rounded-xl border border-paper-deep/30 bg-paper/80 px-4 py-2.5 transition-all hover:border-cyan-400/40"
                >
                  <input
                    type="checkbox"
                    checked={todo.done}
                    onChange={() => toggleTodo(todo.id)}
                    className="h-4 w-4 accent-cyan-500"
                  />
                  <span
                    className={`min-w-0 flex-1 text-xs transition-all ${
                      todo.done ? "text-ink-ghost line-through" : "text-ink"
                    }`}
                  >
                    {todo.text}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeTodo(todo.id)}
                    className="text-xs text-ink-ghost transition-colors hover:text-danger"
                    aria-label="删除任务"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ---- 04 主动系统 ----

function WindowTab() {
  const [proactive, setProactive] = useState<LingChatProactiveConfig>(() => loadProactiveConfig());
  const [saveStatus, setSaveStatus] = useState<{ message: string; color: string } | null>(null);

  const save = () => {
    saveProactiveConfig(proactive);
    setSaveStatus({ message: "已保存，主动问候将在桌宠层生效", color: "#22d3ee" });
    window.setTimeout(() => setSaveStatus(null), 2600);
  };

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-4 flex items-end justify-between border-b-2 border-paper-deep/30 pb-2">
        <div>
          <h2 className="mb-1 text-xl font-display font-bold text-ink">主动系统</h2>
          <p className="text-xs font-medium text-ink-soft">
            桌宠会按固定间隔主动向你说一句问候（对应 LingChat Proactive 系统）
          </p>
        </div>
        <span className="select-none font-mono text-4xl font-bold italic uppercase text-bamboo-mist">
          Set
        </span>
      </header>

      <div className="space-y-4">
        <section className="rounded-2xl border border-paper-deep/40 bg-paper/80 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-ink">主动问候</h3>
              <p className="mt-0.5 text-[11px] leading-5 text-ink-soft">
                开启后桌宠每隔设定间隔会主动弹出问候气泡（带情绪音效）
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={proactive.enabled}
              onClick={() => setProactive((current) => ({ ...current, enabled: !current.enabled }))}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                proactive.enabled ? "bg-cyan-500" : "bg-paper-deep/50"
              }`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                  proactive.enabled ? "left-[22px]" : "left-0.5"
                }`}
              />
            </button>
          </div>
        </section>

        <section className="rounded-2xl border border-paper-deep/40 bg-paper/80 p-5 shadow-sm">
          <h3 className="text-sm font-bold text-ink">触发间隔</h3>
          <p className="mb-3 mt-0.5 text-[11px] leading-5 text-ink-soft">
            自上次问候后经过该时长（分钟），桌宠才会再次主动开口
          </p>
          <input
            type="number"
            min={1}
            max={1440}
            value={proactive.intervalMin}
            onChange={(event) =>
              setProactive((current) => ({
                ...current,
                intervalMin: Math.max(1, Math.min(1440, Number(event.target.value) || 1)),
              }))
            }
            className="w-full rounded-lg border border-paper-deep/40 bg-paper/80 px-3 py-2 font-mono text-xs text-ink outline-none focus:border-cyan-400/60"
          />
          <div className="mt-2 flex justify-between font-mono text-[10px] font-bold text-ink-ghost">
            <span>MIN 1 分钟</span>
            <span className="text-cyan-500">DEF 15 分钟</span>
            <span>MAX 1440 分钟（24h）</span>
          </div>
        </section>

        <section className="flex items-center justify-between rounded-2xl border border-paper-deep/40 bg-paper-warm/60 p-5">
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[10px] font-bold tracking-wider text-cyan-500">
              ACTION LOGIC
            </span>
            <h3 className="text-sm font-bold text-ink">应用设置</h3>
            <p
              className="text-[11px]"
              style={saveStatus ? { color: saveStatus.color } : { color: "var(--color-ink-ghost)" }}
            >
              {saveStatus?.message ?? "保存后立即生效，无需重启"}
            </p>
          </div>
          <button
            type="button"
            onClick={save}
            className="h-11 rounded-full border border-cyan-400/50 bg-white px-6 text-sm font-bold text-cyan-500 shadow-sm transition-all hover:scale-105 hover:bg-cyan-50 active:scale-95"
          >
            保存
          </button>
        </section>
      </div>
    </div>
  );
}
