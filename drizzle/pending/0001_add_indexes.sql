-- Performance indexes for high-traffic queries
-- All queries filter/sort by user_id or created_at on these tables

CREATE INDEX IF NOT EXISTS "idx_scan_result_user_id" ON "scan_result" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_scan_result_user_created" ON "scan_result" ("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_scan_result_monitor_id" ON "scan_result" ("monitor_id");

CREATE INDEX IF NOT EXISTS "idx_monitor_user_id" ON "monitor" ("user_id");

CREATE INDEX IF NOT EXISTS "idx_lead_user_id" ON "lead" ("user_id");

CREATE INDEX IF NOT EXISTS "idx_session_user_id" ON "session" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_session_expires_at" ON "session" ("expires_at");

CREATE INDEX IF NOT EXISTS "idx_generated_reply_user_result" ON "generated_reply" ("user_id", "result_id");
CREATE INDEX IF NOT EXISTS "idx_generated_reply_created" ON "generated_reply" ("created_at");

CREATE INDEX IF NOT EXISTS "idx_outreach_log_user_id" ON "outreach_log" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_outreach_log_created" ON "outreach_log" ("posted_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_warmup_plan_user_id" ON "warmup_plan" ("user_id");

CREATE INDEX IF NOT EXISTS "idx_tracking_link_user_id" ON "tracking_link" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_link_click_link_id" ON "link_click" ("tracking_link_id");

CREATE INDEX IF NOT EXISTS "idx_subreddit_playbook_subreddit" ON "subreddit_playbook" ("subreddit");
