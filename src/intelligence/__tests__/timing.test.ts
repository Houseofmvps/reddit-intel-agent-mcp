import { describe, it, expect } from 'vitest';
import { calculateReplyWindow, getCommentVelocity, getTimingLabel, analyzeThreadTiming } from '../timing.js';

describe('Thread Timing Engine', () => {
  it('should calculate reply window from post age', () => {
    const window = calculateReplyWindow(30);  // 30 min old
    expect(window).toBe(150);  // 150 min left in 3hr window
  });

  it('should return 0 when window has passed', () => {
    const window = calculateReplyWindow(200);
    expect(window).toBe(0);
  });

  it('should calculate comment velocity', () => {
    const velocity = getCommentVelocity(12, 60);  // 12 comments in 60 min
    expect(velocity).toBe(12);  // 12 comments/hour
  });

  it('should handle zero age gracefully', () => {
    const velocity = getCommentVelocity(5, 0);
    expect(velocity).toBe(0);
  });

  it('should label timing urgency correctly', () => {
    expect(getTimingLabel(30, 3)).toBe('immediate');    // Fresh, low comments
    expect(getTimingLabel(120, 50)).toBe('this-week');   // Older, high comments
    expect(getTimingLabel(300, 100)).toBe('exploring');   // Too old
  });

  it('should produce full timing analysis', () => {
    const result = analyzeThreadTiming({
      created_utc: Date.now() / 1000 - 1800,  // 30 min ago
      num_comments: 3,
    });
    expect(result.threadAgeMinutes).toBeGreaterThanOrEqual(29);
    expect(result.replyWindowMinutes).toBeGreaterThan(0);
    expect(result.commentVelocity).toBeGreaterThanOrEqual(0);
    expect(result.urgency).toBe('immediate');
    expect(result.isLowNoise).toBe(true);
  });
});
