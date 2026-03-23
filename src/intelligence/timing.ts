const OPTIMAL_WINDOW_MINUTES = 180;

export function calculateReplyWindow(postAgeMinutes: number): number {
  return Math.max(0, OPTIMAL_WINDOW_MINUTES - postAgeMinutes);
}

export function getCommentVelocity(commentCount: number, postAgeMinutes: number): number {
  if (postAgeMinutes <= 0) return 0;
  return Math.round((commentCount / postAgeMinutes) * 60);
}

export function getTimingLabel(
  postAgeMinutes: number,
  commentCount: number
): 'immediate' | 'this-week' | 'exploring' {
  const windowLeft = calculateReplyWindow(postAgeMinutes);
  if (windowLeft > 60 && commentCount < 10) return 'immediate';
  if (windowLeft > 0 && commentCount < 75) return 'this-week';
  return 'exploring';
}

export function analyzeThreadTiming(post: {
  created_utc: number;
  num_comments: number;
}): {
  threadAgeMinutes: number;
  replyWindowMinutes: number;
  commentVelocity: number;
  urgency: 'immediate' | 'this-week' | 'exploring';
  isLowNoise: boolean;
} {
  const ageMinutes = Math.floor((Date.now() / 1000 - post.created_utc) / 60);
  const window = calculateReplyWindow(ageMinutes);
  const velocity = getCommentVelocity(post.num_comments, ageMinutes);
  const urgency = getTimingLabel(ageMinutes, post.num_comments);
  return {
    threadAgeMinutes: ageMinutes,
    replyWindowMinutes: window,
    commentVelocity: velocity,
    urgency,
    isLowNoise: post.num_comments < 10,
  };
}
