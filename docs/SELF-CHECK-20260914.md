# 2026-09-14 前后端合并自检与纠正

复查对象：前端 main 2b71dc2、后端 main 876786e。上一轮合并成功属实，但“接口已全面对齐”的表述超出验证范围。

## 发现与修复

- ranking-service 没有映射 viewCount，后端有值前端仍显示 0：补读取。
- product-service 没有映射 variants.styleName：补读取，详情款式不再恒为空。
- wardrobe-repo 的读、写、update 全遗漏 silhouette：补齐本地往返及切换坑向清空。
- wardrobe API 拒绝 FREQUENT，且 purchasePrice 的整数约束拒绝前端以元提交的小数价格：与实际客户端一致，保留 IDLE 兼容旧数据。
- Zod partial schema 仍注入默认值：PATCH 只采用请求显式提供的键，避免修改单字段覆盖其余字段。
- purchase 尾款日期联动 SQL 对同一 payload_json 重复赋值：合并为嵌套 jsonb_set 并明确 text 参数类型。
- variants 唯一约束仍是商品+颜色+尺码：新增 0017 迁移，改为商品+款式+颜色+尺码，允许同色同码 JSK/OP。
- 浏览事件次数不是去重人数：前端标签改为“次浏览”。热榜仍按 feed_score 排序，本次未改为浏览排行。

## 证据

前端新增 3 项行为测试，修复前全部失败：17 次浏览读为 0、JSK 读为空、形制存储后读为空。修复后全部通过；前端总计 28 项测试，verify 6/6。
后端新增 1 项跨多步骤的 PostgreSQL/API 测试，在隔离 PGlite 数据库运行仓库真实 SQL 与 Fastify 路由：覆盖 POST/PATCH/GET 衣橱、未提供字段保留、显式清空、购买提醒日期更新、同色同码双款式商品详情。后端类型检查通过，总计 231 项通过、1 项跳过。

## 边界与更正

- 当前衣橱 API 实际使用 user_assets.payload_json；旧 wardrobe_items 新增列并不是它的读写路径。上一轮把新增旧表列当作 API 持久化闭环的证据不充分。
- 实际衣橱接口是 POST /api/v1/me/wardrobe、PATCH /api/v1/me/wardrobe/:id、GET 列表/详情；原汇总写的 PUT 不准确。
- 浏览足迹是纯本地功能，不会上报 VIEW_PRODUCT；viewCount 仅覆盖已有事件记录，不能称为完整 App 浏览统计，也不能把无事件解释为无人浏览。本次没有改变本地足迹的隐私约定。
- 已发布的 0016 迁移不回写；部署时顺序运行 0016、0017。生产迁移和部署尚未执行。
- 未进行 HBuilderX 编译、真机验收或生产全接口逐条联调。上述测试验证了列明的路径，不等于“任何接口都畅通无阻”。
