import { newId, nowIso } from '../lib/id.js';
import type { AiImportTask } from '../types.js';

export function createSafeMockTask(userId: string, objectKey: string, requestId: string): AiImportTask {
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  return {
    taskId: newId('ait'), userId, objectKey, state: 'ready', requestId,
    model: { provider: 'local', name: 'safe-boundary', version: 'v1' },
    suggestion: {
      name: '待确认单品', category: 'OTHER', brand: '', priceCents: 0, color: '', size: '',
      note: '安全草稿未读取图片内容，请逐项确认。',
    },
    confidence: 0.1,
    fieldConfidence: {},
    evidence: ['safe_mock 未读取图片像素', '品牌、价格与尺码保持空白'],
    warnings: ['尚未连接真实视觉模型，所有字段必须人工确认'],
    createdAt, expiresAt, confirmedAt: null, targetType: null, targetId: null,
  };
}
