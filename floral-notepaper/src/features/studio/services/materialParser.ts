interface ParsedMaterial {
  title: string;
  summary?: string;
  coverUrl?: string;
  sourceUrl: string;
}

/** 解析 URL 获取素材信息 (前端简化版) */
export async function parseUrlMaterial(url: string): Promise<ParsedMaterial> {
  try {
    const response = await fetch(url, { mode: 'cors' });
    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    const title = 
      doc.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
      doc.querySelector('title')?.textContent ||
      url;
    
    const summary = 
      doc.querySelector('meta[property="og:description"]')?.getAttribute('content') ||
      doc.querySelector('meta[name="description"]')?.getAttribute('content') ||
      undefined;
    
    const coverUrl = 
      doc.querySelector('meta[property="og:image"]')?.getAttribute('content') ||
      undefined;
    
    return { title: title.trim(), summary, coverUrl, sourceUrl: url };
  } catch {
    // 跨域或解析失败时，以 URL 作为标题
    return { title: url, sourceUrl: url };
  }
}
