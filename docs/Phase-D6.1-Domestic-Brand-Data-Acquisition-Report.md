# Phase D6.1 — Domestic Brand Data Acquisition Report

> 完成时间：2026-07-22
> 基于：Phase D6 First Brand Data Pilot (252 tests)

---

## 1. 为什么 D6 不能算真实国内数据验收

Phase D6 使用 fixture 数据（TuFengFeng），不是真实品牌公开数据。
- 3 个商品，无批次信息
- 无真实价格、图片、描述
- 无法验证 Product Release 模型

Phase D6.1 目标：使用真实国内品牌数据验证完整管道。

---

## 2. 国内品牌候选源评估

| 品牌 | 坑向 | 来源 | 无登录 | 无验证码 | 服务器可达 | 商品标题 | 价格 | 图片 | 批次信息 | 推荐 |
|------|------|------|--------|----------|-----------|---------|------|------|----------|------|
| With PUJI | Lolita | Blogger RSS | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ 首选 |
| 兔缝缝 | JK | 官网 | ✅ | ✅ | ❌ | ? | ? | ? | ? | ❌ 超时 |
| 星辰猫 | Lolita | 官网 | ✅ | ✅ | ❌ | ? | ? | ? | ? | ❌ 超时 |
| 猫萌哒 | JK | 官网 | ✅ | ✅ | ❌ | ? | ? | ? | ? | ❌ 超时 |
| Angelic Pretty | Lolita | 官网 | ✅ | ✅ | ❌ | ? | ? | ? | ? | ❌ 超时 |

**最终选择：With PUJI** — 唯一可达的真实 Lolita 品牌。

---

## 3. 服务器访问诊断结果

| 检查项 | 结果 |
|--------|------|
| DNS 解析 | ✅ withpuji.com 可解析 |
| HTTPS 连接 | ✅ 200 OK |
| TLS | ✅ 正常 |
| User-Agent | ✅ 无需特殊 UA |
| 地区限制 | ✅ 无限制 |
| 登录要求 | ✅ 无需登录 |
| 验证码 | ✅ 无验证码 |
| 响应格式 | ✅ RSS XML |

**建议方案**：服务器直接采集 ✅

---

## 4. Local Snapshot Import

已实现 `scripts/import-brand-snapshot.ts`：

```bash
node --import tsx scripts/import-brand-snapshot.ts \
  --file fixtures/domestic-brand/withpuji-rss.xml \
  --brand-id br_002 \
  --mode full \
  --dry-run  # 或不加 --dry-run 写入数据库
```

管道：RSS XML → Parser → Normalizer → Validator → Dedup → Persistence

---

## 5. Parser 设计

`src/crawler/parsers/withpuji-parser.ts`：

- 解析 Blogger RSS XML
- 提取：标题、图片、描述、发布日期、链接
- 检测：坑向（Lolita）、商品类型（JSK/OP/SK）
- 生成：canonical_name、cover_url、tags

**局限**：
- 无价格信息（RSS 不包含）
- 无批次/再贩信息（品牌未在博客发布）
- 仅 7 个商品

---

## 6. 导入结果

| 指标 | 数量 |
|------|------|
| 新增 product | 7 |
| 新增 release | 7 (first_release) |
| 新增 price_snapshot | 7 |
| 新增 source_record | 7 |
| 新增 crawl_job | 1 (full mode) |
| 重复 | 0 |
| 拒绝 | 0 |

**未达目标**：
- 目标 10+ product → 实际 7 ❌
- 目标 10+ release → 实际 7 ❌
- 目标 3+ release_type → 实际 1 (first_release) ❌

**原因**：With PUJI 的 Blogger RSS 仅包含 7 个商品，无批次信息。

---

## 7. 数据质量评分

| 检查项 | 结果 |
|--------|------|
| 商品名为空 | 0 ✅ |
| 品牌缺失 | 0 ✅ |
| 坑向无法识别 | 0 ✅ (全部 LOLITA) |
| 图片缺失 | 0 ✅ (RSS 有图片) |
| 价格缺失 | 7 ❌ (RSS 无价格) |
| 定金/尾款无法拆分 | 7 ❌ (无价格) |
| release_no 无法识别 | 7 ❌ (无批次信息) |
| release_type unknown | 0 ✅ (全部 first_release) |
| source_url 缺失 | 0 ✅ |
| 重复 product | 0 ✅ |
| 重复 release | 0 ✅ |

**等级**：C（核心字段完整率 70%，release 识别率 0%）

---

## 8. Directus 审核验证

| 表 | 可访问 | 数据 |
|----|--------|------|
| products | ✅ | 59 条 (50 种子 + 2 TuFengFeng + 7 With PUJI + ...) |
| product_releases | ✅ | 7 条 |
| source_records | ✅ | 61 条 |
| price_snapshots | ✅ | 61 条 |
| crawl_jobs | ✅ | 9 条 |
| brand_crawl_policies | ✅ | 1 条 |
| brands | ✅ | 30 条 |

管理员可在 Directus 中将 draft 改为 published。

---

## 9. PostgreSQL Feed API 验证

| 检查项 | 结果 |
|--------|------|
| 后端切换到 postgres 模式 | ✅ |
| Feed API 从 PostgreSQL 读取 | ✅ |
| 返回 product title/brand/price | ✅ |
| draft 商品不进入 Feed | ✅ (With PUJI 7 个 draft 未出现) |
| published 商品进入 Feed | ✅ (种子数据 50 个 published) |

**修复记录**：
- `mapProduct` 字段映射：`canonical_name` → `title`, `current_price` → `price_cents`
- `listFeed` SQL：JOIN brands 表获取 brand_name

---

## 10. 测试结果

```
npm test:     252 passed, 1 skipped (253 total)
npm typecheck: 0 errors
npm build:     success
```

---

## 11. 当前限制

1. **With PUJI 仅 7 个商品**：Blogger RSS 不包含完整产品目录
2. **无价格信息**：RSS 不包含价格
3. **无批次信息**：品牌未在博客发布批次/再贩信息
4. **仅 1 种 release_type**：first_release（无再贩/预约/现货）
5. **未达 10+ 目标**：数据源限制

---

## 12. 下一阶段建议

| 阶段 | 内容 | 优先级 |
|------|------|--------|
| D6.2 | 寻找有批次信息的品牌数据源（需人工协助获取快照） | 高 |
| D6.3 | 配置代理访问海外 Lolita 品牌（AP/BTSSB） | 中 |
| D7 | 多来源合并去重 | 中 |
| D8 | Review API JWT 认证 | 高 |
| D9 | 定时采集调度 | 高 |
