// crawler/pipelines/validator.ts — 数据校验

import type { NormalizedItem, ValidationResult, ValidationError } from '../core/types.js';
import type { Validator } from '../core/types.js';

const VALID_PIT_TYPES = ['JK', 'LOLITA', 'HANFU', 'OTHER'];
const VALID_SALE_STATUSES = ['UPCOMING', 'ON_SALE', 'PRE_ORDER', 'SOLD_OUT', 'ENDED'];

export class FieldValidator implements Validator {
  validate(item: NormalizedItem): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];

    // 必填字段
    if (!item.canonicalName) {
      errors.push({ field: 'canonicalName', code: 'REQUIRED', message: '商品名称不能为空', severity: 'error' });
    }
    if (!item.brandName) {
      warnings.push({ field: 'brandName', code: 'REQUIRED', message: '品牌名称为空', severity: 'warning' });
    }
    if (!item.pitType || !VALID_PIT_TYPES.includes(item.pitType)) {
      errors.push({ field: 'pitType', code: 'INVALID_ENUM', message: `无效的坑向: ${item.pitType}`, severity: 'error' });
    }

    // 价格
    if (item.currentPrice < 0) {
      errors.push({ field: 'currentPrice', code: 'INVALID_RANGE', message: '价格不能为负数', severity: 'error' });
    }
    if (item.currentPrice > 10_000_000) {
      warnings.push({ field: 'currentPrice', code: 'SUSPICIOUS_VALUE', message: '价格异常偏高', severity: 'warning' });
    }

    // URL
    if (item.sourceUrl && !this.isValidUrl(item.sourceUrl)) {
      errors.push({ field: 'sourceUrl', code: 'INVALID_URL', message: '来源 URL 格式无效', severity: 'error' });
    }
    if (item.coverUrl && !this.isValidUrl(item.coverUrl)) {
      warnings.push({ field: 'coverUrl', code: 'INVALID_URL', message: '封面图 URL 格式无效', severity: 'warning' });
    }

    // 枚举值
    if (item.saleStatus && !VALID_SALE_STATUSES.includes(item.saleStatus)) {
      errors.push({ field: 'saleStatus', code: 'INVALID_ENUM', message: `无效的销售状态: ${item.saleStatus}`, severity: 'error' });
    }

    // 日期关系
    if (item.sourcePublishedAt) {
      const pubDate = new Date(item.sourcePublishedAt);
      if (isNaN(pubDate.getTime())) {
        warnings.push({ field: 'sourcePublishedAt', code: 'INVALID_DATE', message: '发布时间格式无效', severity: 'warning' });
      }
    }

    // 描述长度
    if (item.description && item.description.length > 5000) {
      warnings.push({ field: 'description', code: 'TOO_LONG', message: '描述过长，可能需要截断', severity: 'warning' });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  private isValidUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return ['http:', 'https:', 'fixture:'].includes(parsed.protocol);
    } catch {
      return false;
    }
  }
}
