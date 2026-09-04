-- ============================================================
-- 0014_feedback.sql — Phase 2.6 意见反馈
-- feedback_records 表：v2.6 意见反馈页（匿名可提交，登录用户记录 userId）
-- 纯增量：建表 + 索引，可重复执行（IF NOT EXISTS）
-- ============================================================

CREATE TABLE IF NOT EXISTS feedback_records (
  id          text PRIMARY KEY,
  user_id     text,                            -- 可空：匿名反馈不强制登录
  type        text NOT NULL DEFAULT '',        -- 功能建议 / 问题反馈 / 内容纠错 / 其他
  content     text NOT NULL DEFAULT '',
  contact     text NOT NULL DEFAULT '',        -- 联系方式（预留）
  images      jsonb NOT NULL DEFAULT '[]',     -- 图片（本地临时路径，Mock 阶段不持久化大图）
  status      text NOT NULL DEFAULT 'open',    -- open / resolved
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

CREATE INDEX IF NOT EXISTS feedback_records_user_idx
  ON feedback_records (user_id)
  WHERE deleted_at IS NULL;
