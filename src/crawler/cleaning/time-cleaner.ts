// crawler/cleaning/time-cleaner.ts — 时间清洗

export interface CleanedTime {
  iso: string | null;
  confidence: number;  // 0-100
  rawText: string;
}

export class TimeCleaner {
  /** 清洗时间字符串 → ISO 8601 */
  clean(raw: string | undefined | null): CleanedTime {
    const rawText = String(raw ?? '');
    if (!raw || rawText === '') {
      return { iso: null, confidence: 0, rawText };
    }

    const text = rawText.trim();

    // ISO 8601 直接解析
    if (text.match(/^\d{4}-\d{2}-\d{2}T/)) {
      const d = new Date(text);
      if (!isNaN(d.getTime())) return { iso: d.toISOString(), confidence: 100, rawText };
    }

    // YYYY-MM-DD
    const dmy = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (dmy && dmy[1] && dmy[2] && dmy[3]) {
      const d = new Date(`${dmy[1]}-${dmy[2].padStart(2, '0')}-${dmy[3].padStart(2, '0')}T00:00:00+08:00`);
      if (!isNaN(d.getTime())) return { iso: d.toISOString(), confidence: 95, rawText };
    }

    // YYYY年MM月DD日
    const cn = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
    if (cn && cn[1] && cn[2] && cn[3]) {
      const d = new Date(`${cn[1]}-${cn[2].padStart(2, '0')}-${cn[3].padStart(2, '0')}T00:00:00+08:00`);
      if (!isNaN(d.getTime())) return { iso: d.toISOString(), confidence: 90, rawText };
    }

    // MM月DD日（无年份）→ 不补全，标记低置信度
    const cnNoYear = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
    if (cnNoYear && cnNoYear[1] && cnNoYear[2]) {
      // 不强行补年份，返回 null
      return { iso: null, confidence: 20, rawText: `${cnNoYear[1]!}月${cnNoYear[2]!}日（无年份）` };
    }

    // "X天后" / "X天前" → 相对时间
    const future = text.match(/(\d+)\s*天后/);
    if (future) {
      const d = new Date();
      d.setDate(d.getDate() + parseInt(future[1]!));
      return { iso: d.toISOString(), confidence: 70, rawText };
    }
    const past = text.match(/(\d+)\s*天前/);
    if (past) {
      const d = new Date();
      d.setDate(d.getDate() - parseInt(past[1]!));
      return { iso: d.toISOString(), confidence: 70, rawText };
    }

    // "即将" / "近期"
    if (/即将|近期|马上/.test(text)) {
      return { iso: null, confidence: 10, rawText: '即将（模糊时间）' };
    }

    return { iso: null, confidence: 0, rawText };
  }

  /** 判断时间是否在未来 */
  isFuture(iso: string | null): boolean {
    if (!iso) return false;
    return new Date(iso).getTime() > Date.now();
  }

  /** 判断时间是否过期（超过 N 天） */
  isExpired(iso: string | null, daysThreshold: number = 30): boolean {
    if (!iso) return false;
    const diff = Date.now() - new Date(iso).getTime();
    return diff > daysThreshold * 86400000;
  }
}
