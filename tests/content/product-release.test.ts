import { describe, expect, it } from 'vitest';
import { MemoryRepository } from '../../src/repositories/memory.js';

/**
 * Phase 1.1-A：Product → currentRelease 数据通道（memory 仓库语义）。
 * memory 无 product_releases 数据源（currentRelease 恒 null），验证：
 *  - getProduct 契约稳定（字段完整、不抛错）
 *  - 无 Release 商品的 currentRelease 为 null（UI 不伪造状态的前提）
 * 首发/再贩/定金尾款场景的数据级验证依赖真实 product_releases 行，
 * 受生产库保护约束不做数据污染，由 getProduct SQL（LATERAL JOIN 最新行）+ 前端 mapCurrentRelease 代码审查证明。
 */
describe('Product → currentRelease 数据通道（memory）', () => {
  const repository = new MemoryRepository();

  it('getProduct 返回商品且 currentRelease 为 null（无 release 商品语义）', async () => {
    const product = await repository.getProduct(null, 'prd_jk_navy_45');
    expect(product).not.toBeNull();
    expect(product!.id).toBe('prd_jk_navy_45');
    expect(product!.title).toBe('深蓝格裙 45cm');
    expect(product!.currentRelease).toBeNull();
  });

  it('getProduct 对不存在的商品返回 null', async () => {
    const product = await repository.getProduct(null, 'prd_not_exist');
    expect(product).toBeNull();
  });

  it('memory fixtures 均携带 currentRelease 字段（类型契约完整）', async () => {
    const jk = await repository.getProduct(null, 'prd_jk_navy_45');
    const lolita = await repository.getProduct(null, 'prd_lolita_moon');
    const hanfu = await repository.getProduct(null, 'prd_hanfu_song');
    expect(jk!.currentRelease).toBeNull();
    expect(lolita!.currentRelease).toBeNull();
    expect(hanfu!.currentRelease).toBeNull();
  });
});
