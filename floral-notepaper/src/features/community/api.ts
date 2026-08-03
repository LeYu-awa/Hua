import type {
  CommunityArticle,
  Category,
  CommunityFilters,
} from "./types";

/* ═══════════════════════════════════════════
   Mock 数据 — 模拟后端接口响应
   ═══════════════════════════════════════════ */

const CATEGORIES: Category[] = [
  { id: "all", name: "全部", icon: "🌟", color: "#FF6B81" },
  { id: "tech", name: "科技", icon: "💻", color: "#4A90D9" },
  { id: "emotion", name: "情感", icon: "💕", color: "#FF6B81" },
  { id: "career", name: "职场", icon: "💼", color: "#F5A623" },
  { id: "life", name: "生活", icon: "☕", color: "#7ED321" },
  { id: "literature", name: "文学", icon: "📖", color: "#9B59B6" },
  { id: "art", name: "艺术", icon: "🎨", color: "#E74C3C" },
  { id: "food", name: "美食", icon: "🍜", color: "#E67E22" },
  { id: "travel", name: "旅行", icon: "✈️", color: "#3498DB" },
  { id: "study", name: "学习", icon: "📚", color: "#2ECC71" },
  { id: "design", name: "设计", icon: "🎯", color: "#1ABC9C" },
  { id: "finance", name: "理财", icon: "💰", color: "#F1C40F" },
];

const AVATAR_BASE = "https://api.dicebear.com/7.x/thumbs/svg?seed=";

function mockAuthor(index: number) {
  return {
    id: `author-${index}`,
    name: ["林清", "苏晚", "陈知微", "沈念", "江牧", "温言", "顾北", "安然"][index % 8],
    avatarUrl: `${AVATAR_BASE}author${index}`,
  };
}

function randomCover(seed: number, ratio: string): string {
  return `https://picsum.photos/seed/community${seed}/400/${ratio === "1:1" ? "400" : ratio === "3:4" ? "533" : "225"}`;
}

function createMockArticles(): CommunityArticle[] {
  const now = Date.now();
  const articles: CommunityArticle[] = [];
  const titles = [
    "为什么我放弃了大厂 Offer 选择自由职业",
    "用 Notion 搭建个人知识体系，效率翻倍",
    "写给 25 岁：关于爱情、职场和人生的 10 条建议",
    "深度解读 ChatGPT 背后的技术原理",
    "我在大理旅居三个月的生活实录",
    "如何用半年时间学会一门外语",
    "那些年我们追过的宫崎骏电影",
    "程序员必备的 10 个效率工具推荐",
    "一个人住，如何把生活过得有仪式感",
    "从月薪 5k 到 50k，我做对了什么",
    "旅行摄影入门：手机也能拍出大片",
    "亲密关系中的沟通艺术",
    "2024 年最值得阅读的 20 本书单",
    "咖啡入门指南：从选豆到手冲",
    "如何克服拖延症？我的 5 个实用方法",
  ];
  const summaries = [
    "在经历了三年的互联网大厂生涯后，我最终做出了一个让所有人意外的决定。这篇文章记录了我从犹豫到坚定的心路历程，以及自由职业半年来的真实感受。",
    "经过两年的不断迭代，我终于搭建了一套真正适合自己的知识管理体系。从信息收集、整理到输出，每一个环节都有对应的工具和方法。",
    "二十五岁是一个奇妙的年纪，既褪去了少年的青涩，又还未完全成熟。站在这个节点上，想和你们分享一些我在经历中领悟到的事情。",
    "从 GPT-3.5 到 GPT-4，大语言模型的发展速度超乎想象。这篇文章用通俗易懂的方式，带你理解 Transformer 架构的核心思想。",
    "很多人问我为什么要选择旅居这种不确定的生活方式。三个月的时间，我学会了与自己相处，也重新定义了什么是「家」。",
    "语言学习没有捷径，但有方法可循。通过科学的学习策略和持续的行动，半年时间足以让你掌握一门新语言的基础交流能力。",
  ];

  for (let i = 0; i < 60; i++) {
    const catIndex = (i % (CATEGORIES.length - 1)) + 1;
    const r = (Math.random() * 16777215) | 0;
    const ratio: ("1:1" | "3:4" | "16:9") = (["1:1", "3:4", "16:9"] as const)[i % 3];
    articles.push({
      id: `article-${i}`,
      title: titles[i % titles.length],
      summary: summaries[i % summaries.length],
      content: `# ${titles[i % titles.length]}\n\n${summaries[i % summaries.length]}\n\n这是一篇完整的文章内容，包含详细的论述和丰富的例子。由于是模拟数据，此处省略了完整的正文。实际项目中，这里将渲染完整的富文本内容。`,
      coverImage: i % 4 === 0 ? undefined : randomCover(i, ratio),
      coverRatio: ratio,
      categoryId: CATEGORIES[catIndex].id,
      tags: ["随笔", "生活", "思考"].slice(0, (i % 3) + 1),
      author: mockAuthor(i),
      viewCount: 1000 + ((r % 9000) * (60 - i)) / 60,
      likeCount: 50 + ((r % 500) * (60 - i)) / 60,
      commentCount: 5 + ((r % 80) * (60 - i)) / 60,
      bookmarkCount: 10 + ((r % 200) * (60 - i)) / 60,
      shareCount: 3 + ((r % 50) * (60 - i)) / 60,
      readTime: 3 + (i % 8),
      isLiked: false,
      isBookmarked: false,
      createdAt: new Date(now - i * 3600000 * 2).toISOString(),
      updatedAt: new Date(now - i * 3600000 * 1.5).toISOString(),
    });
  }
  return articles;
}

const MOCK_ARTICLES = createMockArticles();

/* ═══════════════════════════════════════════
   API 函数（模拟请求延迟）
   ═══════════════════════════════════════════ */

function delay(ms = 300): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function fetchCategories(): Promise<Category[]> {
  await delay(150);
  return CATEGORIES;
}

export async function fetchArticles(
  filters: CommunityFilters,
  page: number,
  pageSize = 10,
): Promise<{ data: CommunityArticle[]; hasMore: boolean }> {
  await delay(250);

  let filtered = [...MOCK_ARTICLES];

  // 分类筛选
  if (filters.categoryId && filters.categoryId !== "all") {
    filtered = filtered.filter((a) => a.categoryId === filters.categoryId);
  }

  // 排序
  if (filters.sort === "latest") {
    filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } else if (filters.sort === "hot") {
    filtered.sort((a, b) => b.viewCount + b.likeCount * 2 - (a.viewCount + a.likeCount * 2));
  } else {
    // recommend — 混合排序（模拟推荐）
    filtered.sort((a, b) => {
      const scoreA = a.likeCount * 0.4 + a.commentCount * 0.3 + a.shareCount * 0.3;
      const scoreB = b.likeCount * 0.4 + b.commentCount * 0.3 + b.shareCount * 0.3;
      return scoreB - scoreA;
    });
  }

  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  const paged = filtered.slice(start, end);

  return {
    data: paged,
    hasMore: end < filtered.length,
  };
}

export async function fetchArticleById(id: string): Promise<CommunityArticle | null> {
  await delay(200);
  return MOCK_ARTICLES.find((a) => a.id === id) ?? null;
}

export async function toggleLike(articleId: string, liked: boolean): Promise<void> {
  await delay(100);
  const article = MOCK_ARTICLES.find((a) => a.id === articleId);
  if (article) {
    article.isLiked = liked;
    article.likeCount += liked ? 1 : -1;
  }
}

export async function toggleBookmark(articleId: string, bookmarked: boolean): Promise<void> {
  await delay(100);
  const article = MOCK_ARTICLES.find((a) => a.id === articleId);
  if (article) {
    article.isBookmarked = bookmarked;
    article.bookmarkCount += bookmarked ? 1 : -1;
  }
}

export async function reportNotInterested(_articleId: string): Promise<void> {
  await delay(100);
  // 实际项目中会记录用户偏好，此处仅模拟
}

export async function addToReadLater(_articleId: string): Promise<void> {
  await delay(100);
  // 模拟添加到稍后读
}
