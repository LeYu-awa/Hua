import { useState, useCallback } from 'react';
import { searchKnowledge } from '../services/SearchBridge';
import type { CanvasSearchResult, CanvasNodeData } from '../types';

export function useCanvasSearch(addNode: (type: 'search_card', title: string, x: number, y: number) => Promise<CanvasNodeData>) {
  const [searchResults, setSearchResults] = useState<CanvasSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const search = useCallback(async (query: string) => {
    setSearching(true);
    try {
      const results = await searchKnowledge(query);
      setSearchResults(results);
    } finally {
      setSearching(false);
    }
  }, []);

  const addSearchResultAsNode = useCallback(async (result: CanvasSearchResult, x: number, y: number) => {
    const node = await addNode('search_card', result.title, x, y);
    return node;
  }, [addNode]);

  return { searchResults, searching, search, addSearchResultAsNode, setSearchResults };
}
