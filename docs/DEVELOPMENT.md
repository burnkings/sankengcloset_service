# 服务仓库开发与部署

本仓库只承载 API、迁移、测试、部署配置和未来的运营后台；UniApp X 客户端位于 `burnkings/sankengcloset`。

## 临时 Android 内测

```bash
cp .env.example .env
# 设定 HOST=0.0.0.0、PORT=8787、DATA_DRIVER=memory、NODE_ENV=development
npm ci
npm run typecheck
npm test
npm run dev
```

通过服务器公网 IP 和端口 8787 供 Android beta 访问。此方式仅用于内测；生产必须使用 HTTPS 域名、PostgreSQL、对象存储和进程守护。

## 发布前最低要求

- 切换 `DATA_DRIVER=postgres` 并执行 `npm run migrate`
- 禁用开发登录
- 配置强 `JWT_SECRET`
- 仅通过 Caddy/Nginx 暴露 HTTPS
- 将上传文件替换为 OSS/COS/S3
