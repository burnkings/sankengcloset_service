#!/bin/bash
# Phase D2.5 完成脚本
# 在阿里云安全组、DNS 和 Docker 镜像源配置完成后执行

set -e

echo "=== Phase D2.5 完成脚本 ==="
echo ""

# 1. 启动 PostgreSQL（修复端口绑定）
echo "1. 启动 PostgreSQL..."
cd /home/admin/projects/sankengcloset_service

# 停止旧容器
docker stop sankengcloset_service_postgres_1 2>/dev/null || true

# 重新启动（使用生产配置，不暴露端口）
docker-compose -f docker-compose.infra.yml --env-file .env.infra up -d postgres
echo "   PostgreSQL 启动完成"

# 等待 PostgreSQL 就绪
echo "   等待 PostgreSQL 就绪..."
sleep 10

# 2. 启动 Directus
echo "2. 启动 Directus..."
docker-compose -f docker-compose.infra.yml --env-file .env.infra up -d directus
echo "   Directus 启动完成"

# 等待 Directus 就绪
echo "   等待 Directus 就绪..."
sleep 15

# 3. 验证服务
echo "3. 验证服务..."
echo "   PostgreSQL:"
docker exec $(docker ps -q -f "name=postgres") pg_isready -U sankeng 2>&1 || echo "   PostgreSQL 未就绪"

echo "   Directus:"
curl -sI http://127.0.0.1:8055 2>&1 | head -3 || echo "   Directus 未就绪"

# 4. 申请 HTTPS 证书
echo "4. 申请 HTTPS 证书..."
sudo certbot --nginx \
  -d sankengcloset.icu \
  -d www.sankengcloset.icu \
  -d api.sankengcloset.icu \
  -d admin.sankengcloset.icu \
  --non-interactive \
  --agree-tos \
  --email admin@sankengcloset.icu

# 5. 验证证书自动续期
echo "5. 验证证书自动续期..."
sudo certbot renew --dry-run

# 6. 最终验证
echo "6. 最终验证..."
echo "   Nginx 状态:"
sudo systemctl status nginx --no-pager | head -5

echo "   端口检查:"
sudo ss -lntp | grep -E "8055|8787|5432|6379" || echo "   所有敏感端口未暴露公网"

echo "   HTTP 访问测试:"
curl -sI https://www.sankengcloset.icu 2>&1 | head -3
curl -sI https://api.sankengcloset.icu 2>&1 | head -3
curl -sI https://admin.sankengcloset.icu 2>&1 | head -3

echo ""
echo "=== Phase D2.5 完成 ==="
echo "管理后台: https://admin.sankengcloset.icu"
echo "API: https://api.sankengcloset.icu"
echo "主域名: https://www.sankengcloset.icu"
