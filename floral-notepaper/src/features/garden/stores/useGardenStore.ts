import { useState, useCallback } from "react";
import type { Category, GardenArticle, GardenFolder } from "../types";
import * as api from "../api";

export function useGardenStore(userId?: string | null) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [articles, setArticles] = useState<GardenArticle[]>([]);
  const [folders, setFolders] = useState<GardenFolder[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"public" | "personal">("public");

  const loadCategories = useCallback(async () => {
    const data = await api.getCategories(userId ?? undefined);
    setCategories(data);
  }, [userId]);

  const loadPublicArticles = useCallback(async (categoryId?: string) => {
    setLoading(true);
    try {
      const data = await api.getPublicArticles(categoryId);
      setArticles(data);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadUserArticles = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const data = await api.getUserArticles(userId);
      setArticles(data);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const loadFolders = useCallback(async () => {
    if (!userId) return;
    const data = await api.getFolders(userId);
    setFolders(data);
  }, [userId]);

  const createCategory = useCallback(
    async (name: string, icon?: string, color?: string) => {
      if (!userId) return;
      const cat = await api.createCategory(name, userId, icon, color);
      if (cat) setCategories((prev) => [...prev, cat]);
    },
    [userId],
  );

  const createArticle = useCallback(
    async (article: Partial<GardenArticle>) => {
      if (!userId) return null;
      const result = await api.createArticle(article, userId);
      if (result) setArticles((prev) => [result, ...prev]);
      return result;
    },
    [userId],
  );

  const createFolder = useCallback(
    async (name: string, parentId?: string) => {
      if (!userId) return;
      const folder = await api.createFolder(name, userId, parentId);
      if (folder) setFolders((prev) => [...prev, folder]);
    },
    [userId],
  );

  return {
    categories,
    articles,
    folders,
    loading,
    activeTab,
    setActiveTab,
    setArticles,
    loadCategories,
    loadPublicArticles,
    loadUserArticles,
    loadFolders,
    createCategory,
    createArticle,
    createFolder,
  };
}
