const express = require('express');
const router = express.Router();


const VIEWER_HOSTS = ['ibb.co', 'ibb.co.com', 'www.ibb.co', 'www.ibb.co.com'];


const cache = new Map();

function extractOgImage(html) {
  const tags = html.match(/<meta[^>]+>/gi) || [];
  for (const tag of tags) {
    if (/property=["']og:image["']/i.test(tag)) {
      const m = tag.match(/content=["']([^"']+)["']/i);
      if (m) return m[1];
    }
  }
  return null;
}


router.get('/ibb', async (req, res) => {
  try {
    const raw = String(req.query.url || '');

    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      return res.status(400).send('Invalid link');
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return res.status(400).send('Invalid link');
    }


    if (parsed.hostname === 'i.ibb.co') return res.redirect(302, raw);

    if (!VIEWER_HOSTS.includes(parsed.hostname)) {
      return res.status(400).send('Only ibb.co links are supported');
    }

    const key = `${parsed.hostname}${parsed.pathname}`;
    let direct = cache.get(key);

    if (!direct) {
      const page = await fetch(`https://${parsed.hostname}${parsed.pathname}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SahayotaBot/1.0)' },
        signal: AbortSignal.timeout(8000),
      });
      if (!page.ok) return res.status(404).send('Image page not found');

      direct = extractOgImage(await page.text());
      if (!direct || new URL(direct).hostname !== 'i.ibb.co') {
        return res.status(404).send('Could not find the image on that page');
      }
      cache.set(key, direct);
    }

    res.set('Cache-Control', 'public, max-age=86400');
    res.redirect(302, direct);
  } catch {
    res.status(502).send('Could not load the image');
  }
});

module.exports = router;