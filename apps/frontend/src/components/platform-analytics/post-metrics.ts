// Shared helpers for reading the per-post numbers. Used by the analytics table
// and by the statistics modal in the calendar, so both label a retention curve
// the same way.

// Where we read the retention curve. Three quarters of the video is the point
// we compare creatives at - a hook that survives to there is a hook that works.
export const RETENTION_MARK = 0.75;

type RetentionPoint = { second: number; ratio: number };

/**
 * Share of viewers still watching at a given fraction of the video.
 *
 * Platforms disagree on the horizontal axis: Facebook reports whole seconds,
 * YouTube a 0..1 fraction of the length. Both are normalized here so one column
 * can hold either, and the value is interpolated between the two nearest points
 * rather than snapped to one of them.
 */
export const retentionAt = (
  retention: RetentionPoint[] | undefined,
  mark: number
): number | null => {
  if (!Array.isArray(retention) || retention.length < 2) {
    return null;
  }

  const points = [...retention]
    .filter((p) => typeof p?.second === 'number' && typeof p?.ratio === 'number')
    .sort((a, b) => a.second - b.second);

  if (points.length < 2) {
    return null;
  }

  const last = points[points.length - 1].second;
  if (!last) {
    return null;
  }

  // An axis that never passes 1 is already a fraction of the length.
  const scale = last <= 1 ? 1 : last;
  const target = mark * scale;

  const after = points.find((p) => p.second >= target);
  if (!after) {
    return points[points.length - 1].ratio;
  }

  const before = [...points].reverse().find((p) => p.second <= target);
  if (!before || before.second === after.second) {
    return after.ratio;
  }

  const position =
    (target - before.second) / (after.second - before.second);

  return before.ratio + (after.ratio - before.ratio) * position;
};

/** Milliseconds as something readable: "8,4 s" below a minute, "1:23" above. */
export const formatWatchTime = (ms?: number): string => {
  if (typeof ms !== 'number' || !isFinite(ms)) {
    return '-';
  }

  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1).replace('.', ',')} s`;
  }

  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);

  return `${minutes}:${String(rest).padStart(2, '0')}`;
};
