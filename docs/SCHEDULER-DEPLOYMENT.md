# Phase D9：定时采集与监控部署说明

## 调度频率建议

| 来源 | 频率 | 理由 |
|------|------|------|
| 品牌官网 | 每 6 小时 | 商品更新不频繁 |
| 微博品牌账号 | 每 12 小时 | 品牌动态中低频 |
| 微信公众号 | 每 24 小时 | 文章发布低频 |
| 图片失败重试 | 每日 | 网络波动恢复 |
| 失效链接检查 | 每周 | 非紧急 |

## 手工触发

```bash
# 通过 API 手工触发
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:8787/api/admin/scheduler/tasks/task_official/trigger
```

## 来源暂停/恢复

```bash
# 暂停微博来源
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:8787/api/admin/scheduler/source/WEIBO/pause

# 恢复
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:8787/api/admin/scheduler/source/WEIBO/resume
```

## 健康检查

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8787/api/admin/health
```

## 告警配置

### Telegram Bot

```bash
# 设置环境变量
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
```

### 日志

所有告警默认输出到 console，可通过 PM2/systemd 重定向到文件。

## 安全说明

- 调度 API 需要管理员 Token
- 不得暴露在公网
- 密钥通过环境变量配置
- 日志保留 30 天
- 服务器重启后需手动启动调度器
