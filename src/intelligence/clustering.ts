/**
 * Reddit Intelligence Agent — Simple text clustering
 *
 * Groups posts by keyword overlap into thematic clusters.
 * No ML dependencies — uses TF-based keyword extraction and Jaccard similarity.
 */

import type { RedditPost } from '../types/index.js';

export interface Cluster {
  theme: string;
  keywords: string[];
  posts: Array<{ id: string; title: string; url: string; score: number; subreddit: string }>;
  count: number;
  avg_score: number;
}

const STOP_WORDS = new Set([
  'the', 'is', 'at', 'be', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'to', 'for',
  'of', 'with', 'as', 'by', 'this', 'that', 'it', 'its', 'are', 'was', 'were', 'has',
  'have', 'had', 'do', 'does', 'did', 'not', 'no', 'so', 'if', 'my', 'your', 'we',
  'they', 'you', 'he', 'she', 'what', 'which', 'who', 'when', 'where', 'how', 'why',
  'all', 'any', 'can', 'will', 'just', 'from', 'been', 'about', 'would', 'could',
  'should', 'than', 'then', 'also', 'very', 'more', 'most', 'some', 'much', 'many',
  'these', 'those', 'i', 'me', 'here', 'there', 'out', 'up', 'get', 'got', 'like',
  'one', 'two', 'new', 'use', 'using', 'used', 'don', 'doesn', 'didn', 'reddit',
  'anyone', 'everyone', 'someone', 'something', 'anything', 'nothing', 'really',
  'still', 'even', 'going', 'want', 'need', 'know', 'think', 'make', 'way', 'try',
]);

function extractKeywords(text: string, topN = 8): string[] {
  const words = text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));

  const freq = new Map<string, number>();
  for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([w]) => w);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection++;
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

export function clusterPosts(posts: RedditPost[], minSimilarity = 0.2, maxClusters = 10): Cluster[] {
  if (posts.length === 0) return [];

  // Extract keywords per post
  const postKeywords = posts.map(p => ({
    post: p,
    keywords: new Set(extractKeywords(`${p.title} ${p.selftext ?? ''}`)),
  }));

  // Greedy clustering: assign each post to the most similar existing cluster
  const clusters: Array<{
    centroid: Set<string>;
    members: Array<{ post: RedditPost; keywords: Set<string> }>;
  }> = [];

  for (const pk of postKeywords) {
    let bestIdx = -1;
    let bestSim = 0;

    for (let i = 0; i < clusters.length; i++) {
      const sim = jaccard(pk.keywords, clusters[i].centroid);
      if (sim > bestSim && sim >= minSimilarity) {
        bestSim = sim;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      clusters[bestIdx].members.push(pk);
      // Update centroid: union of all member keywords
      for (const kw of pk.keywords) clusters[bestIdx].centroid.add(kw);
    } else if (clusters.length < maxClusters) {
      clusters.push({ centroid: new Set(pk.keywords), members: [pk] });
    }
    // else: drop into the most similar cluster regardless of threshold
    else {
      let fallbackIdx = 0;
      let fallbackSim = 0;
      for (let i = 0; i < clusters.length; i++) {
        const sim = jaccard(pk.keywords, clusters[i].centroid);
        if (sim > fallbackSim) { fallbackSim = sim; fallbackIdx = i; }
      }
      clusters[fallbackIdx].members.push(pk);
    }
  }

  // Format output
  return clusters
    .filter(c => c.members.length > 0)
    .map(c => {
      const topKeywords = [...c.centroid].slice(0, 5);
      const theme = topKeywords.slice(0, 3).join(' + ');
      const totalScore = c.members.reduce((s, m) => s + m.post.score, 0);

      return {
        theme,
        keywords: topKeywords,
        posts: c.members.map(m => ({
          id: m.post.id,
          title: m.post.title,
          url: `https://reddit.com${m.post.permalink}`,
          score: m.post.score,
          subreddit: m.post.subreddit,
        })),
        count: c.members.length,
        avg_score: Math.round(totalScore / c.members.length),
      };
    })
    .sort((a, b) => b.count - a.count);
}
