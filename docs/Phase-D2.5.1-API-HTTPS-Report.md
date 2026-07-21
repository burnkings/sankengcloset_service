# Phase D2.5.1 API HTTPS 报告

## 一、当前判断

Phase D2.5.1 **完成**。api.sankengcloset.icu SSL 证书已部署，HTTPS 已启用，HTTP→HTTPS 重定向正常。

## 二、执行前检查结果

### DNS 解析

| 域名 | 状态 | 解析结果 |
|------|------|----------|
| api.sankengcloset.icu | ✅ | 8.133.168.216 |
| admin.sankengcloset.icu | ✅ | 8.133.168.216 |
| www.sankengcloset.icu | ✅ | 8.133.168.216 |
| sankengcloset.icu | ⚠️ 未配置 | — |

### Nginx 配置

- 配置文件: /etc/nginx/sites-available/api.sankengcloset.icu
- 语法检查: ✅ 通过
- 配置测试: ✅ 通过
- 监听: HTTPS (443) + HTTP (80) → 301 重定向
- 代理目标: http://127.0.0.1:8787
- 安全响应头: X-Content-Type-Options, X-Frame-Options, Referrer-Policy

### 服务端口

| 端口 | 服务 | 监听地址 | 暴露公网 |
|------|------|----------|----------|
| 8787 | 后端 API | 127.0.0.1 | ❌ 安全 |
| 8055 | Directus | 127.0.0.1 | ❌ 安全 |
| 5432 | PostgreSQL | Docker 内部 | ❌ 安全 |

### UFW 防火墙

- 状态: active
- 允许: 22/tcp, 80/tcp, 443/tcp
- 默认策略: deny incoming, allow outgoing

## 三、后端健康检查

### /health 端点

```
GET http://127.0.0.1:8787/health
Response: {"requestId":"req-7","data":{"status":"ok","service":"sankengcloset-api"}}
```

- ✅ 无需认证
- ✅ 不返回敏感信息
- ✅ 响应快速
- ✅ 包含 status 和 service 字段

## 四、API SSL 证书结果

| 项目 | 详情 |
|------|------|
| 域名 | api.sankengcloset.icu |
| 证书文件 | /etc/nginx/ssl/api.sankengcloset.icu.pem |
| 私钥文件 | /etc/nginx/ssl/api.sankengcloset.icu.key |
| 证书主体 | CN = api.sankengcloset.icu |
| 签发者 | DigiCert Inc / Encryption Everywhere DV TLS CA - G2 |
| 有效期 | 2026-07-21 至 2026-10-18 |
| 证书类型 | DV (Domain Validation) |
| 不是自签名 | ✅ |
| 证书不提交 Git | ✅ |

## 五、外部验证结果

### HTTP → HTTPS 重定向

```bash
curl -I http://api.sankengcloset.icu
# HTTP/1.1 301 Moved Permanently
# Location: https://api.sankengcloset.icu/
```

✅ 301 重定向正常

### HTTPS 访问

```bash
curl -Ik https://api.sankengcloset.icu/health
# HTTP/2 200
# {"requestId":"req-9","data":{"status":"ok","service":"sankengcloset-api"}}
```

✅ HTTPS 连接正常，/health 可访问

### SSL 证书验证

```bash
openssl s_client -connect api.sankengcloset.icu:443 -servername api.sankengcloset.icu
# subject=CN = api.sankengcloset.icu
# issuer=C = US, O = DigiCert Inc, OU = www.digicert.com, CN = Encryption Everywhere DV TLS CA - G2
```

✅ 证书链完整，域名匹配

### 根路径

```bash
curl -sk https://api.sankengcloset.icu/
# HTTP/2 404
# {"message":"Route GET:/ not found","error":"Not Found","statusCode":404}
```

✅ 根路径 404 是正常的（后端无根路由）

## 六、Nginx 配置详情

### HTTP → HTTPS 重定向

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name api.sankengcloset.icu;
    return 301 https://$host$request_uri;
}
```

### HTTPS 反向代理

```nginx
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name api.sankengcloset.icu;

    ssl_certificate /etc/nginx/ssl/api.sankengcloset.icu.pem;
    ssl_certificate_key /etc/nginx/ssl/api.sankengcloset.icu.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
    }

    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
}
```

### 安全头

- X-Content-Type-Options: nosniff
- X-Frame-Options: SAMEORIGIN
- Referrer-Policy: strict-origin-when-cross-origin

## 七、验收清单

| 检查项 | 状态 |
|--------|------|
| https://api.sankengcloset.icu 可访问 | ✅ |
| /health 正常 | ✅ |
| HTTP 跳转 HTTPS | ✅ 301 |
| Nginx 配置通过 | ✅ |
| 8787 不直接暴露公网 | ✅ 127.0.0.1 |
| 报告无敏感信息 | ✅ |
| SSL 证书有效 | ✅ DigiCert DV |
| 证书链完整 | ✅ |
| 不是自签名证书 | ✅ |
| 证书不提交 Git | ✅ |
| 无 502 错误 | ✅ |
| 无重定向循环 | ✅ |

## 八、裸域名检查

| 域名 | DNS 状态 | 处理 |
|------|----------|------|
| sankengcloset.icu | ⚠️ 未配置 A 记录 | 需添加 A @ 8.133.168.216 |

裸域名不是 D3 的强制前置条件，列为待完成项。

## 九、Nginx 清理

- 删除了旧的 HTTP-only 配置备份文件 /etc/nginx/sites-enabled/api.sankengcloset.icu.bak
- 消除了 conflicting server name 警告

## 十、已知风险

1. **裸域名无 DNS** — 需在阿里云控制台添加 A 记录
2. **证书有效期** — DV 证书有效期约3个月，需配置自动续期

## 十一、D2.5.1 验收结论

**Phase D2.5.1 全部通过**，可继续执行 Phase D3。

| 前置条件 | 状态 |
|----------|------|
| api.sankengcloset.icu HTTPS 可访问 | ✅ |
| /health 正常 | ✅ |
| HTTP 跳转 HTTPS | ✅ |
| Nginx 配置通过 | ✅ |
| 8787 不直接暴露公网 | ✅ |
| 报告无敏感信息 | ✅ |
