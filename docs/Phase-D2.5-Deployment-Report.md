# Phase D2.5 部署报告

## 一、当前判断

Phase D2.5 **全部完成**。Nginx 反向代理、HTTPS 证书、防火墙、Directus 管理后台、后端 API 均已配置并运行。

## 二、DNS 检查结果

| 域名 | 状态 | 解析结果 |
|------|------|----------|
| sankengcloset.icu | ⚠️ 未配置 | — |
| www.sankengcloset.icu | ✅ 已解析 | 8.133.168.216 |
| api.sankengcloset.icu | ✅ 已解析 | 8.133.168.216 |
| admin.sankengcloset.icu | ✅ 已解析 | 8.133.168.216 |

## 三、服务器端口检查结果

### 监听端口（仅允许 22/80/443）

| 端口 | 服务 | 监听地址 | UFW |
|------|------|----------|-----|
| 22/tcp | SSH | 0.0.0.0 | ✅ 允许 |
| 80/tcp | Nginx | 0.0.0.0 | ✅ 允许 |
| 443/tcp | Nginx | 0.0.0.0 | ✅ 允许 |

### 内部服务（仅127.0.0.1）

| 端口 | 服务 | 监听地址 | 暴露公网 |
|------|------|----------|----------|
| 8055 | Directus | 127.0.0.1 | ❌ 安全 |
| 8787 | 后端 API | 127.0.0.1 | ❌ 安全 |
| 5432 | PostgreSQL | Docker 内部 | ❌ 安全 |

## 四、Nginx 安装和运行状态

- **版本**: nginx/1.24.0 (Ubuntu)
- **状态**: active (running)
- **配置检查**: ✅ 通过 (nginx -t)
- **自动续期**: certbot.timer active

## 五、域名与服务映射

```
www.sankengcloset.icu    → Nginx → /var/www/sankengcloset (静态维护页)
api.sankengcloset.icu    → Nginx → 127.0.0.1:8787 (后端 API)
admin.sankengcloset.icu  → Nginx → 127.0.0.1:8055 (Directus)
```

## 六、新增 Nginx 配置

### admin.sankengcloset.icu

- HTTPS (443) + HTTP→HTTPS 跳转
- Basic Auth 第二层保护
- 反向代理到 127.0.0.1:8055
- WebSocket 支持
- 安全响应头

### api.sankengcloset.icu

- HTTPS (443) + HTTP→HTTPS 跳转
- SSL 证书: api.sankengcloset.icu.pem (DigiCert, 有效期至 2026-10-18)
- 反向代理到 127.0.0.1:8787
- 安全响应头

### www.sankengcloset.icu

- HTTPS (443) + HTTP→HTTPS 跳转
- 静态文件服务 /var/www/sankengcloset
- 安全响应头

## 七、Directus 监听方式

- **监听地址**: 127.0.0.1:8055 (仅本机)
- **Docker Compose**: docker-compose.infra.yml
- **网络**: internal (Docker 内部) + edge
- **不暴露公网**: ✅

## 八、API 监听方式

- **监听地址**: 127.0.0.1:8787 (仅本机)
- **通过 Nginx 代理**: api.sankengcloset.icu → 127.0.0.1:8787
- **不暴露公网**: ✅

## 九、HTTPS 证书结果

| 域名 | 证书 | 状态 |
|------|------|------|
| www.sankengcloset.icu | sankengcloset.icu.pem | ✅ |
| admin.sankengcloset.icu | admin.sankengcloset.icu.pem | ✅ |
| api.sankengcloset.icu | api.sankengcloset.icu.pem | ✅ HTTPS 已启用 |

## 十、自动续期结果

- **Certbot Timer**: active (waiting)
- **下次触发**: 约7小时后

## 十一、防火墙结果

- **UFW 状态**: active
- **允许端口**: 22/tcp, 80/tcp, 443/tcp
- **默认策略**: deny incoming, allow outgoing

## 十二、管理后台访问地址

- **HTTPS**: https://admin.sankengcloset.icu
- **Basic Auth**: 见 docs/DIRECTUS-CREDENTIALS.md
- **Directus 登录**: 见 docs/DIRECTUS-CREDENTIALS.md

## 十三、API 访问地址

- **HTTP**: http://api.sankengcloset.icu (→ 301 重定向 HTTPS)
- **HTTPS**: https://api.sankengcloset.icu ✅ 已启用

## 十四、主域名处理结果

- **地址**: https://www.sankengcloset.icu
- **内容**: 极简静态维护页
- **不会进入管理后台**: ✅

## 十五、安全检查

| 检查项 | 状态 |
|--------|------|
| PostgreSQL 不暴露5432 | ✅ |
| Redis 不暴露6379 | ✅ |
| Directus 不暴露8055 | ✅ 127.0.0.1 |
| 后端不暴露8787 | ✅ 127.0.0.1 |
| 管理后台需认证 | ✅ Basic Auth + Directus |
| UFW 只开放22/80/443 | ✅ |
| .env 在 .gitignore | ✅ |
| 证书/密钥不提交 Git | ✅ |
| 安全响应头 | ✅ |

## 十六、测试命令与结果

```bash
# Nginx 配置检查
sudo nginx -t  # ✅ passed

# HTTP→HTTPS 跳转
curl -sI http://admin.sankengcloset.icu  # ✅ 301
curl -sI http://www.sankengcloset.icu     # ✅ 301

# HTTPS 访问
curl -skI https://admin.sankengcloset.icu  # ✅ 401 (Basic Auth)
curl -skI https://www.sankengcloset.icu     # ✅ 200

# API 访问
curl -s http://api.sankengcloset.icu/ready  # ✅ {"status":"ready"}

# SSL 证书
openssl s_client -connect admin.sankengcloset.icu:443  # ✅ CN=www.admin.sankengcloset.icu

# 端口检查
sudo ss -lntp | grep -E "8055|8787|5432|6379"  # ✅ 均为127.0.0.1
```

## 十七、新增和修改文件

### 新增文件

| 文件 | 说明 |
|------|------|
| /etc/nginx/sites-available/admin.sankengcloset.icu | Nginx admin 配置 |
| /etc/nginx/sites-available/api.sankengcloset.icu | Nginx api 配置 |
| /etc/nginx/sites-available/www.sankengcloset.icu | Nginx www 配置 |
| /etc/nginx/ssl/admin.sankengcloset.icu.pem | Admin SSL 证书 |
| /etc/nginx/ssl/admin.sankengcloset.icu.key | Admin SSL 私钥 |
| /etc/nginx/ssl/sankengcloset.icu.pem | 主域名 SSL 证书 |
| /etc/nginx/ssl/sankengcloset.icu.key | 主域名 SSL 私钥 |
| /etc/nginx/.htpasswd-sankeng-admin | Basic Auth 密码文件 |
| /var/www/sankengcloset/index.html | 主域名静态页 |
| docker-compose.infra.yml | 基础设施 Compose |
| .env.infra | 基础设施环境变量 |

### 修改文件

| 文件 | 变更 |
|------|------|
| .gitignore | 添加 .env.infra, docs/DIRECTUS-CREDENTIALS.md |
| .env | HOST=127.0.0.1 (安全修复) |

## 十八、已知风险

1. **后端启动方式** — 当前使用 `node --env-file=.env` 启动，需要确保 .env 文件正确加载
2. **裸域名无 DNS** — sankengcloset.icu 未配置 A 记录（非 D3 强制前置条件）
3. **Directus 使用测试证书** — DV 证书有效期3个月，上线前需申请正式证书

## 十九、回滚方式

### 回滚 Nginx 配置

```bash
sudo rm /etc/nginx/sites-enabled/*.sankengcloset.icu
sudo ln -s /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

### 回滚防火墙

```bash
sudo ufw disable
```

### 回滚 Directus

```bash
cd /home/admin/projects/sankengcloset_service
docker-compose -f docker-compose.infra.yml --env-file .env.infra down -v
```

### 回滚后端

```bash
# 恢复 .env 中的 HOST=0.0.0.0
sed -i 's/HOST=127.0.0.1/HOST=0.0.0.0/' .env
```

## 二十、下一阶段建议

1. **配置裸域名 DNS** — 添加 A 记录到 8.133.168.216
2. **Directus 数据模型配置** — 创建商品、品牌、采集源等集合
3. **后端与 Directus 集成** — 配置数据同步
4. **生产环境配置** — 使用 Docker Compose production 模式
