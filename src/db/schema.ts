/**
 * Database schema — Drizzle ORM + PostgreSQL
 * Includes Better Auth tables + BuildRadar application tables
 */

import { pgTable, text, timestamp, boolean, integer, jsonb } from 'drizzle-orm/pg-core';

// ── Better Auth core tables ──

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  tier: text('tier').notNull().default('free'), // 'free' | 'pro'
  polarCustomerId: text('polar_customer_id'),
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

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at'),
  updatedAt: timestamp('updated_at'),
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
  subreddits: jsonb('subreddits').notNull().$type<string[]>(),
  firstSeen: timestamp('first_seen').notNull().defaultNow(),
  lastActive: timestamp('last_active').notNull().defaultNow(),
});
