import type { AppConfig } from '../config.js';
import { emptyAiSuggestion, type AiSuggestion, type MediaObject } from '../types.js';

/**
 * 订单截图识别（尾款一键入库）。
 * 铁律：OCR/多模态模型不可用时必须失败并返回中文提示，绝不伪造识别结果。
 */
export const AI_UNAVAILABLE_MESSAGE = '当前识别服务不可用，请手动补全';

export class AiProviderUnavailable extends Error {
  retryable = true;
  constructor(message: string = AI_UNAVAILABLE_MESSAGE) {
    super(message);
    this.name = 'AiProviderUnavailable';
  }
}

export interface OrderRecognitionResult {
  suggestion: AiSuggestion;
  confidence: number;
  fieldConfidence: Record<string, number>;
  evidence: string[];
  warnings: string[];
  model: { name: string; version: string };
}

export interface OrderRecognizer {
  recognizeOrder(input: {
    media: MediaObject;
    imageBytes: Buffer;
    sourcePlatform: string;
  }): Promise<OrderRecognitionResult>;
}

export function isVisionConfigured(config: AppConfig): boolean {
  return config.AI_PROVIDER === 'remote' && config.AI_VISION_API_URL !== '';
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SOURCE_PLATFORMS = new Set(['taobao', 'weidian', 'tuanzhang', 'other', '']);

function asString(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function asCents(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function asDate(value: unknown): string {
  const s = asString(value, 10);
  return DATE_RE.test(s) ? s : '';
}

function asConfidenceMap(value: unknown): Record<string, number> {
  if (typeof value !== 'object' || value === null) return {};
  const out: Record<string, number> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    const n = typeof v === 'number' ? v : Number(v);
    if (Number.isFinite(n) && n >= 0 && n <= 1) out[key] = Math.round(n * 100) / 100;
  }
  return out;
}

/**
 * 默认识别器：调用远程视觉 API（HTTP JSON）。
 * 未配置 AI_VISION_API_URL / AI_VISION_API_KEY 时抛 AiProviderUnavailable——
 * 任务进入 failed，前端确认页手动补全，绝不返回编造字段。
 */
export function createHttpOrderRecognizer(config: AppConfig): OrderRecognizer {
  return {
    async recognizeOrder({ media, imageBytes, sourcePlatform }) {
      if (!isVisionConfigured(config)) throw new AiProviderUnavailable();

      const response = await fetch(config.AI_VISION_API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.AI_VISION_API_KEY}`,
        },
        body: JSON.stringify({
          mediaId: media.id,
          imageBase64: imageBytes.toString('base64'),
          sourcePlatform: SOURCE_PLATFORMS.has(sourcePlatform) ? sourcePlatform : '',
        }),
      });
      if (!response.ok) {
        throw new AiProviderUnavailable(`识别服务返回 ${response.status}，请手动补全`);
      }
      const raw = (await response.json()) as Record<string, unknown>;
      if (typeof raw !== 'object' || raw === null) throw new AiProviderUnavailable();

      // 只接受显式声明的字段；缺失/非法字段保持空（低置信不猜测）
      const f = (typeof raw.suggestion === 'object' && raw.suggestion !== null ? raw.suggestion : {}) as Record<string, unknown>;
      const suggestion = emptyAiSuggestion();
      suggestion.name = asString(f.name, 120);
      suggestion.brand = asString(f.brand, 120);
      suggestion.shopName = asString(f.shopName, 120);
      suggestion.category = ['JK', 'LOLITA', 'HANFU', 'OTHER'].includes(String(f.category)) ? String(f.category) as AiSuggestion['category'] : 'OTHER';
      suggestion.orderNumber = asString(f.orderNumber, 64);
      suggestion.orderDate = asDate(f.orderDate);
      suggestion.totalCents = asCents(f.totalCents);
      suggestion.depositCents = asCents(f.depositCents);
      suggestion.paidCents = asCents(f.paidCents);
      suggestion.balanceDueDate = asDate(f.balanceDueDate);
      suggestion.arrivalDate = asDate(f.arrivalDate);
      suggestion.note = asString(f.note, 1000);

      const modelRaw = (typeof raw.model === 'object' && raw.model !== null ? raw.model : {}) as Record<string, unknown>;
      const confidence = typeof raw.confidence === 'number' ? raw.confidence : 0;

      return {
        suggestion,
        confidence: Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 ? confidence : 0,
        fieldConfidence: asConfidenceMap(raw.fieldConfidence),
        evidence: Array.isArray(raw.evidence) ? raw.evidence.map((e) => asString(e, 500)).filter(Boolean) : [],
        warnings: Array.isArray(raw.warnings) ? raw.warnings.map((e) => asString(e, 500)).filter(Boolean) : [],
        model: {
          name: asString(modelRaw.name, 120) || 'vision',
          version: asString(modelRaw.version, 64) || 'v1',
        },
      };
    },
  };
}
