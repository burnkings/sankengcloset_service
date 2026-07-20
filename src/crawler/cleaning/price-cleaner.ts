// crawler/cleaning/price-cleaner.ts — 价格清洗

export interface CleanedPrice {
  currentPrice: number;      // 分
  originalPrice: number;     // 分
  depositPrice: number;      // 分
  balancePrice: number;      // 分
  currency: string;
  confidence: number;        // 0-100
  rawText: string;
}

export class PriceCleaner {
  /** 清洗价格字符串 → 分 */
  clean(raw: string | number | undefined | null): CleanedPrice {
    const rawText = String(raw ?? '');
    if (raw === undefined || raw === null || rawText === '') {
      return { currentPrice: 0, originalPrice: 0, depositPrice: 0, balancePrice: 0, currency: 'CNY', confidence: 0, rawText };
    }

    // 数字直接转分
    if (typeof raw === 'number') {
      return { currentPrice: Math.round(raw * 100), originalPrice: 0, depositPrice: 0, balancePrice: 0, currency: 'CNY', confidence: 100, rawText };
    }

    const text = rawText.trim();

    // 解析定金+尾款模式: "定金100 尾款268"
    const depositMatch = text.match(/定金\s*[¥￥]?\s*(\d+(?:\.\d+)?)/);
    const balanceMatch = text.match(/尾款\s*[¥￥]?\s*(\d+(?:\.\d+)?)/);
    if (depositMatch && balanceMatch) {
      const deposit = Math.round(parseFloat(depositMatch[1]!) * 100);
      const balance = Math.round(parseFloat(balanceMatch[1]!) * 100);
      return { currentPrice: deposit + balance, originalPrice: 0, depositPrice: deposit, balancePrice: balance, currency: 'CNY', confidence: 90, rawText };
    }

    // 价格区间: "¥128-168" 或 "128~168"
    const rangeMatch = text.match(/[¥￥]?\s*(\d+(?:\.\d+)?)\s*[-~～至到]\s*[¥￥]?\s*(\d+(?:\.\d+)?)/);
    if (rangeMatch) {
      const low = parseFloat(rangeMatch[1]!);
      const high = parseFloat(rangeMatch[2]!);
      // 取低价作为当前价
      return { currentPrice: Math.round(low * 100), originalPrice: Math.round(high * 100), depositPrice: 0, balancePrice: 0, currency: 'CNY', confidence: 80, rawText };
    }

    // 单一价格: "¥128" 或 "128元"
    const singleMatch = text.match(/[¥￥]?\s*(\d+(?:\.\d+)?)\s*(?:元|¥|￥)?/);
    if (singleMatch) {
      const price = parseFloat(singleMatch[1]!);
      return { currentPrice: Math.round(price * 100), originalPrice: 0, depositPrice: 0, balancePrice: 0, currency: 'CNY', confidence: 95, rawText };
    }

    return { currentPrice: 0, originalPrice: 0, depositPrice: 0, balancePrice: 0, currency: 'CNY', confidence: 0, rawText };
  }

  /** 清洗原价 */
  cleanOriginal(raw: string | number | undefined | null): number {
    const result = this.clean(raw);
    return result.originalPrice;
  }

  /** 判断价格是否合理 */
  isReasonable(priceCents: number): boolean {
    if (priceCents <= 0) return false;
    if (priceCents < 100) return false;    // < ¥1 可疑
    if (priceCents > 100_000_000) return false; // > ¥100万 可疑
    return true;
  }
}
