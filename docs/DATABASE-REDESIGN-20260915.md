# 数据库新基线设计（2026-09-15）

> 状态：设计稿和建表蓝图，尚未完成运行时代码适配及数据库执行验证。不能用当前 main 服务直接连接此新结构。
> 依据：前端 `5e6a32de600bc82b78aa67ef18b6d780c8c5f658`；后端 `b01980cf67e128ca66ea996764f0fca8b63fc8b3`。
> 输入：[database-schema.md](https://github.com/burnkings/sankengcloset/blob/5e6a32de600bc82b78aa67ef18b6d780c8c5f658/database-schema.md)，标注 2026-09-15、PostgreSQL 17、36 张表。行数是导出快照，不是本次线上查询。
> 用户决定：不兼容旧集合内容，以新结构为准；不建设新旧双写或数据搬运层。

## 1. 选择及范围

继续 PostgreSQL。36 张表收敛到 **26 张**，其中包含迁移记录表。减少 10 张，另将 wishlist_items 改名重建为 product_favorites。数量由接口职责决定，不以“空表”作为删除理由。

产品定位仍是商品介绍、高清图片、外店跳转、收藏和个人管理。保留现有款式、发售、价格历史、轻社区及截图识别，不新增交易订单、支付流水、库存扣减、部件报价后台、复杂投稿工作流。

个人数据继续使用 user_assets，但新版 JSON 必须有固定字段契约。该选择是复用现有实际读写模型，不是兼容旧表；不另建 wardrobe_items/purchases/reminders 与其双写。若以后有服务端大规模报表需求，再依据查询负载拆表。

Directus 的集合是数据库表的管理界面。此处 36→26 仅指导出中的应用表；任何 directus_* 系统表均不在删除范围。新版结构切换时必须重新配置 Directus 字段、关系、权限和流程；删除旧集合元数据通过 Directus 正式管理方式完成，不能直接 DROP 整个 public。

## 2. 原结构的真实问题

1. products 同时有 images、cover_url，另有 product_images；导入器同时写三处，存在多源不一致。新版只维护 product_images，封面由最小 sort_order 得到。
2. products 的多个预售日期、product_releases 的日期和 sale_events 重叠。当前 listCalendar 对批次与事件 UNION ALL，存在重复维护空间。新版 sale_events 作为日历时间源；product_releases 负责批次身份及金额。
3. user_assets 才是当前衣橱、购买、提醒等 CRUD 的主表；旧 wardrobe_items 为空。评审报告要求“加 wardrobe_items.silhouette”不等于真实 /me/wardrobe 持久化路径。
4. 上传结构中 product_variants 尚无 style_name，唯一约束还是 product+color+size；最新仓库已有 0016/0017 修正。只能判断导出与代码不一致，不能仅凭文档断言线上迁移一定未执行。
5. purchaseSchema 同时接受 totalCents/totalAmount、paymentStatus/status、deadline/balanceDueDate。前端 toRemotePayload 仍双写金额。新版彻底停止双写，选择一组规范字段。
6. WAIT_PRICE 的前端含义实际是“等待尾款”，不是等待降价。新版改 WAIT_BALANCE；收藏本身不再作为待购状态 WISH。
7. styles、price_snapshots、sale_events、review_records 虽然没有行，仍有真实服务查询，不能直接 DROP 而不适配。
8. applySyncBatch 目前只记录回执，不修改资产。前端 local-sync-queue 已明确绕开它并重放真实 CRUD；不能把记录 accepted 当成完成业务同步。
9. 社区举报目前仅写本地 PENDING_MOCK_REVIEW；新版可复用 feedback_records 关联目标，但仍需要前后端接口接入，不能宣称已贯通。

## 3. 删除、合并及更名清单

| 旧表 | 决定 | 替代职责与代码条件 |
|---|---|---|
| crawl_jobs | 删除 | 已取消服务器采集；同时停用调度器与相关管理入口。 |
| crawl_records | 删除 | 不再记录逐 URL 抓取结果。 |
| brand_crawl_policies | 删除 | 不再维护抓取频率、回填及优先级。 |
| source_records | 删除 | 来源平台、商品 ID、外链放 products；导入来源放 import_batches。 |
| raw_data | 删除 | 导入原件存对象文件，批次记录键与摘要；不再将 HTML、HTTP 头存库。 |
| product_tags | 合并后不建 | 标签按维度放 products 的 text[]；同步修改筛选、导入与统计。 |
| tags | 合并后不建 | 不需要独立标签运营实体，搜索别名仍由 aliases 承担。 |
| wardrobe_items | 删除 | 当前 /me/wardrobe 使用 user_assets；旧表不能成为第二份衣橱。 |
| ai_import_suggestions | 合并后不建 | 与任务一对一，字段并入 ai_import_tasks。 |
| ai_import_confirmations | 合并后不建 | 当前一个任务只确认一次，并入 ai_import_tasks，保留确认幂等唯一约束。 |
| wishlist_items | 改名并重建 | 替换为 product_favorites；不把手写心愿混入。 |

上述“合并”指新版结构直接收纳职责，不要求迁移旧数据。其余 25 个原表名在新版保留，但字段可能重建。不要把“原表名保留”理解为旧版兼容。

## 4. 26 张表的边界

| 表 | 职责 |
|---|---|
| users | 应用账号；与 Directus 管理员账号分离 |
| user_identities | 登录身份绑定 |
| user_sessions | 刷新令牌会话 |
| user_settings | 偏好与预算；关注品牌只存 brand_followers |
| brands | 品牌目录，不以店铺名自动创建品牌 |
| aliases | 搜索同义词，不另建分类字典层 |
| styles | 跨商品链接的同款归组；不是衣橱 style 或 variant.style_name |
| import_batches | Excel/JSON 导入结果；不保存抓取流水 |
| products | 商品介绍主表；一个来源商品链接一个 ID |
| product_images | 商品图片唯一数据源；封面取最小 sort_order |
| product_releases | 同一商品的不同发售批次，保存批次参考金额 |
| product_variants | 仅展示已确认的款式/颜色/尺码记录，不承担库存交易 |
| sale_events | 日历时间唯一数据源，关联可选发售批次 |
| price_snapshots | 同口径历史报价；支撑趋势，不因取消爬虫而删除 |
| product_favorites | 替代 wishlist_items；商品收藏及待购意向 |
| brand_followers | 唯一品牌关注数据源 |
| user_assets | 个人衣橱/购买/提醒/手写心愿/通知的唯一存储 |
| media_objects | 用户上传图片，不重复承载外站商品图片 |
| community_posts | 轻社区动态；当前接口一帖一图 |
| community_post_likes | 点赞关系；不等同收藏 |
| user_events | 互动统计事件；不用于同步本地浏览历史 |
| sync_operations | 幂等回执；成功须代表业务写入已提交 |
| feedback_records | 反馈及举报共用，避免重复后台 |
| ai_import_tasks | 合并建议和确认记录；一任务一次识别结果与确认 |
| review_records | 发布审计仍有实际后台接口 |
| schema_migrations | 仅记录新基线及后续实际执行过的迁移 |

特别区分：styles 是跨链接同款；product_variants.style_name 是 JSK/OP 等可展示款式；user_assets(wardrobe).style 是个人衣物部件，silhouette 是汉服形制。三者不能因为名字类似合为一列。

## 5. 类型、单位及空值规则

- 主键沿用 text 业务 ID；用户所有权取认证身份，禁止由请求 payload 覆盖。
- 所有传输、存储金额采用整数分，统一以 Cents 结尾；DB 对应 snake_case。前端仅输入输出格式化为元。
- 公开报价未知为 NULL，价格类型 UNKNOWN，不用 0 冒充免费。前端展示“价格待确认”；未核实的 1 元意向金不能作为全款进入价格筛选。
- 确认的绝对时间使用 timestamptz。个人购买日期/提醒日期使用 YYYY-MM-DD，时间 HH:mm；提醒同时记录 IANA timeZone，默认 Asia/Shanghai。不能按服务器 UTC 午夜替代用户日期。
- JSON 中可选关联 ID 用 null；DB 关系列也用 NULL。展示文字无内容允许空串。PATCH：缺失键不改，显式 null 清空可空字段，禁止默认值覆盖未提交字段。
- published 且未软删除才进入公开 Feed、搜索、榜单和日历。隐藏与删除不等价。
- 不保留 confidence/data_status/review_status 多套发布判断；公开对象统一 visibility_status，操作留 review_records。
- 各表 updated_at 由写入代码设置；DDL 默认 now() 不会自动更新它。
- 主表软删除，不级联抹掉个人购买记录。硬删除关联商品须由显式清理流程解除相关引用；不将商品内容重建自动扩散为用户资产删除。

## 6. user_assets 的新版 JSON 字段契约

公共 id/userId/version/createdAt/updatedAt/deletedAt 由外层管理，不放 payload。以下为唯一新契约，不同时接受旧别名。JSONB 本身只做对象约束；业务键、类型、金额、枚举和关联归属由路由与领域服务共同校验，Directus 禁止绕过该校验直接编辑用户资产。

### wardrobe

| 字段 | 类型/默认 | 注释 |
|---|---|---|
| name | string，必填 | 衣物名称 |
| category | JK/LOLITA/HANFU/OTHER，必填 | 坑向 |
| style | string，"" | 部件/衣型 |
| silhouette | string，"" | 形制，与 style 并列；非 HANFU 必须为空 |
| brand / color / size | string，"" | 用户记录的品牌、颜色、尺码 |
| wearStatus | UNWORN/WORN/FREQUENT/IDLE，UNWORN | 穿着状态，保留常穿 |
| seasons / images / tags | string[]，[] | 季节、图片、标签 |
| purchaseDate | YYYY-MM-DD 或 null | 购入日期 |
| purchasePriceCents | integer ≥0 或 null | 原 purchasePrice（元）改为整数分；输入端乘 100 一次 |
| purchaseSource | string，"" | 用户记录的来源 |
| purchaseId / wishId | string 或 null | 同用户的购买/心愿关联 |
| note / isFavorite | string "" / boolean false | 个人备注与衣橱标记 |

### purchase

| 字段 | 类型/默认 | 注释 |
|---|---|---|
| name | string，必填 | 外部购买记录名称，不是平台交易订单 |
| category | JK/LOLITA/HANFU/OTHER | 坑向 |
| brand | string，"" | 个人品牌快照，不跟随公共品牌自动改 |
| totalCents / depositCents / paidCents | integer ≥0，0 | 唯一金额写入字段 |
| remainingCents | 只读派生 | max(totalCents-paidCents,0)，不接受客户端写入 |
| paymentStatus | PRE_ORDER/DEPOSIT_PAID/BALANCE_PENDING/COMPLETED/CANCELLED | 唯一购买进度；删除 status 别名 |
| purchaseDate | YYYY-MM-DD 或 null | 记录归属日期 |
| balanceDueDate / arrivalDate | YYYY-MM-DD 或 null | 尾款截止、预计到货；删除 deadline 别名 |
| orderNumber | string，"" | 截图识别的外部订单号 |
| mediaId | string 或 null | 当前用户订单截图，响应按上传权限读取 |
| wishId / wardrobeId / productId / releaseId | string 或 null | 关联对象，必须校验存在与归属；批次必须属于商品 |
| note / isFavorite | string "" / boolean false | 个人备注与标记 |

删除 shopName 输入/存储，符合购买编辑页移除“店铺/团长”的要求；公共商品 shop_name 仍用于商品介绍。删除所有 *Amount、status、deadline 双写字段；OCR 原始识别结果可留在任务建议 JSON，不作为购买记录第二套字段。

totalCents ≥ paidCents、depositCents ≤ totalCents；COMPLETED 必须 paidCents=totalCents，取消订单不表示已退款。已付金额不是“尚未取消订单总价”；消费统计不得把取消的实付自动抹掉。当前没有退款模型，不显示净消费或退款完成。

只有未完成、未取消且 remainingCents>0 的购买可设置 BALANCE 提醒；新建提醒时服务端复验，避免旧页面绕过。完成/取消后关闭相关待执行 BALANCE 提醒，但不改用户独立创建的非尾款提醒。截止日期清空时明确取消尾款时间安排，不保留旧值。

### reminder

| 字段 | 类型/默认 | 注释 |
|---|---|---|
| title | string，必填 | 提醒标题 |
| type | ARRIVAL/BALANCE/RELEASE/OUTFIT/PHOTO/ORGANIZE/WISH/CHECKIN/CUSTOM | 当前 API 支持的类型 |
| remindDate | YYYY-MM-DD，必填 | 用户当地日期 |
| remindTime | HH:mm 或 null | 非全天提醒必填 |
| timeZone | string，Asia/Shanghai | IANA 时区 |
| isAllDay | boolean，false | 全天提醒；为 true 时 remindTime=null |
| relatedPurchaseId / relatedWishId / productId / relatedReleaseId | string 或 null | 关联对象；同用户及批次归属校验 |
| wardrobeBindings | string[]，[] | 同用户衣物 ID |
| note | string，"" | 个人说明 |
| status | PENDING/DONE/MISSED/CANCELLED | 新增取消，不能把关闭提醒记为已完成 |

展示过期可根据 PENDING+时间派生；MISSED 保留业务语义。DONE/CANCELLED 不进入待提醒扫描。购买删除在一个事务内关闭关联待执行提醒，不删除所有类型的提醒历史。

### wish

| 字段 | 类型/默认 | 注释 |
|---|---|---|
| name | string，必填 | 手写心愿名称 |
| coverImage / brand | string，"" | 图片与品牌说明 |
| estimatedPriceCents | integer ≥0 或 null | 唯一估价字段，原 estimatedPrice 的前端格式化需统一 |
| priority | HIGH/MEDIUM/LOW，MEDIUM | 优先级 |
| status | WISH/WATCHING/DECIDED/PURCHASED/PAUSED/CANCELED | 手写心愿状态，独立于商品收藏 |
| source | MANUAL/AI_IMPORT/DISCOVERY | 来源 |
| wardrobeId / purchaseId | string 或 null | 同用户关联 |
| convertedAt | ISO timestamp 或 null | 转换时间 |
| note / url | string，"" | 说明/外链 |
| isFavorite | boolean，false | 手写心愿个人标记 |

### notification

type、title、body、actionTarget、read 沿用语义；新增 dedupeKey（服务端生成）用于生成幂等。ID 可以由 userId+dedupeKey 稳定生成并依赖 user_assets 主键去重。客户端只能修改 read 或删除自己的通知，不允许任意创建“系统通知”。不把固定 UI 图标、标签颜色写进通知表。

### settings

- budget：monthlyLimitCents（整数分 ≥0）、alertPercent（1..100）。不再接受无单位 monthlyLimit。
- preferences：pitTypes、priceRange、themeMode；删除 followedBrands 重复存储，关注只读 brand_followers。价格区间采用稳定枚举，由前后端共享含义。
- 屏蔽品牌、屏蔽动态及浏览历史目前是本地功能，本轮不擅自增加跨端同步表。
- 消费日志从购买记录派生。由于当前只有累计 paidCents 和 purchaseDate，只能准确称“按购买日期归属的累计已付”；不能宣称精确的每月实际付款流水。若产品坚持按定金/尾款实际支付月份统计，再单独立项 payment_entries，此稿不预先新增交易式流水表。

## 7. 商品与统计规则

- products.price_cents 是商品参考报价，不混同某批次定金；指定 releaseId 时，详情批次区读 product_releases。
- 批次原 startAt/endAt/balanceDueAt/shipAt 由该批次 sale_events 生成：reservation/deposit/release 对应开始与截止，FINAL_PAYMENT 对应尾款截止，SHIP 对应明确发货日期。同类型多个阶段时按时间排序选择当前或下一阶段，不无条件取最新一行。
- 未确认年份的发货时间仅保存 shipping_note/description，不生成 SHIP 事件。
- calendar 只查询 sale_events 并 JOIN 可见商品/批次，不再 UNION 批次重复记录。返回 eventId 与 releaseId 分开，跳商品详情只传 productId 和真实 releaseId。
- isRerelease 从 release_type='rerelease' 派生；isSoldOut 从 sale_status 派生；lifecycleStatus 按已确认事件与状态生成，删除独立互相矛盾的存储列。
- 封面和 images 响应均由 product_images 生成。单表 Excel 第一张图排序为 0，不再写 products.images/cover_url。
- 收藏数 COUNT(product_favorites)；点赞数 COUNT(community_post_likes)；品牌关注数 COUNT(brand_followers)。默认不保存易漂移的平行计数列。
- viewCount 是 VIEW_PRODUCT 事件次数，显示“次浏览”，不是独立人数。热榜若仍按 feed_score 排，需说明是热度分排序，不能伪称按浏览数排序。
- 品牌均价只统计已发布且 price_type=FULL、金额已知的商品，每个商品一票；先聚合商品再连接多批次，避免重复加权。
- 降价只比较同商品、同批次、同币种、同价格类型的历史；没有可比较历史返回 null/unknown，不能用零当作旧价，也不能将不同商品均价变化说成同商品降价。
- product_variants 不生成颜色×尺码笛卡尔积；仅有独立款式、颜色、尺码词表时，仍可放说明和标签供展示，不能伪造 SKU。新品不默认 IN_STOCK。
- 商品唯一性按来源 ID / 规范链接，不按品牌+名称；同名不同来源商品可并存，同款由 styles 关联。

## 8. 代码改动与接口对照（尚待实施）

| 范围 | 必须同步修改 |
|---|---|
| 后端 src/repositories/postgres.ts | products 列更名、图片聚合、日历改单源、favorites 改表、AI 三表查询改单表、趋势口径及发布过滤、品牌派生统计 |
| 后端 src/routes/user-data.ts | 使用第 6 节唯一字段；拒绝旧字段；PATCH 去默认覆盖；剩余金额派生、关联用户校验、提醒取消与订单状态联动 |
| 后端 src/routes/interaction.ts | 收藏只传有效 productId/releaseId，intentStatus 取代 WISH/WAIT_PRICE 旧枚举，品牌只接受 ID |
| 后端 src/routes/calendar.ts 和 contracts.ts | 日历独立 eventId/releaseId；公开 DTO 的 null/未知约定 |
| 后端 src/routes/review.ts | 新 title/category/price_cents；去 review_status；商品状态变更和 review_records 写入同一事务 |
| 后端 src/catalog/import-products.ts | 用新列，图片单源；保留整批事务，写 import_batches；失败状态在回滚后单独记录 |
| 后端 src/services/ai-import.ts 及 AI 路由 | 建议和确认入任务；confirm 幂等 opId 唯一冲突须明确报错，不能返回另一任务成功 |
| 后端抓取脚本、任务及 contracts-crawler | 移除已取消采集路径与旧表引用；不能保留启动时自动调度 |
| 前端 purchase-store/repo/domain/edit/import | 停止 *Amount 双写、readCents 旧值回退；统一 balanceDueDate；删除 shopName；剩余金额只读 |
| 前端 wardrobe/wish/budget | 元只用于 UI，接口均 *Cents；silhouette/wearStatus 完整保存，远端拉取后可继续编辑 |
| 前端 favorite-store/user-data-service/队列 | intentStatus 可空，WAIT_BALANCE；商品收藏仍走已有功能入口，API 路径无需因 DB 改名而改名 |
| 前端 product/feed/ranking/brand/calendar/style services | DTO 单源映射；未知价格和统计不显示 0；保留已在用的同款接口 |
| 前端社区举报 | local mock 提交改走真实反馈接口并携带目标；本地演示模式保持隔离 |
| sync_operations | 若保留批量写接口，业务写与回执同事务；当前前端继续真实 CRUD 重放，不能只靠 accepted 清队列 |
| Directus | 清旧应用集合配置；重建关系、字段展示与权限；不改系统集合 |

DB 更名不要求 URL 更名。例如现有 /api/v1/wishlist 可继续作为商品收藏路由，但只接受新版 payload；这不是兼容旧集合。前后端应一次同步发布，旧客户端写入明确拒绝，不静默丢弃字段。

## 9. 索引与约束

详见同目录外的 [建表蓝图](../database/blueprints/next-schema.sql)。索引围绕 Feed、品牌、同款、日历、价格历史、用户资产和互动查找；不对每个 JSON 键添加索引，也不引入分区或向量库。

关系表采用唯一键保证重复收藏、关注、点赞幂等。favorites/release 与 sale_events/release 使用复合外键，确保批次属于商品。个人 JSON 中的跨类型关联由领域服务按 userId+assetType+id 校验；不宣称 JSON 字符串具备数据库外键保护。

user_assets 更新采用 WHERE version=expectedVersion 并 version+1；冲突返回 409。建立关系、转换心愿/购买/衣橱以及提醒联动必须在同一事务内完成。媒体操作必须校验所有权和已上传状态。

## 10. 新基线切换与验证

1. 在独立空数据库验证 blueprint；本文件不作为当前 migrations 的下一号 SQL 自动运行。
2. 完成第 8 节全部消费者适配，前后端统一新 DTO；不建设迁移旧数据、兼容视图或双写层。
3. 先通过新库上的真实路由和仓储测试，再重新导入新版商品数据及需要保留的品牌资料。用户允许覆盖旧集合不意味着必须无故丢弃 252 条品牌资料；可作为新的标准输入重新导入，不要求旧表兼容。
4. 停写后切换数据库连接，同时更新应用与 Directus 配置。旧库不再作为运行依赖；清除旧集合需在切换成功后操作。
5. 迁移记录只记录实际执行的新基线，不能伪造 0001—0017 已执行；原 migrations 不得再对新库重放。
6. 本轮没有线上连接或执行环境，未执行该脚本、类型检查、HBuilderX 编译或集成测试；不得把文件生成检查说成数据库验收。

最低验收：空库建表/约束；11 列 Excel 导入与重复导入；Feed/详情/品牌/同款/日历/榜单/搜索；匿名/登录边界；收藏并发/取消/重试；衣橱新设备编辑；购买创建→尾款提醒→支付完成→关闭尾款提醒→入橱；预算单位；OCR 上传→识别→确认幂等；发帖/点赞/反馈；账号隔离；批次错配拒绝；PATCH 未提交字段保留；真实空数据不回退 mock。

## 11. 完整字段字典

以下与 next-schema.sql 同源生成。SQL 为数据库结构约束，业务状态机和 JSON schema 仍需要第 8 节代码实现。

### users

应用账号；与 Directus 管理员账号分离

| 字段 | SQL 类型、默认及约束 | 注释 |
|---|---|---|
| id | text PRIMARY KEY | 业务 ID，由服务端生成；允许前端提交幂等 ID |
| nickname | text NOT NULL | 昵称 |
| avatar_url | text NOT NULL DEFAULT '' | 头像地址 |
| status | text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')) | 账号状态 |
| created_at | timestamptz NOT NULL DEFAULT now() | 创建时间 |
| updated_at | timestamptz NOT NULL DEFAULT now() | 修改时间 |



### user_identities

登录身份绑定

| 字段 | SQL 类型、默认及约束 | 注释 |
|---|---|---|
| user_id | text NOT NULL REFERENCES users(id) | 所属用户 |
| provider | text NOT NULL | 登录提供方 |
| provider_subject | text NOT NULL | 提供方唯一用户标识 |
| created_at | timestamptz NOT NULL DEFAULT now() | 创建时间 |

表级约束：`PRIMARY KEY(provider,provider_subject)`

### user_sessions

刷新令牌会话

| 字段 | SQL 类型、默认及约束 | 注释 |
|---|---|---|
| id | text PRIMARY KEY | 业务 ID，由服务端生成；允许前端提交幂等 ID |
| user_id | text NOT NULL REFERENCES users(id) | 所属用户 |
| refresh_token_hash | text NOT NULL UNIQUE | 只存令牌哈希 |
| device_id | text NOT NULL DEFAULT '' | 设备标识 |
| platform | text NOT NULL DEFAULT '' | 客户端平台 |
| expires_at | timestamptz NOT NULL | 过期时间 |
| revoked_at | timestamptz | 撤销时间 |
| created_at | timestamptz NOT NULL DEFAULT now() | 创建时间 |
| last_used_at | timestamptz NOT NULL DEFAULT now() | 最近使用时间 |



### user_settings

偏好与预算；关注品牌只存 brand_followers

| 字段 | SQL 类型、默认及约束 | 注释 |
|---|---|---|
| user_id | text NOT NULL REFERENCES users(id) | 所属用户 |
| setting_key | text NOT NULL CHECK (setting_key IN ('budget','preferences')) | 设置类型 |
| payload_json | jsonb NOT NULL CHECK (jsonb_typeof(payload_json)='object') | 按设置类型校验的 JSON 对象 |
| updated_at | timestamptz NOT NULL DEFAULT now() | 修改时间 |

表级约束：`PRIMARY KEY(user_id,setting_key)`

### brands

品牌目录，不以店铺名自动创建品牌

| 字段 | SQL 类型、默认及约束 | 注释 |
|---|---|---|
| id | text PRIMARY KEY | 业务 ID，由服务端生成；允许前端提交幂等 ID |
| name | text NOT NULL CHECK (length(btrim(name))>0) | 品牌名称 |
| name_en | text NOT NULL DEFAULT '' | 英文名称 |
| category | text NOT NULL CHECK (category IN ('JK','LOLITA','HANFU','OTHER')) | 坑向 |
| logo_url | text NOT NULL DEFAULT '' | 品牌图 |
| description | text NOT NULL DEFAULT '' | 介绍 |
| official_url | text NOT NULL DEFAULT '' | 官方外链 |
| source_url | text NOT NULL DEFAULT '' | 资料出处 |
| popular_series | text[] NOT NULL DEFAULT '{}' | 展示用系列名称，不承担关联 ID |
| brand_status | text NOT NULL DEFAULT 'active' CHECK (brand_status IN ('active','inactive')) | 品牌状态 |
| created_at | timestamptz NOT NULL DEFAULT now() | 创建时间 |
| updated_at | timestamptz NOT NULL DEFAULT now() | 修改时间 |
| deleted_at | timestamptz | 软删除时间 |



### aliases

搜索同义词，不另建分类字典层

| 字段 | SQL 类型、默认及约束 | 注释 |
|---|---|---|
| id | text PRIMARY KEY | 业务 ID，由服务端生成；允许前端提交幂等 ID |
| term | text NOT NULL | 用户搜索词 |
| canonical_term | text NOT NULL | 规范搜索词 |
| alias_type | text NOT NULL CHECK (alias_type IN ('category','brand','style')) | 别名类型 |
| status | text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')) | 是否参与搜索 |
| created_at | timestamptz NOT NULL DEFAULT now() | 创建时间 |
| updated_at | timestamptz NOT NULL DEFAULT now() | 修改时间 |

表级约束：`UNIQUE(term,alias_type)`

### styles

跨商品链接的同款归组；不是衣橱 style 或 variant.style_name

| 字段 | SQL 类型、默认及约束 | 注释 |
|---|---|---|
| id | text PRIMARY KEY | 业务 ID，由服务端生成；允许前端提交幂等 ID |
| brand_id | text REFERENCES brands(id) | 品牌，可未知 |
| canonical_name | text NOT NULL | 同款名称 |
| category | text NOT NULL CHECK (category IN ('JK','LOLITA','HANFU','OTHER')) | 坑向 |
| sub_category | text NOT NULL DEFAULT '' | 分类 |
| style_tags | text[] NOT NULL DEFAULT '{}' | 风格词 |
| description | text NOT NULL DEFAULT '' | 同款说明 |
| created_at | timestamptz NOT NULL DEFAULT now() | 创建时间 |
| updated_at | timestamptz NOT NULL DEFAULT now() | 修改时间 |
| deleted_at | timestamptz | 软删除时间 |



### import_batches

Excel/JSON 导入结果；不保存抓取流水

| 字段 | SQL 类型、默认及约束 | 注释 |
|---|---|---|
| id | text PRIMARY KEY | 业务 ID，由服务端生成；允许前端提交幂等 ID |
| source | text NOT NULL CHECK (source IN ('excel','json','manual')) | 输入方式 |
| file_name | text NOT NULL DEFAULT '' | 原文件名称 |
| file_hash | text NOT NULL DEFAULT '' | 输入文件摘要 |
| source_object_key | text | 输入原件存储键，不内嵌大文件 |
| operator_user_id | text REFERENCES users(id) | 操作人，系统导入可空 |
| total_records | integer NOT NULL DEFAULT 0 CHECK (total_records>=0) | 总行数 |
| success_records | integer NOT NULL DEFAULT 0 CHECK (success_records>=0) | 成功行数 |
| failed_records | integer NOT NULL DEFAULT 0 CHECK (failed_records>=0) | 失败行数 |
| status | text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','succeeded','failed')) | 整批事务结果 |
| errors_json | jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(errors_json)='array') | 行号与错误说明 |
| created_at | timestamptz NOT NULL DEFAULT now() | 创建时间 |
| finished_at | timestamptz | 完成时间 |



### products

商品介绍主表；一个来源商品链接一个 ID

| 字段 | SQL 类型、默认及约束 | 注释 |
|---|---|---|
| id | text PRIMARY KEY | 业务 ID，由服务端生成；允许前端提交幂等 ID |
| title | text NOT NULL CHECK(length(btrim(title))>0) | 唯一正式名称，替代 canonical_name/display_name |
| brand_id | text REFERENCES brands(id) | 品牌，可未知 |
| shop_name | text NOT NULL DEFAULT '' | 店铺展示名 |
| category | text NOT NULL CHECK(category IN ('JK','LOLITA','HANFU','OTHER')) | 坑向 |
| sub_category | text NOT NULL DEFAULT '' | 商品分类 |
| style_id | text REFERENCES styles(id) | 同款归组 |
| description | text NOT NULL DEFAULT '' | 商品说明，允许部件价格/尺码/不确定时间原文 |
| sale_status | text NOT NULL DEFAULT 'UNKNOWN' CHECK(sale_status IN ('UPCOMING','ON_SALE','PRE_ORDER','SOLD_OUT','ENDED','UNKNOWN')) | 当前人工确认状态 |
| price_cents | integer CHECK(price_cents>=0) | 商品层参考报价；未知 NULL |
| price_type | text NOT NULL DEFAULT 'UNKNOWN' CHECK(price_type IN ('FULL','DEPOSIT','BALANCE','INTENTION','UNKNOWN')) | 报价含义 |
| original_price_cents | integer CHECK(original_price_cents>=0) | 核实的原价；不是现货价 |
| currency | text NOT NULL DEFAULT 'CNY' | 币种 |
| source_platform | text NOT NULL | 来源平台代码 |
| external_id | text | 来源商品 ID；无则 NULL |
| canonical_url | text NOT NULL | 清除追踪参数后的商品外链 |
| color_tags | text[] NOT NULL DEFAULT '{}' | 颜色信息，不推断 SKU 组合 |
| material_tags | text[] NOT NULL DEFAULT '{}' | 材质 |
| style_tags | text[] NOT NULL DEFAULT '{}' | 风格；原 tags/product_tags 汇入此或相应标签数组 |
| season_tags | text[] NOT NULL DEFAULT '{}' | 季节 |
| scene_tags | text[] NOT NULL DEFAULT '{}' | 场景 |
| element_tags | text[] NOT NULL DEFAULT '{}' | 元素 |
| recommended_tags | text[] NOT NULL DEFAULT '{}' | 运营标签 |
| feed_score | integer NOT NULL DEFAULT 0 | 推荐排序分，不冒充浏览数 |
| visibility_status | text NOT NULL DEFAULT 'draft' CHECK(visibility_status IN ('draft','reviewing','published','hidden')) | 唯一发布状态 |
| import_batch_id | text REFERENCES import_batches(id) | 最近一次成功导入批次 |
| version | bigint NOT NULL DEFAULT 1 CHECK(version>0) | 修改版本 |
| created_at | timestamptz NOT NULL DEFAULT now() | 创建时间 |
| updated_at | timestamptz NOT NULL DEFAULT now() | 修改时间 |
| deleted_at | timestamptz | 软删除时间 |



### product_images

商品图片唯一数据源；封面取最小 sort_order

| 字段 | SQL 类型、默认及约束 | 注释 |
|---|---|---|
| id | text PRIMARY KEY | 业务 ID，由服务端生成；允许前端提交幂等 ID |
| product_id | text NOT NULL REFERENCES products(id) ON DELETE CASCADE | 所属商品 |
| url | text NOT NULL | 图片地址 |
| object_key | text | 自有图片对象键，可空 |
| width | integer CHECK(width>0) | 已知宽度 |
| height | integer CHECK(height>0) | 已知高度 |
| sort_order | integer NOT NULL CHECK(sort_order>=0) | 顺序，最小值为封面 |
| created_at | timestamptz NOT NULL DEFAULT now() | 创建时间 |

表级约束：`UNIQUE(product_id,sort_order)`；`UNIQUE(product_id,url)`

### product_releases

同一商品的不同发售批次，保存批次参考金额

| 字段 | SQL 类型、默认及约束 | 注释 |
|---|---|---|
| id | text PRIMARY KEY | 业务 ID，由服务端生成；允许前端提交幂等 ID |
| product_id | text NOT NULL REFERENCES products(id) | 商品 |
| release_name | text NOT NULL DEFAULT '' | 批次名称 |
| release_no | integer NOT NULL CHECK(release_no>0) | 商品内批次序号 |
| release_type | text NOT NULL DEFAULT 'unknown' CHECK(release_type IN ('first_release','rerelease','reservation','spot','lottery','unknown')) | 批次类型 |
| sale_status | text NOT NULL DEFAULT 'UNKNOWN' CHECK(sale_status IN ('UPCOMING','ON_SALE','PRE_ORDER','SOLD_OUT','ENDED','UNKNOWN')) | 该批次状态 |
| deposit_cents | integer CHECK(deposit_cents>=0) | 核实的批次定金 |
| balance_cents | integer CHECK(balance_cents>=0) | 核实的批次尾款 |
| full_price_cents | integer CHECK(full_price_cents>=0) | 核实的批次全价 |
| shipping_note | text NOT NULL DEFAULT '' | 不确定的发货说明原文 |
| source_url | text NOT NULL DEFAULT '' | 批次资料来源 |
| visibility_status | text NOT NULL DEFAULT 'draft' CHECK(visibility_status IN ('draft','reviewing','published','hidden')) | 批次发布状态 |
| created_at | timestamptz NOT NULL DEFAULT now() | 创建时间 |
| updated_at | timestamptz NOT NULL DEFAULT now() | 修改时间 |
| deleted_at | timestamptz | 软删除时间 |

表级约束：`UNIQUE(id,product_id)`；`UNIQUE(product_id,release_no)`

### product_variants

仅展示已确认的款式/颜色/尺码记录，不承担库存交易

| 字段 | SQL 类型、默认及约束 | 注释 |
|---|---|---|
| id | text PRIMARY KEY | 业务 ID，由服务端生成；允许前端提交幂等 ID |
| product_id | text NOT NULL REFERENCES products(id) ON DELETE CASCADE | 商品 |
| name | text NOT NULL DEFAULT '' | 规格展示名 |
| style_name | text NOT NULL DEFAULT '' | JSK/OP 等款式 |
| color | text NOT NULL DEFAULT '' | 颜色 |
| size | text NOT NULL DEFAULT '' | 尺码 |
| price_cents | integer CHECK(price_cents>=0) | 该规格参考全价，未核实 NULL |
| stock_status | text NOT NULL DEFAULT 'UNKNOWN' CHECK(stock_status IN ('UNKNOWN','IN_STOCK','OUT_OF_STOCK')) | 仅已核实状态，不默认有货 |
| created_at | timestamptz NOT NULL DEFAULT now() | 创建时间 |
| updated_at | timestamptz NOT NULL DEFAULT now() | 修改时间 |

表级约束：`UNIQUE(product_id,style_name,color,size)`

### sale_events

日历时间唯一数据源，关联可选发售批次

| 字段 | SQL 类型、默认及约束 | 注释 |
|---|---|---|
| id | text PRIMARY KEY | 业务 ID，由服务端生成；允许前端提交幂等 ID |
| product_id | text NOT NULL REFERENCES products(id) | 商品 |
| release_id | text | 所属批次，可空 |
| event_type | text NOT NULL CHECK(event_type IN ('PREVIEW','RESERVATION','DEPOSIT','FINAL_PAYMENT','RELEASE','RESTOCK','PRICE_DROP','SHIP')) | 日历节点；SHIP 为明确发货节点 |
| title | text NOT NULL DEFAULT '' | 展示标题 |
| description | text NOT NULL DEFAULT '' | 节点说明 |
| start_at | timestamptz NOT NULL | 已确认的开始时间 |
| end_at | timestamptz | 结束时间 |
| status | text NOT NULL DEFAULT 'UPCOMING' CHECK(status IN ('UPCOMING','ACTIVE','ENDED','CANCELLED')) | 事件状态 |
| source_url | text NOT NULL DEFAULT '' | 出处 |
| created_at | timestamptz NOT NULL DEFAULT now() | 创建时间 |
| updated_at | timestamptz NOT NULL DEFAULT now() | 修改时间 |
| deleted_at | timestamptz | 软删除时间 |

表级约束：`FOREIGN KEY(release_id,product_id) REFERENCES product_releases(id,product_id)`；`CHECK(end_at IS NULL OR end_at>=start_at)`

### price_snapshots

同口径历史报价；支撑趋势，不因取消爬虫而删除

| 字段 | SQL 类型、默认及约束 | 注释 |
|---|---|---|
| id | text PRIMARY KEY | 业务 ID，由服务端生成；允许前端提交幂等 ID |
| product_id | text NOT NULL REFERENCES products(id) | 商品 |
| release_id | text | 批次，可空 |
| price_cents | integer NOT NULL CHECK(price_cents>=0) | 核实金额 |
| price_type | text NOT NULL CHECK(price_type IN ('FULL','DEPOSIT','BALANCE','INTENTION')) | 可比较报价类型 |
| currency | text NOT NULL DEFAULT 'CNY' | 币种 |
| source_url | text NOT NULL DEFAULT '' | 出处 |
| recorded_at | timestamptz NOT NULL DEFAULT now() | 记录时间 |

表级约束：`FOREIGN KEY(release_id,product_id) REFERENCES product_releases(id,product_id)`

### product_favorites

替代 wishlist_items；商品收藏及待购意向

| 字段 | SQL 类型、默认及约束 | 注释 |
|---|---|---|
| id | text PRIMARY KEY | 业务 ID，由服务端生成；允许前端提交幂等 ID |
| user_id | text NOT NULL REFERENCES users(id) | 所属用户 |
| product_id | text NOT NULL REFERENCES products(id) | 被收藏商品，禁止空关联 |
| release_id | text | 关注批次，可空 |
| intent_status | text CHECK(intent_status IN ('WANT','WATCHING','WAIT_RELEASE','WAIT_BALANCE','PURCHASED')) | NULL 表示无待购意向；收藏由关系存在表示 |
| note | text NOT NULL DEFAULT '' | 个人备注 |
| created_at | timestamptz NOT NULL DEFAULT now() | 创建时间 |
| updated_at | timestamptz NOT NULL DEFAULT now() | 修改时间 |

表级约束：`UNIQUE(user_id,product_id)`；`FOREIGN KEY(release_id,product_id) REFERENCES product_releases(id,product_id)`

### brand_followers

唯一品牌关注数据源

| 字段 | SQL 类型、默认及约束 | 注释 |
|---|---|---|
| user_id | text NOT NULL REFERENCES users(id) | 所属用户 |
| brand_id | text NOT NULL REFERENCES brands(id) | 品牌 ID，禁止存名称 |
| created_at | timestamptz NOT NULL DEFAULT now() | 创建时间 |

表级约束：`PRIMARY KEY(user_id,brand_id)`

### user_assets

个人衣橱/购买/提醒/手写心愿/通知的唯一存储

| 字段 | SQL 类型、默认及约束 | 注释 |
|---|---|---|
| user_id | text NOT NULL REFERENCES users(id) | 所属用户 |
| asset_type | text NOT NULL CHECK(asset_type IN ('wardrobe','purchase','reminder','wish','notification')) | 资产类型 |
| id | text NOT NULL | 类型内资产 ID |
| payload_json | jsonb NOT NULL CHECK(jsonb_typeof(payload_json)='object') | 严格按类型校验，字段字典见设计文档 |
| version | bigint NOT NULL DEFAULT 1 CHECK(version>0) | 乐观锁版本 |
| created_at | timestamptz NOT NULL DEFAULT now() | 创建时间 |
| updated_at | timestamptz NOT NULL DEFAULT now() | 修改时间 |
| deleted_at | timestamptz | 软删除时间 |

表级约束：`PRIMARY KEY(user_id,asset_type,id)`

### media_objects

用户上传图片，不重复承载外站商品图片

| 字段 | SQL 类型、默认及约束 | 注释 |
|---|---|---|
| id | text PRIMARY KEY | 业务 ID，由服务端生成；允许前端提交幂等 ID |
| owner_user_id | text NOT NULL REFERENCES users(id) | 上传人 |
| object_key | text NOT NULL UNIQUE | 对象存储键 |
| upload_id | text NOT NULL UNIQUE | 上传会话 |
| purpose | text NOT NULL | 用途，沿用上传接口枚举 |
| content_type | text NOT NULL | 媒体类型 |
| size_bytes | bigint NOT NULL DEFAULT 0 CHECK(size_bytes>=0) | 文件大小 |
| uploaded_at | timestamptz | 上传完成时间 |
| retention_until | timestamptz | 保留期限 |
| created_at | timestamptz NOT NULL DEFAULT now() | 创建时间 |
| deleted_at | timestamptz | 软删除时间 |



### community_posts

轻社区动态；当前接口一帖一图

| 字段 | SQL 类型、默认及约束 | 注释 |
|---|---|---|
| id | text PRIMARY KEY | 业务 ID，由服务端生成；允许前端提交幂等 ID |
| author_user_id | text NOT NULL REFERENCES users(id) | 作者 |
| media_id | text NOT NULL REFERENCES media_objects(id) | 已上传图片；imageUrl 由媒体接口生成 |
| caption | text NOT NULL DEFAULT '' CHECK(length(caption)<=600) | 正文 |
| category | text NOT NULL CHECK(category IN ('JK','LOLITA','HANFU','MIXED')) | 坑向 |
| topic | text NOT NULL DEFAULT '' | 单话题，不扩展话题关系表 |
| visibility | text NOT NULL DEFAULT 'public' CHECK(visibility IN ('public','private')) | 可见范围 |
| product_id | text REFERENCES products(id) | 可选关联商品 |
| created_at | timestamptz NOT NULL DEFAULT now() | 创建时间 |
| updated_at | timestamptz NOT NULL DEFAULT now() | 修改时间 |
| deleted_at | timestamptz | 软删除时间 |



### community_post_likes

点赞关系；不等同收藏

| 字段 | SQL 类型、默认及约束 | 注释 |
|---|---|---|
| post_id | text NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE | 动态 |
| user_id | text NOT NULL REFERENCES users(id) | 所属用户 |
| created_at | timestamptz NOT NULL DEFAULT now() | 创建时间 |

表级约束：`PRIMARY KEY(post_id,user_id)`

### user_events

互动统计事件；不用于同步本地浏览历史

| 字段 | SQL 类型、默认及约束 | 注释 |
|---|---|---|
| id | text PRIMARY KEY | 业务 ID，由服务端生成；允许前端提交幂等 ID |
| user_id | text REFERENCES users(id) | 匿名可空 |
| event_type | text NOT NULL | 事件类型，接口白名单 |
| target_type | text NOT NULL | 目标类型，接口白名单 |
| target_id | text NOT NULL DEFAULT '' | 目标 ID |
| metadata | jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(metadata)='object') | 必要统计属性，不存私密内容 |
| created_at | timestamptz NOT NULL DEFAULT now() | 创建时间 |



### sync_operations

幂等回执；成功须代表业务写入已提交

| 字段 | SQL 类型、默认及约束 | 注释 |
|---|---|---|
| user_id | text NOT NULL REFERENCES users(id) | 所属用户 |
| op_id | text NOT NULL | 客户端操作 ID |
| device_id | text NOT NULL | 设备 ID |
| entity_type | text NOT NULL | 业务类型 |
| entity_id | text NOT NULL | 业务 ID |
| action | text NOT NULL | 动作 |
| payload_json | jsonb NOT NULL CHECK(jsonb_typeof(payload_json)='object') | 业务对象，不再二次编码 JSON 字符串 |
| result | text NOT NULL CHECK(result IN ('accepted','rejected','conflict')) | 执行结果 |
| server_version | bigint NOT NULL | 业务提交后的版本 |
| client_created_at | timestamptz NOT NULL | 客户端时间 |
| accepted_at | timestamptz NOT NULL DEFAULT now() | 服务端处理时间 |

表级约束：`PRIMARY KEY(user_id,op_id)`

### feedback_records

反馈及举报共用，避免重复后台

| 字段 | SQL 类型、默认及约束 | 注释 |
|---|---|---|
| id | text PRIMARY KEY | 业务 ID，由服务端生成；允许前端提交幂等 ID |
| user_id | text REFERENCES users(id) | 反馈人，可匿名 |
| type | text NOT NULL | 问题类型 |
| content | text NOT NULL | 说明 |
| contact | text NOT NULL DEFAULT '' | 自愿联系方式 |
| images | text[] NOT NULL DEFAULT '{}' | 附件地址 |
| target_type | text | 举报对象类型，可空 |
| target_id | text | 举报对象 ID，可空 |
| status | text NOT NULL DEFAULT 'open' CHECK(status IN ('open','processing','closed')) | 处理状态 |
| created_at | timestamptz NOT NULL DEFAULT now() | 创建时间 |
| updated_at | timestamptz NOT NULL DEFAULT now() | 修改时间 |
| deleted_at | timestamptz | 软删除时间 |



### ai_import_tasks

合并建议和确认记录；一任务一次识别结果与确认

| 字段 | SQL 类型、默认及约束 | 注释 |
|---|---|---|
| id | text PRIMARY KEY | 业务 ID，由服务端生成；允许前端提交幂等 ID |
| user_id | text NOT NULL REFERENCES users(id) | 所属用户 |
| media_id | text REFERENCES media_objects(id) ON DELETE SET NULL | 来源媒体 |
| state | text NOT NULL | 识别状态，服务端状态机校验 |
| request_id | text NOT NULL | 追踪请求 ID |
| task_type | text NOT NULL DEFAULT 'purchase_order' | 识别用途 |
| model_provider | text NOT NULL | 服务商 |
| model_name | text NOT NULL | 模型 |
| model_version | text NOT NULL DEFAULT '' | 模型版本 |
| source_platform | text NOT NULL DEFAULT '' | 来源平台 |
| source_link | text NOT NULL DEFAULT '' | 来源链接 |
| suggestion_json | jsonb | 识别建议 |
| confidence | double precision CHECK(confidence BETWEEN 0 AND 1) | 总置信度 |
| field_confidence_json | jsonb NOT NULL DEFAULT '{}' | 字段置信度 |
| evidence_json | jsonb NOT NULL DEFAULT '[]' | 识别依据 |
| warnings_json | jsonb NOT NULL DEFAULT '[]' | 不确定项 |
| confirmed_json | jsonb | 用户确认的最终值 |
| correction_json | jsonb | 用户改动 |
| confirmation_op_id | text | 幂等确认操作 ID；缺失 NULL，禁止空串 |
| target_id | text | 确认关联的购买记录 ID；服务端校验同用户 purchase |
| expires_at | timestamptz NOT NULL | 过期时间 |
| confirmed_at | timestamptz | 确认时间 |
| created_at | timestamptz NOT NULL DEFAULT now() | 创建时间 |
| updated_at | timestamptz NOT NULL DEFAULT now() | 修改时间 |

表级约束：`UNIQUE(user_id,confirmation_op_id)`；`CHECK(confirmation_op_id IS NULL OR length(confirmation_op_id)>0)`

### review_records

发布审计仍有实际后台接口

| 字段 | SQL 类型、默认及约束 | 注释 |
|---|---|---|
| id | text PRIMARY KEY | 业务 ID，由服务端生成；允许前端提交幂等 ID |
| entity_type | text NOT NULL | 对象类型 |
| entity_id | text NOT NULL | 对象 ID |
| action | text NOT NULL | 审核动作 |
| field_changes | jsonb NOT NULL DEFAULT '{}' | 修改前后差异 |
| reviewer_id | text REFERENCES users(id) | 审核人 |
| reason | text NOT NULL DEFAULT '' | 原因 |
| created_at | timestamptz NOT NULL DEFAULT now() | 创建时间 |



### schema_migrations

仅记录新基线及后续实际执行过的迁移

| 字段 | SQL 类型、默认及约束 | 注释 |
|---|---|---|
| filename | text PRIMARY KEY | 迁移文件名 |
| applied_at | timestamptz NOT NULL DEFAULT now() | 执行时间 |


