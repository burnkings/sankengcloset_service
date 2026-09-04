# 商品数据文件格式规范（Taobao Product Data File Spec）

> 适用：`/home/admin/all_shops_products*.json` 这类**采集端导出 → 后端导入**的数据文件。
> 导入脚本：`scripts/restore-products.ts`（覆盖式 upsert）与 `scripts/import-taobao-products.ts`。
> 校验脚本：`scripts/validate-data-file.ts`（导入前必跑）。

---

## 一、顶层结构

```json
{
  "店铺名A": [ { 商品对象 }, { 商品对象 } ],
  "店铺名B": [ { 商品对象 } ]
}
```

- key = 店铺名，必须与数据库 `brands.name` **完全一致**（含空格、符号），否则该店商品全部跳过。
- value = 该店商品数组。

---

## 二、categories 字段语义（重点）

**categories 就是三坑直接分类，与坑向字段（pit_type）同一语义，只有四个枚举值：**

| 值 | 含义 |
|---|---|
| `JK` | JK制服（格裙/水手服/衬衫等） |
| `LOLITA` | 洛丽塔（JSK/OP/花嫁/甜系/哥特等） |
| `HANFU` | 汉服/汉元素（马面/襦裙/齐胸等） |
| `OTHER` | 无法归入三坑（配饰/鞋/包/工具等） |

**格式要求：**

1. 值必须是**大写枚举**：`"categories": ["JK"]`，不要写 `["洛丽塔","配饰"]` 这种淘宝类目层级，不要写中文别名。
2. 数组只放一个值（一条商品只属于一个坑向）。**禁止** `["JK","洛丽塔"]` 多值。
3. 分类抓不到时：**写 `["OTHER"]` 或省略字段**，不要给空数组 `[]`（空数组和省略在导入时都视为 OTHER，但省略更干净）。
4. 同一个字段永远代表三坑分类，**不随商品变化语义**——这是与旧文件（92% 空 + 淘宝类目混入）最大的区别。

**推荐同时提供 `pit_type` 字段**（与 categories 同值），导入时优先级：显式 `pit_type` → `categories` 枚举 → 标题正则兜底 → OTHER。

---

## 三、字段清单

| 字段 | 必填 | 格式要求 |
|---|---|---|
| `item_id` | ✅ | 全站唯一（商品唯一标识）。重复 = 同商品采两次，导入只保留一条 |
| `title` | ✅ | 商品标题，禁止控制字符（`\x00-\x1f\x7f`） |
| `shop_name` | ✅ | 必须与 brands.name 完全一致 |
| `current_price` | ✅ | 数字或数字字符串，单位**元**（导入自动转分）。**禁止 9999 占位价**——非卖品（意向金专拍/售罄展示）写 `0` 或 null |
| `main_image` | ⭕ | 完整 URL，图片扩展名需与实际格式一致（.jpg/.jpeg/.png/.webp） |
| `product_url` | ⭕ | 完整商品链接 |
| `categories` | ⭕ | **三坑枚举数组**，见上节；抓不到就省略 |
| `pit_type` | ⭕ | 与 categories 同值的大写枚举：JK/LOLITA/HANFU/OTHER |
| `sku_checked` / `sku_failed` | ⭕ | 布尔，**不得同时为 true**（自相矛盾=检测逻辑 bug） |
| `purchase_type` | ⭕ | 不填就省略，不要给 null 占位 |
| `sizes` / `colors` | ⭕ | 数组或字符串，原样透传 |

---

## 四、导出前自检清单（采集端）

1. **item_id 去重**：同 id 同标题只保留一条（分页/多关键词重叠）。
2. **价格**：9999 占位价 → 改 0 或 null，并删除"意向金/售罄展示"页的采集。
3. **categories 打标**：按店铺+标题规则给每件商品打三坑枚举（JK/LOLITA/HANFU/OTHER），不要留空。
4. **控制字符**：店铺名/标题中 `\x00-\x1f\x7f` 全部剔除（历史出现过 `WF原创设计\x7f\x7f` 导致整店跳过）。
5. **sku 布尔**：`sku_checked && sku_failed` 同时为 true 的商品，修采集逻辑或删字段。
6. **店铺名对齐**：导出后跑一遍"店铺名 vs brands.name"差异清单，新增店铺名先建 brand 再导入。

---

## 五、导入流程

```bash
# 1. 校验（导入前必跑，失败则停止）
node --env-file=.env.production --import tsx scripts/validate-data-file.ts /home/admin/xxx.json

# 2. 覆盖导入（upsert，幂等可重跑）
node --env-file=.env.production --import tsx scripts/restore-products.ts /home/admin/xxx.json

# 3. 干跑（只统计不写库）
node --env-file=.env.production --import tsx scripts/restore-products.ts /home/admin/xxx.json --dry-run
```

---

## 六、旧文件迁移备忘

- 旧文件 categories 92% 为空、少量残留 `["洛丽塔","配饰"]` / `["JK","洛丽塔"]` 层级——**不得直接作为新格式使用**。
- 若手头只有旧格式文件：先跑 `scripts/validate-data-file.ts` 出问题清单，用标题正则重分类脚本补齐 pit_type 后再导入。
- 数据库 `products.pit_type` 是权威坑向列；`categories` 只影响导入时的推断优先级（显式字段 > 枚举 > 正则）。
