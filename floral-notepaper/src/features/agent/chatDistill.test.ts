import { describe, expect, it } from "vitest";
import {
  classifyMessage,
  distillChatMessages,
  toDistillCommand,
  type ChatMessage,
} from "./chatDistill";

function msg(id: string, content: string): ChatMessage {
  return { id, docId: "doc1", senderId: "u1", content, createdAt: 1000 };
}

describe("classifyMessage", () => {
  it("识别决策类", () => {
    expect(classifyMessage("我们就先做实时同步 MVP 吧")).toBe("decision");
  });
  it("识别待办类", () => {
    expect(classifyMessage("记得下周要做接口联调")).toBe("todo");
  });
  it("识别风险类", () => {
    expect(classifyMessage("这里有个风险，可能会失败")).toBe("risk");
  });
  it("识别问题类", () => {
    expect(classifyMessage("这个功能怎么实现")).toBe("question");
  });
  it("普通闲聊归为 chatter", () => {
    expect(classifyMessage("今天天气真不错呀")).toBe("chatter");
  });
  it("风险优先级高于决策", () => {
    // 同时含"决定"和"风险"，应归风险
    expect(classifyMessage("我们决定上云，但有风险")).toBe("risk");
  });
});

describe("distillChatMessages", () => {
  it("只沉淀决策/待办/风险类消息", () => {
    const messages = [
      msg("m1", "我们就先做实时同步 MVP 吧"), // decision
      msg("m2", "今天天气真不错呀"), // chatter -> 跳过
      msg("m3", "记得安排下周的接口联调"), // todo
    ];
    const r = distillChatMessages(messages);
    expect(r.map((s) => s.messageId)).toEqual(["m1", "m3"]);
    expect(r[0].category).toBe("decision");
  });

  it("过短消息被忽略", () => {
    const r = distillChatMessages([msg("m1", "决定")]);
    expect(r).toEqual([]);
  });

  it("压缩文案去掉口语前缀和语气词", () => {
    const r = distillChatMessages([msg("m1", "那我们就先做实时同步吧")]);
    expect(r).toHaveLength(1);
    expect(r[0].suggestedText).not.toMatch(/^那/);
    expect(r[0].suggestedText).not.toMatch(/吧$/);
  });

  it("尊重 maxSuggestions 上限", () => {
    const messages = Array.from({ length: 8 }, (_, i) =>
      msg(`m${i}`, `我们决定采用方案 ${i} 号来推进`),
    );
    const r = distillChatMessages(messages, { maxSuggestions: 3 });
    expect(r).toHaveLength(3);
  });
});

describe("toDistillCommand", () => {
  it("转成 distill_chat_node 指令", () => {
    const [s] = distillChatMessages([msg("m1", "我们决定采用混合云方案推进")]);
    const cmd = toDistillCommand(s);
    expect(cmd.type).toBe("distill_chat_node");
    if (cmd.type === "distill_chat_node") {
      expect(cmd.messageId).toBe("m1");
      expect(cmd.docId).toBe("doc1");
      expect(cmd.suggestedText.length).toBeGreaterThan(0);
    }
  });
});
