# 商品采集：以现有前端为准

本版只有一个「商品」工作表、一行一个来源商品。前端依据 `MockCatalogProduct`、`ProductDetailModel` 和现有 Product DTO，继续使用 `/api/v1/products`、商品详情、品牌和日历接口。取消未上线的 catalog 子模型、部件报价表、提交审核网站及对应 API。不会新增交易订单、库存、SKU 配置。

## 填写项 → 已有数据库 → 页面

|填写项|存储字段|用途 / 规则|
|---|---|---|
|商品名称，必填|products.display_name / canonical_name|列表和详情标题|
|商品链接，必填|source_url / canonical_url / source_platform / external_id|外跳原店；程序提取平台 ID，去除淘宝追踪参数|
|店铺名称，必填|products.shop_name（唯一新增业务字段）|品牌不明时详情显示店铺，不虚构品牌关联|
|坑向，必填|products.pit_type|JK / LOLITA / HANFU；直接对应已有筛选|
|商品图片，必填|products.cover_url / images；product_images.url / sort_order / is_cover|同格换行，首张封面；原地址保留，不伪造高清地址|
|参考全价（元），选填|products.current_price / price_type|元转分；仅明确全价填数值。空值用已有 0 + UNKNOWN 约定，不解释为免费|
|销售状态，选填|products.sale_status|未确认 UNKNOWN、预告 UPCOMING、现货 ON_SALE、预售 PRE_ORDER、售罄 SOLD_OUT、已结束 ENDED|
|品牌名称，选填|products.brand_id → brands.id|按名称和坑向匹配；没有品牌就留空，店铺不自动充当品牌|
|商品分类，选填|products.category|细分类，对应 DTO.subCategory；混合多部件留空|
|颜色，选填|products.color_tags|顿号分隔，不生成颜色与尺码组合|
|商品说明，选填|products.description|自由写系列、尺码、材质、复杂价格、发售信息等；详情直接展示|

编号、更新时间、图片顺序由程序维护，用户不填。品牌介绍、材质等没有数据时留空，页面不应补造说明。定金/尾款不是当前模板的全价。示例包含多个部件，因此全价留空；原始价格、配色和历史日期完整放入说明。发货年份不详，不生成日期或日历事件。

## 保留哪些已有表

|功能|已有表|主要关联及职责|
|---|---|---|
|商品介绍与搜索|products、product_images|商品 id 稳定；图片 product_id 引用商品|
|品牌目录和关注|brands、brand_followers|brand_id、user_id；关注数由真实行为产生|
|发售日历|product_releases、sale_events|product_id、start_at、end_at、状态；继续现有接口，仅录入可靠时间事件|
|收藏|wishlist_items|user_id、product_id，沿用当前唯一关系|
|动态|community_posts、community_post_likes|作者、正文、关联商品、点赞；不由 Excel 填统计值|
|衣橱、提醒、购买记录等用户内容|user_assets|user_id、asset_type、payload_json、version；沿用当前同步结构|
|用户、会话及设置|users、user_identities、user_sessions、user_settings|身份、登录与偏好；不在商品表存用户隐私|
|同步及媒体|sync_operations、media_objects|操作幂等与文件归属，沿用当前服务|
|已有采集来源和审核|raw_data、import_batches、source_records、review_records|保留原有数据及原采集链，本单表入口不新增同类系统|

product_variants、styles 等已有表不删除、不要求本次填写。FeedItem 是接口投影，不是要为每种 mock 卡片另建一张表；榜单和收藏数量也不是采集输入。既有用户功能的业务结构不因商品表简化而迁移。

## 导入运行

先运行项目迁移，再运行：

```sh
npm run catalog:import -- /path/商品.xlsx
npm run catalog:import -- /path/商品.xlsx --apply
# 已人工确认的整表才使用发布选项
npm run catalog:import -- /path/商品.xlsx --apply --publish
```

默认只校验；`--apply` 使用 DATABASE_URL 写入草稿；`--publish` 才直接发布。整表是完整替换该来源商品的采集字段，选填空值也会覆盖旧值；请先检查预览。图片会按最新输入替换。保留已有商品 ID、收藏等用户关系。重复行拒绝导入，整表失败回滚。删除旧 JSON 时无需运行旧格式适配层；新版入口只接受这张 Excel。

0015_product_source 仅放宽品牌为空、增加 shop_name 和 UNKNOWN 状态。已撤销的 0015_catalog_intake 在本工作区未部署；不要将这份说明当作已部署旧 catalog 数据库的自动回滚脚本。线上尚未执行迁移或导入。

Excel 适合目前人工收集：可以离线填写、批量导入。不需要新建管理后台。以后多人长期提交时，可把同样 11 项改成单页表单（图片上传替代粘贴链接），复用相同校验规则；无需因此重建商品模型。
