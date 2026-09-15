# 当前 App 的 12 表基线与适配进度

本文件完全替换此前 26 表方案。项目自建表总计 14 张，已包含会话、媒体、AI任务和迁移记录，不另追加支撑表。Directus 自带系统表不属于本项目自建表，不执行删除。

## 设计取舍：针对当前项目，不宣称行业唯一最佳

数据库没有按“现代化应用”统一规定的表数。页面只是需求入口；最终依据是实际业务边界、数据由谁维护、哪些内容必须一起更新、有哪些跨对象查询，以及维护成本。关联查询是正常能力，不作为必须消灭的成本；拆表也不是默认答案。

本项目选择固定业务字段 + 少量结构化 JSONB。PostgreSQL 官方 Designing JSON Documents 明确支持关系模型和 JSON 共存，建议 JSON 保持可预测结构，并提醒更新 JSON 也会锁定整行。来源：https://www.postgresql.org/docs/17/datatype-json.html#JSON-DOC-DESIGN 。该来源支持设计原则，不替本项目决定表数。

| 业务边界 | 选择 | 收益与承担的代价 |
|---|---|---|
| 用户账户 | 资料、偏好、预算同表；会话分离 | 不把设置拆成零碎表；会话有独立过期与撤销需求 |
| 商品目录 | 图片、展示规格、说明在商品内 | 资料一起维护；结构化 JSON 仍要校验，不能随意加键 |
| 用户互动 | 收藏、关注、点赞合并一表 | 共用去重、时间及用户归属；接受少量可空列和类型约束，不做任意插件化关系引擎 |
| 发售安排 | 保留商品批次表 | 当前日历跨商品查询、提醒引用批次；只维护批次一份日期，不再另建事件表 |
| 个人记录 | 复用 user_assets，每条衣物/购买/提醒各自一行 | 适合当前按用户读取；服务按类型分别校验，禁止一行塞下整个衣橱 |
| 媒体与AI任务 | 各一表 | 上传和识别有独立状态、权限、失败重试；结果附属于各自记录，不再拆子表 |

最终 12 张是本轮边界选择的结果，不是为了凑数：users、user_sessions、products、brands、product_releases、user_assets、user_interactions、community_posts、media_objects、ai_import_tasks、feedback_records、schema_migrations。包含全部项目支撑表，不另加采集、价格历史、标签、图片、审核历史、同步流水表。

### 合并互动后并不增加前端负担

已有收藏、关注、点赞接口仍可保持各自业务路径；后端调用同一存储表。不要向前端暴露“随便传类型和目标”的通用写接口。

- PRODUCT_FAVORITE：只填 product_id，可有 release_id、intent_status、note。
- BRAND_FOLLOW：只填 brand_id，不接受待购或批次字段。
- POST_LIKE：只填 post_id，不接受待购或批次字段。
- 每种用户+目标唯一，目标有实际外键；收藏批次必须属于对应商品。
- 计数按类型聚合，同一用户取消品牌关注不影响商品收藏。

Directus 日常只配置商品、品牌、发售三个采集入口。用户详情可用后台查询展示互动列表，物理上无需把全部数据嵌进 users。

## 1. 前端依据及错误纠正

已核对 `pages/discover/index.uvue` 和 `pages/product/detail.uvue` 的模板及调用：发现页是榜单、品牌和发售日历；详情是当前报价、款式/颜色/尺码、同款、关联动态。没有历史价格曲线。此前把旧后端趋势服务作为需求依据是错误的。

不建立价格快照，不建设价格趋势，也不把“移除历史价格功能”列为前端任务——前端原本没有此功能。旧后端相关代码在后续仓储收口时移除。原评审报告不能代替页面与调用链验证。

## 2. 完整集合

| 表 | 内容 |
|---|---|
| users | 用户、当前登录身份、偏好和预算 JSON |
| user_sessions | 刷新会话与撤销 |
| products | 商品、图片数组、展示规格数组、当前报价、外链、同款分组、浏览计数 |
| brands | 品牌介绍 |
| product_releases | 批次与日历明确日期 |
| user_interactions | 商品收藏、品牌关注、动态点赞；三种明确类型 |
| user_assets | 衣橱、购买、提醒、手写心愿、通知，按类型校验 |
| community_posts | 轻社区动态 |
| media_objects | 用户上传媒体 |
| ai_import_tasks | 识别、建议、确认合一 |
| feedback_records | 反馈与举报 |
| schema_migrations | 实际执行的迁移记录 |

图片只存 products.images（URL数组，第一张封面），不另写封面列或图片表。已确认的展示规格存 variants，不生成颜色×尺码组合。group_key 支持当前同款查询；接口不需要因底层删表而消失。品牌名与店铺名分开，未填写品牌不自动生成。

发售批次直接存 start_at/end_at/balance_due_at/ship_at；日历从批次生成，不需要 sale_events。未知年份等原文存 shipping_note，不伪造日期。收藏、关注、点赞合并为 user_interactions，每条互动仍是独立记录；使用三个目标外键及类型检查，不使用无法建立外键的泛化 target_id。浏览次数原子递增，不是独立浏览人数。

偏好、预算并入 users；当前单一登录方式的 provider/subject 直接唯一约束，暂不支持多提供方绑定。AI单任务建议和确认并入同一行，确认操作 ID 唯一，跨任务重用应报冲突。

## 3. 本轮实际改动与剩余工作

已完成：

- 替换 26 表 SQL，保留 12 表；字段注释与唯一约束。
- 单页 Excel 导入器适配新 products/brands；图片 JSON 单源、不写旧附属表，未知价格存 NULL。
- 保留整表事务和商品 ID；增加新基线实际建库、导入、重复更新、回滚验证。

尚未完成，禁止切换生产数据库：

- PostgresRepository 全部查询与写入仍须适配新列，涵盖登录、偏好、商品详情/Feed/榜单/品牌/同款/日历、收藏及AI确认。
- 旧趋势/采集/审核历史/同步审计接口及脚本的调用排查和下线；审核改为商品最近审核信息。
- 前端金额/收藏枚举与新契约统一；不能仅删后端旧字段让前端静默丢数据。
- 真实路由全链路测试、Directus配置、实际PostgreSQL及客户端编译验证。

当前分支是适配中的草稿，不允许合并部署。SQL仍在 database/blueprints，不挂入现有迁移链；旧数据不搬运、不双写。新版与旧库无法直接共用 importer。只有完成仓储和接口后，才将新基线接入正式建库命令。

## 4. user_assets 的新版 JSON 字段契约

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
- preferences：pitTypes、priceRange、themeMode；删除 followedBrands 重复存储，关注只读 user_interactions（BRAND_FOLLOW）。价格区间采用稳定枚举，由前后端共享含义。
- 屏蔽品牌、屏蔽动态及浏览历史目前是本地功能，本轮不擅自增加跨端同步表。
- 消费日志从购买记录派生。由于当前只有累计 paidCents 和 purchaseDate，只能准确称“按购买日期归属的累计已付”；不能宣称精确的每月实际付款流水。若产品坚持按定金/尾款实际支付月份统计，再单独立项 payment_entries，此稿不预先新增交易式流水表。


## 5. 新基线运行规则

所有日期/金额在服务端校验；商品未知价 NULL，客户端展示待确认。PATCH 未提交不改；关联对象按当前用户与批次归属验证；购买完成或取消后关闭待执行尾款提醒。生成剩余金额，不接受第二份冲突金额。

预算/偏好从 users 的 budget_json/preferences_json 读取，品牌关注不重复写偏好。当前消费日志不新增支付录入功能；付款明细仅是未来需要精确付款月份时的方案，本轮不擅自生成历史支付数据。

本轮增加合并互动的数据库约束测试，未完成运行时路由适配。仅有表和导入通过不代表 App 已贯通。当前 runtime 未切换，旧 migrations 不可在新基线上重放。日常 Directus 只需商品、品牌、发售三个录入入口。

## 6. 字段字典

表级 CHECK、复合外键与索引以 next-schema.sql 为准。

### users

| 字段 | 类型及约束 | 注释 |
|---|---|---|
| id | text PRIMARY KEY | 业务 ID，由服务端生成；允许前端提交幂等 ID |
| nickname | text NOT NULL | 昵称 |
| login_provider | text | 当前单一登录提供方 |
| login_subject | text | 提供方唯一用户标识 |
| preferences_json | jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(preferences_json)='object') | 主题及推荐偏好，不重复存关注关系 |
| budget_json | jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(budget_json)='object') | 预算配置，金额整数分 |
| avatar_url | text NOT NULL DEFAULT '' | 头像地址 |
| status | text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')) | 账号状态 |
| created_at | timestamptz NOT NULL DEFAULT now() | 创建时间 |
| updated_at | timestamptz NOT NULL DEFAULT now() | 修改时间 |

### user_sessions

| 字段 | 类型及约束 | 注释 |
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

### brands

| 字段 | 类型及约束 | 注释 |
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

### products

| 字段 | 类型及约束 | 注释 |
|---|---|---|
| id | text PRIMARY KEY | 业务 ID，由服务端生成；允许前端提交幂等 ID |
| title | text NOT NULL CHECK(length(btrim(title))>0) | 唯一正式名称，替代 canonical_name/display_name |
| brand_id | text REFERENCES brands(id) | 品牌，可未知 |
| shop_name | text NOT NULL DEFAULT '' | 店铺展示名 |
| category | text NOT NULL CHECK(category IN ('JK','LOLITA','HANFU','OTHER')) | 坑向 |
| sub_category | text NOT NULL DEFAULT '' | 商品分类 |
| group_key | text | 同款归组键 |
| images | jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(images)='array') | 有序图片URL数组，第一张封面，唯一图片来源 |
| variants | jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(variants)='array') | 展示规格对象数组，不推断库存或组合 |
| view_count | bigint NOT NULL DEFAULT 0 CHECK(view_count>=0) | 累计浏览次数，非独立人数 |
| reviewed_by | text REFERENCES users(id) | 最近审核人 |
| reviewed_at | timestamptz | 最近审核时间 |
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
| version | bigint NOT NULL DEFAULT 1 CHECK(version>0) | 修改版本 |
| created_at | timestamptz NOT NULL DEFAULT now() | 创建时间 |
| updated_at | timestamptz NOT NULL DEFAULT now() | 修改时间 |
| deleted_at | timestamptz | 软删除时间 |

### product_releases

| 字段 | 类型及约束 | 注释 |
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
| start_at | timestamptz | 批次开始时间 |
| end_at | timestamptz | 批次结束时间 |
| balance_due_at | timestamptz | 明确尾款截止时间 |
| ship_at | timestamptz | 明确发货时间，不确定信息写shipping_note |
| shipping_note | text NOT NULL DEFAULT '' | 不确定的发货说明原文 |
| source_url | text NOT NULL DEFAULT '' | 批次资料来源 |
| visibility_status | text NOT NULL DEFAULT 'draft' CHECK(visibility_status IN ('draft','reviewing','published','hidden')) | 批次发布状态 |
| created_at | timestamptz NOT NULL DEFAULT now() | 创建时间 |
| updated_at | timestamptz NOT NULL DEFAULT now() | 修改时间 |
| deleted_at | timestamptz | 软删除时间 |

### user_assets

| 字段 | 类型及约束 | 注释 |
|---|---|---|
| user_id | text NOT NULL REFERENCES users(id) | 所属用户 |
| asset_type | text NOT NULL CHECK(asset_type IN ('wardrobe','purchase','reminder','wish','notification')) | 资产类型 |
| id | text NOT NULL | 类型内资产 ID |
| payload_json | jsonb NOT NULL CHECK(jsonb_typeof(payload_json)='object') | 严格按类型校验，字段字典见设计文档 |
| version | bigint NOT NULL DEFAULT 1 CHECK(version>0) | 乐观锁版本 |
| created_at | timestamptz NOT NULL DEFAULT now() | 创建时间 |
| updated_at | timestamptz NOT NULL DEFAULT now() | 修改时间 |
| deleted_at | timestamptz | 软删除时间 |

### media_objects

| 字段 | 类型及约束 | 注释 |
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

| 字段 | 类型及约束 | 注释 |
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

### feedback_records

| 字段 | 类型及约束 | 注释 |
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

| 字段 | 类型及约束 | 注释 |
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

### schema_migrations

| 字段 | 类型及约束 | 注释 |
|---|---|---|
| filename | text PRIMARY KEY | 迁移文件名 |
| applied_at | timestamptz NOT NULL DEFAULT now() | 执行时间 |

### user_interactions

| 字段 | 类型及约束 | 注释 |
|---|---|---|
| id | text PRIMARY KEY | 互动记录ID |
| user_id | text NOT NULL REFERENCES users(id) | 操作者 |
| kind | text NOT NULL CHECK(kind IN ('PRODUCT_FAVORITE','BRAND_FOLLOW','POST_LIKE')) | 商品收藏、品牌关注、动态点赞 |
| product_id | text REFERENCES products(id) | 仅商品收藏填写 |
| brand_id | text REFERENCES brands(id) | 仅品牌关注填写 |
| post_id | text REFERENCES community_posts(id) ON DELETE CASCADE | 仅动态点赞填写 |
| release_id | text | 收藏关注的批次，必须属于商品 |
| intent_status | text CHECK(intent_status IN ('WANT','WATCHING','WAIT_RELEASE','WAIT_BALANCE','PURCHASED')) | 仅收藏的待购意向，空表示无意向 |
| note | text NOT NULL DEFAULT '' | 仅收藏的个人备注 |
| created_at | timestamptz NOT NULL DEFAULT now() | 创建时间 |
| updated_at | timestamptz NOT NULL DEFAULT now() | 修改时间 |
