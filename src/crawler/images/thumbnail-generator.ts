// crawler/images/thumbnail-generator.ts — 缩略图生成

export interface ThumbnailResult {
  buffer: Buffer;
  width: number;
  height: number;
  format: string;
}

export class ThumbnailGenerator {
  /** 生成缩略图（保持宽高比） */
  async generate(
    inputBuffer: Buffer,
    maxWidth: number,
    maxHeight: number = maxWidth,
    quality: number = 80,
  ): Promise<ThumbnailResult | null> {
    try {
      const sharp = (await import('sharp')).default;
      const result = await sharp(inputBuffer)
        .resize(maxWidth, maxHeight, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality })
        .toBuffer({ resolveWithObject: true });

      return {
        buffer: result.data,
        width: result.info.width,
        height: result.info.height,
        format: 'jpeg',
      };
    } catch {
      return null;
    }
  }

  /** 生成多个尺寸的缩略图 */
  async generateMultiple(
    inputBuffer: Buffer,
    sizes: number[] = [120, 240, 480],
  ): Promise<Map<number, ThumbnailResult>> {
    const results = new Map<number, ThumbnailResult>();
    for (const size of sizes) {
      const thumb = await this.generate(inputBuffer, size);
      if (thumb) results.set(size, thumb);
    }
    return results;
  }
}
