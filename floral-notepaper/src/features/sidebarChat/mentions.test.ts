import { describe, expect, test } from "vitest";
import { buildToolPlanFromMentions, formatNoteReferenceToken } from "./mentions";
import type { NoteMention } from "./mentions";

const notes: NoteMention[] = [
  {
    id: "579ceaec-8517-422e-b997-e28721da854b",
    title: "大模型",
    category: "AI",
  },
];

describe("sidebar chat mentions", () => {
  test("引用笔记并要求润色时直接生成读取后优化计划", () => {
    const token = formatNoteReferenceToken("大模型", notes[0].id);
    const plan = buildToolPlanFromMentions(`#${token} 帮我润色这个文章`, notes);

    expect(plan?.tool).toBe("note.read");
    expect(plan?.params).toEqual({ id: notes[0].id });
    expect(plan?.workflow).toBe("note.optimize");
  });

  test("引用笔记并要求读取/总结时直接生成读取后回答计划", () => {
    const token = formatNoteReferenceToken("大模型", notes[0].id);
    const plan = buildToolPlanFromMentions(`#${token} 读完了吗，帮我总结`, notes);

    expect(plan?.tool).toBe("note.read");
    expect(plan?.params).toEqual({ id: notes[0].id });
    expect(plan?.workflow).toBe("note.answer");
  });
});
