import { newId, nowIso } from '../lib/id.js';
import { emptyAiSuggestion, type AiImportTask, type MediaObject } from '../types.js';
import type { AppRepository } from '../repositories/contracts.js';
import type { ObjectStorage } from '../storage/types.js';
import { AI_UNAVAILABLE_MESSAGE, type OrderRecognizer } from './vision-ocr.js';

/**
 * 创建 pending 任务（异步 worker 接管后续状态流转）。
 * 任务刚创建时 suggestion 必须为空——绝不在识别前编造字段。
 */
export function createPendingTask(input: {
  userId: string;
  objectKey: string;
  mediaId: string;
  taskType: string;
  sourcePlatform: string;
  sourceLink: string;
  requestId: string;
}): AiImportTask {
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  return {
    taskId: newId('ait'),
    userId: input.userId,
    objectKey: input.objectKey,
    mediaId: input.mediaId,
    taskType: input.taskType,
    sourcePlatform: input.sourcePlatform,
    sourceLink: input.sourceLink,
    state: 'pending',
    requestId: input.requestId,
    model: { provider: 'vision', name: '', version: '' },
    suggestion: emptyAiSuggestion(),
    confidence: 0,
    fieldConfidence: {},
    evidence: [],
    warnings: [],
    createdAt,
    expiresAt,
    confirmedAt: null,
    targetType: null,
    targetId: null,
  };
}

export interface AiWorkerContext {
  repository: AppRepository;
  storage: ObjectStorage;
  recognizer: OrderRecognizer;
  task: AiImportTask;
  media: MediaObject;
}

/**
 * 订单截图识别 worker：pending → processing → ready | failed。
 * - 模型不可用 / 任何异常 → failed + 中文 warnings，不编造字段。
 * - failed 状态下 suggestion 保持空，前端确认页手动补全。
 */
export async function runImportTaskWorker(context: AiWorkerContext): Promise<void> {
  const { repository, storage, recognizer, task, media } = context;
  const mark = (patch: Parameters<AppRepository['updateAiTask']>[2]) =>
    repository.updateAiTask(task.taskId, task.userId, patch);

  try {
    await mark({ state: 'processing' });
    const imageBytes = await storage.get(media.objectKey);
    const result = await recognizer.recognizeOrder({
      media,
      imageBytes,
      sourcePlatform: task.sourcePlatform,
    });
    await mark({
      state: 'ready',
      suggestion: result.suggestion,
      confidence: result.confidence,
      fieldConfidence: result.fieldConfidence,
      evidence: result.evidence,
      warnings: result.warnings,
      model: { provider: 'vision', name: result.model.name, version: result.model.version },
    });
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : AI_UNAVAILABLE_MESSAGE;
    await mark({
      state: 'failed',
      suggestion: emptyAiSuggestion(),
      confidence: 0,
      fieldConfidence: {},
      evidence: [],
      warnings: [message],
    });
  }
}
