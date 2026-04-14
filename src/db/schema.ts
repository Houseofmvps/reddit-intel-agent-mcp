/**
 * Database schema — Drizzle ORM + PostgreSQL
 * Includes Better Auth tables + BuildRadar application tables
 */

import { pgTable, text, timestamp, boolean, integer, jsonb, real } from 'drizzle-orm/pg-core';

// ── Better Auth core tables ──

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  tier: text('tier').notNull().default('free'), // 'free' | 'pro'
  polarCustomerId: text('polar_customer_id'),
  composioEntityId: text('composio_entity_id'), // Composio user/entity ID for tool execution
  composioConnectedAccountId: text('composio_connected_account_id'), // Composio connected account ID for status checks
  emailAlertsEnabled: boolean('email_alerts_enabled').notNull().default(true),
  dailyDigestEnabled: boolean('daily_digest_enabled').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ── BuildRadar application tables ──

export const redditCredentials = pgTable('reddit_credentials', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull(), // encrypted
  clientSecret: text('client_secret').notNull(), // encrypted
  username: text('username'), // encrypted, nullable
  password: text('password'), // encrypted, nullable
  rateLimit: integer('rate_limit').notNull().default(60), // detected rate limit
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const redditOAuthConnection = pgTable('reddit_oauth_connection', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().unique().references(() => user.id, { onDelete: 'cascade' }),
  redditUsername: text('reddit_username').notNull(),
  accessToken: text('access_token').notNull(), // encrypted
  refreshToken: text('refresh_token').notNull(), // encrypted
  scope: text('scope').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  status: text('status').notNull().default('active'), // 'active' | 'revoked'
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const monitor = pgTable('monitor', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  subreddits: jsonb('subreddits').notNull().$type<string[]>(),
  keywords: jsonb('keywords').notNull().$type<string[]>(),
  signalTypes: jsonb('signal_types').notNull().$type<string[]>(),
  alertChannel: text('alert_channel').notNull().default('email'), // 'email' | 'slack'
  slackWebhookUrl: text('slack_webhook_url'),
  active: boolean('active').notNull().default(true),
  lastScannedAt: timestamp('last_scanned_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const scanResult = pgTable('scan_result', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  monitorId: text('monitor_id').notNull().references(() => monitor.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  score: integer('score').notNull(), // 0-100 internally
  title: text('title').notNull(),
  subreddit: text('subreddit').notNull(),
  signals: jsonb('signals').notNull().$type<string[]>(),
  quote: text('quote'),
  suggestedReply: text('suggested_reply'),
  redditUrl: text('reddit_url'),
  upvotes: integer('upvotes').default(0),
  comments: integer('comments').default(0),
  data: jsonb('data'), // full tool output
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const lead = pgTable('lead', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  redditUsername: text('reddit_username').notNull(),
  signalCount: integer('signal_count').notNull().default(1),
  status: text('status').notNull().default('new'), // 'new' | 'contacted' | 'converted'
  notes: text('notes'), // free-form notes, nullable
  subreddits: jsonb('subreddits').notNull().$type<string[]>(),
  firstSeen: timestamp('first_seen').notNull().defaultNow(),
  lastActive: timestamp('last_active').notNull().defaultNow(),
});

export const leadDossier = pgTable('lead_dossier', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  leadId: text('lead_id').references(() => lead.id),
  userId: text('user_id').notNull().references(() => user.id),
  redditUsername: text('reddit_username').notNull(),
  conversionScore: integer('conversion_score').notNull().default(0),
  conversionLabel: text('conversion_label').notNull().default('cold'),
  triggerPost: jsonb('trigger_post').notNull(),
  painPoints: jsonb('pain_points').notNull().default([]),
  budgetSignals: jsonb('budget_signals').notNull().default([]),
  intentType: text('intent_type').notNull(),
  urgency: text('urgency').notNull().default('exploring'),
  userContext: jsonb('user_context').notNull().default({}),
  threadAge: integer('thread_age').notNull().default(0),
  replyWindow: integer('reply_window').notNull().default(0),
  commentVelocity: real('comment_velocity').notNull().default(0),
  recommendedApproach: text('recommended_approach').notNull(),
  draftReply: text('draft_reply').notNull(),
  status: text('status').notNull().default('pending'),
  repliedAt: timestamp('replied_at'),
  convertedAt: timestamp('converted_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const conversionEvent = pgTable('conversion_event', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  dossierId: text('dossier_id').notNull().references(() => leadDossier.id),
  userId: text('user_id').notNull().references(() => user.id),
  fromStatus: text('from_status').notNull(),
  toStatus: text('to_status').notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const generatedReply = pgTable('generated_reply', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  resultId: text('result_id').notNull().references(() => scanResult.id, { onDelete: 'cascade' }),
  tone: text('tone').notNull(),
  replyText: text('reply_text').notNull(),
  model: text('model').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const subredditPlaybook = pgTable('subreddit_playbook', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  subreddit: text('subreddit').notNull().unique(), // stored without "r/" prefix
  selfPromoAllowed: text('self_promo_allowed').notNull().default('unknown'), // 'yes' | 'flair' | 'no' | 'unknown'
  communityTone: text('community_tone').notNull().default('mixed'), // 'technical' | 'founder' | 'consumer' | 'mixed'
  banRiskLevel: text('ban_risk_level').notNull().default('medium'), // 'low' | 'medium' | 'high'
  bestTimeToEngage: text('best_time_to_engage'), // e.g. "Tue-Thu, 9am-12pm ET"
  avgRepliesPerPost: integer('avg_replies_per_post').default(5),
  exampleMention: text('example_mention'), // real post title showing successful founder mention
  insightSummary: text('insight_summary'), // 2-3 sentence paragraph on how to engage
  selfPromoNotes: text('self_promo_notes'), // specific rules or gotchas about self-promotion
  topTopics: jsonb('top_topics').notNull().default([]).$type<string[]>(),
  lastAnalyzedAt: timestamp('last_analyzed_at').notNull().defaultNow(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const trackingLink = pgTable('tracking_link', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  hash: text('hash').notNull().unique(),          // e.g. "a3f9b2c1" — forms /r/a3f9b2c1
  destinationUrl: text('destination_url').notNull(),
  clickCount: integer('click_count').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const outreachLog = pgTable('outreach_log', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  resultId: text('result_id').references(() => scanResult.id, { onDelete: 'set null' }),
  subreddit: text('subreddit').notNull(),
  postTitle: text('post_title').notNull(),
  postUrl: text('post_url'),
  tone: text('tone').notNull(),
  replyText: text('reply_text').notNull(),
  trackingLinkId: text('tracking_link_id').references(() => trackingLink.id, { onDelete: 'set null' }),
  postedAt: timestamp('posted_at').notNull().defaultNow(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const linkClick = pgTable('link_click', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  trackingLinkId: text('tracking_link_id').notNull().references(() => trackingLink.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  referrer: text('referrer'),
  userAgent: text('user_agent'),
  ip: text('ip'),   // SHA-256 hashed, first 16 chars only
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const warmupPlan = pgTable('warmup_plan', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().unique().references(() => user.id, { onDelete: 'cascade' }),
  startedAt: timestamp('started_at').notNull().defaultNow(),
  completedDays: jsonb('completed_days').notNull().default([]).$type<number[]>(),
  targetSubreddits: jsonb('target_subreddits').notNull().default([]).$type<string[]>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const marketSnapshot = pgTable('market_snapshot', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => user.id),
  monitorId: text('monitor_id').notNull().references(() => monitor.id),
  period: text('period').notNull(),
  totalMentions: integer('total_mentions').notNull().default(0),
  intentSignals: integer('intent_signals').notNull().default(0),
  topPainPoints: jsonb('top_pain_points').notNull().default([]),
  topSubreddits: jsonb('top_subreddits').notNull().default([]),
  trendDirection: text('trend_direction').notNull().default('stable'),
  weekOverWeekChange: real('week_over_week_change').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
