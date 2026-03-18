/**
 * Reddit Intelligence Agent — Shared type definitions
 */

// ─── Reddit API Types ───────────────────────────────────────────

export interface RedditPost {
  id: string;
  title: string;
  author: string;
  subreddit: string;
  subreddit_name_prefixed: string;
  score: number;
  num_comments: number;
  created_utc: number;
  selftext?: string;
  url: string;
  permalink: string;
  is_video?: boolean;
  is_self?: boolean;
  over_18?: boolean;
  stickied?: boolean;
  locked?: boolean;
  link_flair_text?: string;
  author_flair_text?: string;
  distinguished?: string;
  ups: number;
  downs: number;
  upvote_ratio?: number;
}

export interface RedditComment {
  id: string;
  author: string;
  body: string;
  score: number;
  created_utc: number;
  permalink: string;
  depth: number;
  replies?: RedditComment[];
  distinguished?: string;
  is_submitter?: boolean;
  stickied?: boolean;
  controversiality?: number;
}

export interface RedditUser {
  name: string;
  created_utc: number;
  link_karma: number;
  comment_karma: number;
  is_gold?: boolean;
  is_mod?: boolean;
  verified?: boolean;
  has_verified_email?: boolean;
  icon_img?: string;
  subreddit?: {
    display_name: string;
    public_description: string;
    subscribers: number;
  };
}

export interface RedditSubreddit {
  display_name: string;
  display_name_prefixed: string;
  title: string;
  public_description: string;
  description: string;
  subscribers: number;
  active_user_count?: number;
  created_utc: number;
  over18: boolean;
  subreddit_type: 'public' | 'private' | 'restricted' | 'gold_restricted' | 'archived';
}

export interface RedditListing<T> {
  kind: string;
  data: {
    after?: string | null;
    before?: string | null;
    children: Array<{
      kind: string;
      data: T;
    }>;
    dist?: number;
  };
}

// ─── Formatted Output Types ─────────────────────────────────────

export interface FormattedPost {
  id: string;
  title: string;
  author: string;
  score: number;
  upvote_ratio?: number;
  num_comments: number;
  created_utc: number;
  url: string;
  permalink: string;
  subreddit: string;
  is_video?: boolean;
  is_text_post?: boolean;
  content?: string;
  nsfw?: boolean;
  stickied?: boolean;
  flair?: string;
}

export interface FormattedComment {
  id: string;
  author: string;
  score: number;
  body: string;
  created_utc: number;
  depth: number;
  is_op?: boolean;
  permalink: string;
}

// ─── Intelligence Types ─────────────────────────────────────────

export interface PainPoint {
  text: string;
  source_url: string;
  subreddit: string;
  score: number;
  num_comments: number;
  recency_days: number;
  author: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  signals: string[];
  opportunity_hint?: string;
}

export interface Workaround {
  description: string;
  tools_mentioned: string[];
  frustration_level: 'low' | 'medium' | 'high';
  source_url: string;
  subreddit: string;
  upvotes: number;
  author: string;
  signals: string[];
}

export interface OpportunityScore {
  total: number;
  breakdown: {
    pain_frequency: number;
    pain_severity: number;
    workaround_prevalence: number;
    competition_weakness: number;
    recency: number;
    subreddit_quality: number;
    noise_penalty: number;
  };
  confidence: 'low' | 'medium' | 'high';
  verdict: string;
  evidence_count: number;
}

export interface SignalScore {
  total: number;
  breakdown: {
    mention_volume: number;
    sentiment_polarity: number;
    feature_request_frequency: number;
    switching_intent: number;
    price_sensitivity: number;
    recency: number;
  };
}

export interface LeadSignal {
  username: string;
  post_url: string;
  post_title: string;
  subreddit: string;
  intent_score: number;
  signals: string[];
  budget_hints: string[];
  urgency: 'low' | 'medium' | 'high';
  created_utc: number;
}

export interface EvidencePack {
  title: string;
  generated_at: string;
  summary: string;
  sections: EvidenceSection[];
  urls_cited: number;
  data_points: number;
}

export interface EvidenceSection {
  heading: string;
  findings: Array<{
    text: string;
    source_url: string;
    subreddit: string;
    score: number;
    date: string;
  }>;
}

// ─── Tier Types ─────────────────────────────────────────────────

export type ProductTier = 'free' | 'pro' | 'team';

export type AuthMode = 'anonymous' | 'app-only' | 'authenticated';

export interface AuthConfig {
  clientId: string;
  clientSecret: string;
  username?: string;
  password?: string;
  accessToken?: string;
  expiresAt?: number;
  scope?: string;
  userAgent?: string;
}

// ─── Tool Meta Types ────────────────────────────────────────────

export type ToolTier = 'free' | 'pro' | 'team';

export interface ToolDefinition {
  name: string;
  description: string;
  tier: ToolTier;
  category: 'retrieval' | 'intelligence' | 'export';
}
