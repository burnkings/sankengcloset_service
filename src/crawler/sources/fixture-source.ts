// crawler/sources/fixture-source.ts — 演示适配器（读取 fixture 文件）

import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FetchResult } from '../core/types.js';
import { BaseSourceAdapter } from './base.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export class FixtureSourceAdapter extends BaseSourceAdapter {
  readonly sourceType = 'FIXTURE';
  readonly name = 'Fixture Source (本地测试)';

  canHandle(url: string): boolean {
    return url.startsWith('fixture://');
  }

  protected async doFetch(url: string): Promise<FetchResult> {
    const filename = url.replace('fixture://', '');
    const filePath = resolve(__dirname, '../fixtures', filename);
    const body = await readFile(filePath, 'utf8');

    return {
      url,
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body,
      contentType: 'application/json',
      fetchedAt: new Date(),
      durationMs: 0,
    };
  }
}
