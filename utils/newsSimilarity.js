const STOP = new Set([
  'the', 'and', 'for', 'with', 'near', 'from', 'into', 'over', 'after', 'before', 'were', 'was', 'are', 'has',
  'have', 'killed', 'injured', 'dead', 'death', 'accident', 'road', 'crash', 'news', 'two', 'three', 'one',
]);

const norm = (s) => String(s || '').trim().toLowerCase();

function tokens(text) {
  const found = String(text || '').toLowerCase().match(/[\p{L}\p{N}\p{M}]+/gu) || [];
  return new Set(found.filter((w) => w.length >= 3 && !STOP.has(w)));
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let both = 0;
  a.forEach((w) => {
    if (b.has(w)) both += 1;
  });
  return both / (a.size + b.size - both);
}

function compare(a, b) {
  const districtA = norm(a.location && a.location.district);
  const districtB = norm(b.location && b.location.district);
  if (!districtA || districtA !== districtB) return null;

  const hours = Math.abs(new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime()) / 3600000;
  if (!Number.isFinite(hours) || hours > 24) return null;

  const titleScore = jaccard(tokens(a.title), tokens(b.title));
  const areaA = norm(a.location && a.location.area);
  const areaB = norm(b.location && b.location.area);
  const sameArea = Boolean(areaA) && areaA === areaB;
  const sameRoad = Boolean(norm(a.road)) && norm(a.road) === norm(b.road);
  const timeScore = Math.max(0, 1 - hours / 24);

  const score = 0.4 * titleScore + 0.2 * (sameArea ? 1 : 0) + 0.25 * timeScore + 0.15 * (sameRoad ? 1 : 0);

  const reasons = ['Same district', hours < 1 ? 'Within an hour' : `${Math.round(hours)} hours apart`];
  if (sameArea) reasons.push('Same upazila');
  if (sameRoad) reasons.push('Same road');
  if (titleScore >= 0.2) reasons.push(`Similar title (${Math.round(titleScore * 100)}%)`);

  return { score, reasons };
}

function findSimilar(post, pool, { threshold = 0.45, limit = 3 } = {}) {
  const out = [];

  for (const other of pool) {
    if (String(other._id) === String(post._id)) continue;
    const result = compare(post, other);
    if (result && result.score >= threshold) {
      out.push({
        id: other._id,
        title: other.title,
        status: other.status,
        score: Math.round(result.score * 100),
        reasons: result.reasons,
      });
    }
  }

  return out.sort((x, y) => y.score - x.score).slice(0, limit);
}

module.exports = { findSimilar };