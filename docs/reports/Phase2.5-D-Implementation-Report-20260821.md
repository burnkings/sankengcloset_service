# Phase 2.5-D Implementation Report — import-taobao-products.ts 重构（Raw → Normalize → Product）

- 日期: 2026-08-21
- 文件: /home/admin/projects/sankengcloset_service/scripts/import-taobao-products.ts（重写，436 行 → 新增至 ~500 行）
- 状态: ✅ 代码完成 + typecheck 0 错误 + dry-run 验证通过；**等待新版 JSON 文件到位后执行真实导入**

## 1. 实现内容

### Raw 层（新）
- 每条采集商品写入 `raw_data`：
  - `parsed_json` = 完整原始对象（**未知字段全部保留**，不清洗 title/price/URL/categories/brand/style/release/purchase semantics）
  - `raw_content` = 原始 JSON 字符串
  - `source_url` = url_raw（或 fallback canonical），`content_type='application/json'`
  - `fetched_at` = 采集时间（有则用，无则 now）
  - `import_batch_id` = 关联导入批次
- **Raw 独立提交**：raw 写入优先于 Product 事务，即使 Product 因唯一约束冲突失败也不回滚 raw（Raw 保真最高优先级）
- 版本元数据（crawler_version/fetched_at）从数据文件首条提取写入 import_batches

### Normalize 层（新，纯函数，云端唯一业务解释层）
| 函数 | 职责 |
|---|---|
| `rawTitle()` | 新版 title_raw 优先，旧版 title fallback |
| `rawPrice()` | price_raw 优先，current_price fallback |
| `rawUrl()` | url_raw 优先，product_url fallback |
| `rawImages()` | images[] 优先（多图），[main_image] fallback |
| `rawShopName()` | shop_name 优先，query_shop fallback |
| `normalizeTitle()` | 剥离【意向金/定金/尾款/跳转/预售/现货/已售完/截团/清仓/特价】营销前缀；清洗后为空则保留原文（宁可不洗不丢） |
| `normalizePrice()` | **价格语义区分 FULL/DEPOSIT/BALANCE/INTENTION/UNKNOWN**（见下） |
| `canonicalUrl()` | `https://item.taobao.com/item.htm?id={item_id}` 稳定 URL |
| `inferPitType()` | 复用既有规则：显式 pit_type → 标题正则（词边界）→ categories 枚举 → OTHER |
| `inferSaleStatus()` | 售罄→SOLD_OUT / 预约预售定金→PRE_ORDER / 默认 ON_SALE |

### normalizePrice 规则（关键）
1. 标题含"意向金/1元抵/1r抵"，或 1元/9999元 且标题含"跳转" → **INTENTION**（priceCents=0，不进入普通售价）
2. 1元/9999元 无明确语义（一元拍/补差价/花絮页） → **UNKNOWN**（priceCents=0）
3. 标题含"定金" → **DEPOSIT**（deposit_price=金额）
4. 标题含"尾款" → **BALANCE**（balance_price=金额）
5. 无价格 → **UNKNOWN**
6. 其余 → **FULL**（current_price=金额，original_price=同值）

### Product 层
- `external_id` = item_id（稳定身份，唯一索引 products_platform_external_unique 已存在）
- `canonical_url` 由 item_id 生成，`source_url` 保留原始 tracking URL
- 多图：`images[]` 全量写入 + `product_images` 按 product_id 重建（反映最新 images[]，sort_order 0..n，首图 is_cover=true）
- 价格拆分：current_price/deposit_price/balance_price/original_price + price_type 全量写入
- **幂等**：
  - products：ON CONFLICT (source_platform, external_id) DO UPDATE（同 item_id 重导入=更新不重复）
  - source_records：dedup_uniq 唯一索引 + ON CONFLICT DO NOTHING（防重复追加，v2 版本标记）
  - price_snapshots：与最新快照价格一致时不重复插
  - product_images：按 product_id 重建（天然幂等）
- **import_batches**：批次统计（total/success/failed/status=running→done|failed）

## 2. 文件变更
- 修改: `scripts/import-taobao-products.ts`（重写）
- 新增: `migrations/0013_product_v2.sql`（见 Migration Report）
- 未修改: 采集端任何文件（update_shops.py / run_detect_all.py / taobao_cli.py 冻结不动）

## 3. 数据流

```
新版采集 JSON（title_raw/price_raw/url_raw/images[]/variants_raw/purchase_text_raw/
                shop_name/query_shop/shop_link/fetched_at/crawler_version/source）
  ↓ Raw（原文保真，独立提交）
raw_data（parsed_json=完整对象, raw_content=原文, import_batch_id）
  ↓ Normalize（纯函数，可重放）
标题清洗 → price_type 语义 → canonical_url → pit_type → sale_status
  ↓ Product（external_id=item_id 稳定身份）
products + product_images（多图） + price_snapshots + source_records（raw_data_id 关联）
  ↓ 批次
import_batches（统计）
```

## 4. 测试结果

### 类型检查
- `npm run typecheck`：import-taobao-products.ts **0 错误**（其余错误均为 pre-existing：postgres.ts TS2769 9 处 + community-product.test.ts 1 处，与本改动无关，未触碰）

### 单元测试（回归）
- `npm test`: **209 passed | 1 skipped**（21 files；skipped 为 integration 测试——生产库保护，TEST_DATABASE_URL 未配置自动跳过，符合预期）

### Dry-run 验证（旧文件 /home/admin/all_shops_products.json, 3247 条）
```
总数: 3247 | 有效: 3247 | 品牌: 222
分类: HANFU 1418 / JK 1040 / LOLITA 767 / OTHER 22
price_type: FULL 3035 / INTENTION 76 / DEPOSIT 54 / BALANCE 34 / UNKNOWN 48
```

### 核心业务断言（独立脚本验证，见会话记录）
| 断言 | 结果 |
|---|---|
| "意向金1元抵10元" → INTENTION 且 priceCents=0 | ✅（39 条 1元意向金全 INTENTION） |
| 一元拍/补差价/花絮页（1元非意向金）→ 不进 FULL | ✅（7 条归 UNKNOWN） |
| 9999 占位价 → 不进 FULL | ✅（45 条全 INTENTION/UNKNOWN） |
| INTENTION 商品 priceCents 全 0 | ✅（76/76） |
| 原始 price_raw="1" 保留 | ✅（存于 raw_data.parsed_json/raw_content） |
| 标题清洗剥离营销前缀 | ✅（【意向金1元抵10元】→ 空） |

## 5. 已知限制 / 风险
- **新版 JSON 未到位**：服务器尚无 title_raw 格式文件，真实导入待文件上传后执行（脚本已兼容旧版字段，旧文件亦可导入）
- products_brand_canonical_unique 冲突（同品牌同名不同 item_id）：保留已存在者并计入 products 计数（预期行为，raw 已独立保存不受影响）
- source_records 使用 parser_version='v2' 标记新导入

## 6. 下一步（待新版 JSON）
1. 用户上传新版 JSON 文件到服务器
2. `node --env-file=.env.production --import tsx scripts/import-taobao-products.ts <file> [--dry-run]` 先 dry-run
3. 正式导入（写库）
4. 生成 Import Report + Data Quality Report（验收指标：Raw 数量/Product 数量/item_id 唯一性/可追溯性/orphan/duplicate/price_type 分布/多图结构/canonical_url 正确率/Brand 数量）
