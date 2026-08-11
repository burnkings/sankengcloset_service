import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

export class LocalObjectStorage {
  private readonly root: string;

  constructor(uploadDir: string) {
    this.root = resolve(uploadDir);
  }

  private pathFor(objectKey: string): string {
    const target = resolve(this.root, objectKey);
    if (target !== this.root && !target.startsWith(`${this.root}${sep}`)) throw new Error('Invalid object key');
    return target;
  }

  async put(objectKey: string, data: Buffer): Promise<void> {
    const target = this.pathFor(objectKey);
    await mkdir(dirname(target), { recursive: true });
    // 'w'：同 uploadId 网络重试重复 PUT 幂等覆盖，不因 EEXIST 报 500
    await writeFile(target, data, { flag: 'w' });
  }

  async get(objectKey: string): Promise<Buffer> {
    return readFile(this.pathFor(objectKey));
  }

  async delete(objectKey: string): Promise<void> {
    await rm(this.pathFor(objectKey), { force: true });
  }
}
