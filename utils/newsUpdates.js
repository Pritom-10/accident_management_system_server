function applyCounts(post, update) {
  if (Number.isInteger(update.deaths)) post.deaths = update.deaths;
  if (Number.isInteger(update.injured)) post.injured = update.injured;
}

module.exports = { applyCounts };