// crawler/pipelines/crawl-pipeline.ts — 采集流水线编排

import type postgres from 'postgres';
import type {
  CrawlJobConfig, CrawlJobStats, SourceAdapter, Parser, Normalizer,
  Validator, Deduplicator, ParsedItem, NormalizedItem, ValidationResult,
  DedupResult, FetchResult,
} from '../core/types.js';
import { createJobId, createJobStats, finishJob, recordError } from '../core/job.js';
import { Persistence } from '../storage/persistence.js';

export interface PipelineResult {
  stats: CrawlJobStats;
  items: {
    item: NormalizedItem;
    validation: ValidationResult;
    dedup: DedupResult;
    productId: string | null;
  }[];
}

export class CrawlPipeline {
  private persistence: Persistence;

  constructor(
    private readonly sql: postgres.Sql,
    private readonly adapter: SourceAdapter,
    private readonly parser: Parser,
    private readonly normalizer: Normalizer,
    private readonly validator: Validator,
    private readonly deduplicator: Deduplicator,
  ) {
    this.persistence = new Persistence(sql);
  }

  async run(config: CrawlJobConfig): Promise<PipelineResult> {
    const jobId = createJobId();
    let stats = createJobStats(config, jobId);
    const items: PipelineResult['items'] = [];

    try {
      // 1. 加载已有产品用于去重
      const existing = await this.persistence.getExistingProducts();
      this.deduplicator.load(existing);

      // 2. 获取原始数据
      const fetchResults = await this.adapter.fetchList(config.sourceUrl);
      stats = { ...stats, fetchedCount: fetchResults.length };

      // 3. 解析
      const parsedItems: ParsedItem[] = [];
      for (const result of fetchResults) {
        try {
          const parsed = this.parser.parseList(result);
          parsedItems.push(...parsed);
        } catch (e) {
          stats = recordError(stats, `解析失败: ${(e as Error).message}`);
        }
      }
      stats = { ...stats, parsedCount: parsedItems.length };

      // 4. 标准化 + 校验 + 去重
      for (const parsed of parsedItems) {
        const normalized = this.normalizer.normalize(parsed);
        const validation = this.validator.validate(normalized);
        const dedup = await this.deduplicator.check(normalized);

        let productId: string | null = null;

        if (config.dryRun) {
          // Dry run: 只记录不写库
          stats = {
            ...stats,
            acceptedCount: validation.valid ? stats.acceptedCount + 1 : stats.acceptedCount,
            rejectedCount: !validation.valid ? stats.rejectedCount + 1 : stats.rejectedCount,
            duplicateCount: dedup.action === 'skip_dedup' || dedup.action === 'update' ? stats.duplicateCount + 1 : stats.duplicateCount,
          };
        } else {
          // 真实写入
          if (validation.valid && dedup.action !== 'skip_dedup') {
            const brandId = await this.persistence.getBrandIdByName(normalized.normalizedBrandName);
            if (brandId) {
              productId = await this.persistence.upsertProduct(normalized, brandId);
              await this.persistence.recordPriceSnapshot(productId, normalized.currentPrice, normalized.originalPrice, 'crawler', normalized.sourceUrl);
              await this.persistence.recordSourceRecord('product', productId, config.sourceType, normalized.sourceUrl, config.parserVersion);
              stats = { ...stats, acceptedCount: stats.acceptedCount + 1 };
            } else {
              stats = recordError(stats, `品牌不存在: ${normalized.normalizedBrandName}`);
            }
          } else if (!validation.valid) {
            stats = { ...stats, rejectedCount: stats.rejectedCount + 1 };
          } else {
            stats = { ...stats, duplicateCount: stats.duplicateCount + 1 };
          }
        }

        items.push({ item: normalized, validation, dedup, productId });
      }

      stats = finishJob(stats, 'success');
    } catch (e) {
      stats = recordError(stats, (e as Error).message);
      stats = finishJob(stats, 'failed');
    }

    // 5. 保存 Job 记录
    if (!config.dryRun) {
      await this.persistence.saveJobStats(stats);
    }

    return { stats, items };
  }
}
