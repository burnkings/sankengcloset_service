# Phase D8：数据审核后台部署说明

## 概述

最小化内部审核工具，用于审核采集的商品数据。

## 访问方式

### 方式 1：SSH 隧道（推荐）

```bash
# 在本地机器执行
ssh -L 8787:localhost:8787 admin@YOUR_SERVER_IP

# 然后在浏览器访问
# http://localhost:8787/api/admin/login
```

### 方式 2：内网访问

如果服务器在内网，直接访问 `http://INTERNAL_IP:8787/api/admin/login`

### 方式 3：防火墙白名单

```bash
# 仅允许指定 IP 访问 8787 端口
sudo ufw allow from YOUR_IP to any port 8787
```

## 登录

```bash
curl -X POST http://localhost:8787/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"sankeng2025"}'
# 返回: {"token":"admin_xxx","userId":"admin"}
```

## API 使用

所有审核 API 需要 Bearer Token：

```bash
TOKEN="admin_xxx"

# 查看待审核列表
curl -H "Authorization: Bearer $TOKEN" http://localhost:8787/api/admin/review/pending

# 查看商品详情
curl -H "Authorization: Bearer $TOKEN" http://localhost:8787/api/admin/review/prd_xxx

# 审核通过
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason":"数据准确"}' \
  http://localhost:8787/api/admin/review/prd_xxx/approve

# 驳回
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason":"价格信息过期"}' \
  http://localhost:8787/api/admin/review/prd_xxx/reject

# 编辑字段
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"displayName":"修正名称","currentPrice":15800}' \
  http://localhost:8787/api/admin/review/prd_xxx/edit

# 合并商品
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"targetId":"prd_yyy","reason":"同商品不同来源"}' \
  http://localhost:8787/api/admin/review/prd_xxx/merge

# 标记下架
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:8787/api/admin/review/prd_xxx/retire

# 查看采集错误
curl -H "Authorization: Bearer $TOKEN" http://localhost:8787/api/admin/review/errors
```

## 安全说明

- Token 24小时过期
- 默认密码：`sankeng2025`（生产环境必须修改）
- 设置环境变量 `ADMIN_PASSWORD` 修改密码
- 不得暴露在公网
- 不得修改 App 导航
- 所有修改记录到 `review_records` 表

## 环境变量

```bash
ADMIN_PASSWORD=your_secure_password_here
```
