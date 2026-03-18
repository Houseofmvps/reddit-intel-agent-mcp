/**
 * Reddit Intelligence Agent — Retrieval tools (free tier)
 *
 * Tools: browse_subreddit, search_reddit, post_details, user_profile
 */

import { z } from 'zod';
import { RedditClient } from '../reddit/client.js';
import { formatPost, formatComment } from '../reddit/formatter.js';
import {
  browseSubredditSchema,
  searchRedditSchema,
  postDetailsSchema,
  userProfileSchema,
} from './schemas.js';

export class RetrievalTools {
  constructor(private reddit: RedditClient) {}

  async browseSubreddit(params: z.infer<typeof browseSubredditSchema>) {
    const listing = await this.reddit.browseSubreddit(params.subreddit, params.sort, {
      limit: params.limit,
      time: params.time,
    });

    let children = listing.data.children;
    if (!params.include_nsfw) {
      children = children.filter(c => !c.data.over_18);
    }

    const posts = children.map(c => formatPost(c.data));

    const result: Record<string, unknown> = { posts, total_posts: posts.length };

    if (params.include_subreddit_info) {
      try {
        const info = await this.reddit.getSubredditInfo(params.subreddit);
        result.subreddit_info = {
          name: info.display_name,
          subscribers: info.subscribers,
          description: info.public_description || info.description,
          type: info.subreddit_type,
          created: new Date(info.created_utc * 1000).toISOString(),
          nsfw: info.over18,
        };
      } catch {
        // non-critical — continue without it
      }
    }

    return result;
  }

  async searchReddit(params: z.infer<typeof searchRedditSchema>) {
    let allChildren: Array<{ kind: string; data: import('../types/index.js').RedditPost }>;

    if (params.subreddits && params.subreddits.length > 0) {
      if (params.subreddits.length === 1) {
        const res = await this.reddit.search(params.query, {
          subreddit: params.subreddits[0],
          sort: params.sort,
          time: params.time,
          limit: params.limit,
        });
        allChildren = res.data.children;
      } else {
        const perSub = Math.ceil(params.limit / params.subreddits.length);
        const results = await Promise.allSettled(
          params.subreddits.map(sub =>
            this.reddit.search(params.query, { subreddit: sub, sort: params.sort, time: params.time, limit: perSub }),
          ),
        );
        allChildren = results
          .filter((r): r is PromiseFulfilledResult<import('../types/index.js').RedditListing<import('../types/index.js').RedditPost>> => r.status === 'fulfilled')
          .flatMap(r => r.value.data.children);

        if (allChildren.length === 0) {
          const failed = params.subreddits.filter((_, i) => results[i].status === 'rejected');
          throw new Error(`Search failed for all subreddits: ${failed.join(', ')}`);
        }
      }
    } else {
      const res = await this.reddit.search(params.query, {
        sort: params.sort,
        time: params.time,
        limit: params.limit,
      });
      allChildren = res.data.children;
    }

    // Post-filter by author and flair
    if (params.author) {
      allChildren = allChildren.filter(c => c.data.author.toLowerCase() === params.author!.toLowerCase());
    }
    if (params.flair) {
      allChildren = allChildren.filter(c => c.data.link_flair_text?.toLowerCase().includes(params.flair!.toLowerCase()));
    }

    const posts = allChildren.map(c => formatPost(c.data));
    return { results: posts, total_results: posts.length };
  }

  async postDetails(params: z.infer<typeof postDetailsSchema>) {
    let identifier: string;
    if (params.url) {
      identifier = RedditClient.extractPostIdFromUrl(params.url);
    } else if (params.post_id) {
      identifier = params.subreddit ? `${params.subreddit}_${params.post_id}` : params.post_id;
    } else {
      throw new Error('Provide either url OR post_id');
    }

    const [postListing, commentsListing] = await this.reddit.getPost(identifier, {
      limit: params.comment_limit,
      sort: params.comment_sort,
      depth: params.comment_depth,
    });

    const post = formatPost(postListing.data.children[0].data);
    // Expand content for detail view
    const rawPost = postListing.data.children[0].data;
    if (rawPost.selftext) {
      (post as unknown as Record<string, unknown>).content = rawPost.selftext.substring(0, 2000);
    }

    const comments = commentsListing.data.children
      .filter(c => c.kind === 't1')
      .map(c => formatComment(c.data));

    const result: Record<string, unknown> = {
      post,
      total_comments: comments.length,
      top_comments: comments.slice(0, params.max_top_comments),
    };

    if (params.extract_links) {
      const links = new Set<string>();
      for (const c of commentsListing.data.children) {
        if (c.kind === 't1') {
          const urls = (c.data.body ?? '').match(/https?:\/\/[^\s)>\]]+/g) ?? [];
          urls.forEach(u => links.add(u));
        }
      }
      result.extracted_links = [...links];
    }

    return result;
  }

  async userProfile(params: z.infer<typeof userProfileSchema>) {
    const user = await this.reddit.getUser(params.username);
    const sort = params.time_range === 'all' ? 'new' : 'top';

    let posts = null;
    let comments = null;
    let usedFallback = false;

    if (params.posts_limit > 0) {
      posts = await this.reddit.getUserContent(params.username, 'submitted', {
        limit: params.posts_limit,
        sort,
        time: params.time_range,
      });
      if (posts.data.children.length === 0 && params.time_range !== 'all') {
        usedFallback = true;
        posts = await this.reddit.getUserContent(params.username, 'submitted', {
          limit: params.posts_limit,
          sort: 'new',
          time: 'all',
        });
      }
    }

    if (params.comments_limit > 0) {
      comments = await this.reddit.getUserContent(params.username, 'comments', {
        limit: params.comments_limit,
        sort,
        time: params.time_range,
      });
      if (comments.data.children.length === 0 && params.time_range !== 'all') {
        usedFallback = true;
        comments = await this.reddit.getUserContent(params.username, 'comments', {
          limit: params.comments_limit,
          sort: 'new',
          time: 'all',
        });
      }
    }

    // Build subreddit activity map
    const subActivity = new Map<string, { posts: number; karma: number }>();
    if (posts) {
      for (const c of posts.data.children) {
        const d = c.data as unknown as Record<string, unknown>;
        const sub = (d.subreddit as string) ?? 'unknown';
        const existing = subActivity.get(sub) ?? { posts: 0, karma: 0 };
        existing.posts++;
        existing.karma += (d.score as number) ?? 0;
        subActivity.set(sub, existing);
      }
    }

    const topSubreddits = [...subActivity.entries()]
      .map(([name, stats]) => ({ name, ...stats }))
      .sort((a, b) => b.karma - a.karma)
      .slice(0, params.top_subreddits_limit);

    const accountAge = new Date(user.created_utc * 1000);
    const ageYears = (Date.now() - accountAge.getTime()) / (365.25 * 24 * 3600_000);

    const result: Record<string, unknown> = {
      username: user.name,
      account_age: ageYears > 1 ? `${Math.floor(ageYears)} years` : `${Math.floor(ageYears * 12)} months`,
      karma: {
        link: user.link_karma ?? 0,
        comment: user.comment_karma ?? 0,
        total: (user.link_karma ?? 0) + (user.comment_karma ?? 0),
      },
      top_subreddits: topSubreddits,
    };

    if (posts && posts.data.children.length > 0) {
      result.recent_posts = posts.data.children.map(c => formatPost(c.data as import('../types/index.js').RedditPost));
    }
    if (comments && comments.data.children.length > 0) {
      result.recent_comments = comments.data.children
        .filter(c => c.data && (c.data as unknown as Record<string, unknown>).body)
        .map(c => {
          const d = c.data as unknown as Record<string, unknown>;
          return {
            id: d.id,
            body: ((d.body as string) ?? '').substring(0, 200),
            score: d.score ?? 0,
            subreddit: d.subreddit ?? 'unknown',
            post_title: d.link_title ?? '',
            url: d.permalink ? `https://reddit.com${d.permalink}` : null,
          };
        });
    }
    if (usedFallback) {
      result.note = `No posts found in last ${params.time_range} — showing all recent activity instead`;
    }

    return result;
  }

  // ─── reddit_explain ──────────────────────────────────────────

  async redditExplain(params: { term: string }) {
    const term = params.term.toLowerCase().trim();

    const glossary: Record<string, { definition: string; example?: string }> = {
      'karma': { definition: 'Points earned from upvotes on your posts and comments. Post karma and comment karma are tracked separately. Karma has no monetary value but indicates community standing.', example: 'A post with 500 upvotes gives you ~500 post karma.' },
      'upvote': { definition: 'Clicking the up arrow on a post or comment to signal approval. Adds to the content\'s score and the author\'s karma.' },
      'downvote': { definition: 'Clicking the down arrow to signal disapproval. Reduces the content\'s score. Meant for off-topic content, not disagreement.' },
      'cake day': { definition: 'The anniversary of when you created your Reddit account. A cake icon appears next to your username on that day.' },
      'cakeday': { definition: 'Same as "cake day" — your Reddit account anniversary.' },
      'ama': { definition: 'Ask Me Anything — a Q&A format where someone (often a celebrity, expert, or interesting person) invites Reddit to ask them questions.', example: 'Barack Obama did an AMA in 2012 that crashed Reddit\'s servers.' },
      'eli5': { definition: 'Explain Like I\'m 5 — asking for a simple explanation of a complex topic. Also a popular subreddit (r/explainlikeimfive).' },
      'til': { definition: 'Today I Learned — sharing an interesting fact you just discovered. Also a subreddit (r/todayilearned).' },
      'op': { definition: 'Original Poster — the person who created the post or thread.' },
      'tldr': { definition: 'Too Long, Didn\'t Read — a brief summary of a long post, usually placed at the top or bottom.' },
      'tl;dr': { definition: 'Same as TLDR — a brief summary of a long post.' },
      'flair': { definition: 'Tags or labels that appear next to usernames or post titles. Set by mods or users. Post flair categorizes content; user flair shows your status in a subreddit.' },
      'mod': { definition: 'Moderator — a volunteer who manages a subreddit by enforcing rules, removing posts, and banning users. Not Reddit employees.' },
      'admin': { definition: 'A Reddit employee who manages the entire platform. Different from moderators who only manage specific subreddits.' },
      'subreddit': { definition: 'A community on Reddit focused on a specific topic, identified by r/ prefix (e.g., r/startups). Anyone can create one.', example: 'r/technology has 15M+ subscribers discussing tech news.' },
      'crosspost': { definition: 'Sharing a post from one subreddit to another, giving credit to the original. Shows the original post embedded in the new one.' },
      'repost': { definition: 'Posting content that has already been shared before. Often frowned upon but sometimes acceptable if the content is old.' },
      'gilded': { definition: 'A post or comment that received a Reddit Gold award (now called Reddit Premium awards). Shows as a gold icon.' },
      'award': { definition: 'Virtual badges you can give to posts/comments you appreciate. Some are free, others cost Reddit Coins. Examples: Gold, Silver, Helpful.' },
      'reddit gold': { definition: 'A premium award that gives the recipient ad-free browsing and access to r/lounge for a week. Costs real money to give.' },
      'reddit premium': { definition: 'Reddit\'s paid subscription ($6.99/mo). Removes ads, gives monthly coins, and access to r/lounge.' },
      'throwaway': { definition: 'A temporary account created to post anonymously, usually for sensitive topics. Common in r/relationships and r/confession.' },
      'lurker': { definition: 'Someone who reads Reddit without posting or commenting. Estimated to be 90%+ of Reddit users.' },
      'shill': { definition: 'Accusation that someone is secretly promoting a product or agenda while pretending to be a regular user.' },
      'brigading': { definition: 'When users from one subreddit coordinate to mass-vote or comment in another subreddit. Violates Reddit rules.' },
      'shadowban': { definition: 'A ban where the user doesn\'t know they\'re banned. Their posts and comments are invisible to everyone else but appear normal to them.' },
      'ban': { definition: 'Being prohibited from posting in a subreddit (subreddit ban) or the entire site (site-wide ban by admins).' },
      'nsfw': { definition: 'Not Safe For Work — content that is inappropriate for professional settings. Posts are blurred by default.' },
      'oc': { definition: 'Original Content — content created by the poster, not sourced from elsewhere. Encouraged in most subreddits.' },
      'imo': { definition: 'In My Opinion — disclaimer that the statement is personal opinion.' },
      'imho': { definition: 'In My Humble Opinion — same as IMO but with added humility.' },
      'ftfy': { definition: 'Fixed That For You — used when "correcting" someone else\'s statement, often humorously.' },
      'iirc': { definition: 'If I Recall Correctly — hedging that your memory might not be perfect.' },
      'dae': { definition: 'Does Anyone Else — asking if others share your experience or opinion.' },
      'meta': { definition: 'Posts about the subreddit itself rather than the subreddit\'s topic. E.g., discussing rules or trends within the community.' },
      'reddiquette': { definition: 'The informal guidelines for Reddit behavior: upvote good content, don\'t downvote disagreements, be civil, don\'t spam.' },
      'this': { definition: 'A reply simply saying "this" to express strong agreement. Generally discouraged as low-effort.' },
      'bot': { definition: 'An automated account that performs tasks like auto-moderating, posting summaries, or detecting reposts.' },
      'sticky': { definition: 'A post pinned to the top of a subreddit by moderators. Usually for announcements or megathreads.' },
      'megathread': { definition: 'A single large discussion thread for a major topic, consolidating what would otherwise be many separate posts.' },
      'edit': { definition: 'When a user modifies their post/comment after publishing. Convention is to note what was changed with "Edit:" at the bottom.' },
      'reddit api': { definition: 'Reddit\'s programming interface that allows developers to build apps, bots, and tools that interact with Reddit data.' },
    };

    // Exact match
    const entry = glossary[term] ?? glossary[term.replace(/[^a-z0-9]/g, '')];
    if (entry) {
      return {
        term: params.term,
        definition: entry.definition,
        example: entry.example ?? null,
        related_subreddits: this.getRelatedSubreddits(term),
      };
    }

    // Fuzzy match — check if any key contains the term
    for (const [key, val] of Object.entries(glossary)) {
      if (key.includes(term) || term.includes(key)) {
        return {
          term: params.term,
          matched: key,
          definition: val.definition,
          example: val.example ?? null,
          related_subreddits: this.getRelatedSubreddits(key),
        };
      }
    }

    return {
      term: params.term,
      definition: null,
      suggestion: `"${params.term}" is not in our glossary. Try searching Reddit with: search_reddit({ query: "what is ${params.term} reddit" })`,
      available_terms: Object.keys(glossary).sort(),
    };
  }

  private getRelatedSubreddits(term: string): string[] {
    const map: Record<string, string[]> = {
      'ama': ['r/IAmA', 'r/AMA', 'r/casualiama'],
      'eli5': ['r/explainlikeimfive'],
      'til': ['r/todayilearned'],
      'meta': ['r/TheoryOfReddit', 'r/help'],
      'mod': ['r/modhelp', 'r/ModSupport'],
      'nsfw': ['r/nsfw (18+)'],
      'reddit api': ['r/redditdev'],
      'reddiquette': ['r/help', 'r/newtoreddit'],
    };
    return map[term] ?? [];
  }
}
