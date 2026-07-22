export type CompressionLevel = 'lossless' | 'high' | 'balanced';

interface CompressOptions {
  level: CompressionLevel;
  maxWidth?: number;
  maxHeight?: number;
}

const QUALITY_MAP: Record<CompressionLevel, number> = {
  lossless: 0.92,
  high: 0.8,
  balanced: 0.6,
};

export async function compressImage(
  file: File, 
  options: CompressOptions = { level: 'balanced' }
): Promise<Blob> {
  const img = await createImageBitmap(file);
  const { level, maxWidth = 1920, maxHeight = 2560 } = options;
  
  let width = img.width;
  let height = img.height;
  
  if (width > maxWidth) {
    height = (height * maxWidth) / width;
    width = maxWidth;
  }
  if (height > maxHeight) {
    width = (width * maxHeight) / height;
    height = maxHeight;
  }
  
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, width, height);
  img.close();
  
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob || file),
      file.type || 'image/jpeg',
      QUALITY_MAP[level]
    );
  });
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
