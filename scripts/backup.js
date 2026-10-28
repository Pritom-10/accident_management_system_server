require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { once } = require('events');
const mongoose = require('mongoose');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v === undefined ? true : v];
  })
);

function toJson(doc) {
  return JSON.stringify(doc, function replacer(key, val) {
    const raw = this[key];
    if (raw instanceof Date) return { $date: raw.toISOString() };
    if (raw && raw._bsontype === 'ObjectId') return { $oid: raw.toHexString() };
    if (raw && raw._bsontype === 'Binary') {
      return { $binary: { base64: Buffer.from(raw.buffer).subarray(0, raw.position).toString('base64'), subType: '00' } };
    }
    return val;
  });
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set in .env');

  const skip = new Set(String(args.skip || '').split(',').map((s) => s.trim()).filter(Boolean));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const root = path.resolve(__dirname, '..', typeof args.out === 'string' ? args.out : 'backups');
  const dir = path.join(root, stamp);
  fs.mkdirSync(dir, { recursive: true });

  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const collections = (await db.listCollections({}, { nameOnly: true }).toArray())
    .map((c) => c.name)
    .filter((n) => !n.startsWith('system.'))
    .sort();

  const info = { database: db.databaseName, takenAt: new Date().toISOString(), collections: {}, skipped: [...skip] };

  for (const name of collections) {
    if (skip.has(name)) {
      console.log(`skipped   ${name}`);
      continue;
    }

    const file = path.join(dir, `${name}.jsonl`);
    const out = fs.createWriteStream(file);
    let count = 0;

    for await (const doc of db.collection(name).find({})) {
      if (!out.write(`${toJson(doc)}\n`)) await once(out, 'drain');
      count += 1;
    }

    out.end();
    await once(out, 'finish');
    info.collections[name] = count;
    console.log(`saved     ${name}: ${count}`);
  }

  fs.writeFileSync(path.join(dir, '_info.json'), JSON.stringify(info, null, 2));
  await mongoose.disconnect();

  console.log(`\nDone. The backup is in: ${dir}`);
  console.log('This folder holds private data (password hashes, phone numbers). Keep it safe. Never put it on GitHub.');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});