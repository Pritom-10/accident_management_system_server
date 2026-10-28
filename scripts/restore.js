require('dotenv').config();
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const mongoose = require('mongoose');

const { ObjectId } = mongoose.mongo;

const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, ...rest] = a.replace(/^--/, '').split('=');
      return [k, rest.length ? rest.join('=') : true];
    })
);

function revive(value) {
  if (Array.isArray(value)) return value.map(revive);
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0] === '$oid') return new ObjectId(value.$oid);
    if (keys.length === 1 && keys[0] === '$date') return new Date(value.$date);
    if (keys.length === 1 && keys[0] === '$binary') return Buffer.from(value.$binary.base64, 'base64');

    const out = {};
    for (const k of keys) out[k] = revive(value[k]);
    return out;
  }
  return value;
}

async function main() {
  const folder = positional[0];
  if (!folder) {
    console.log('Usage:');
    console.log('  node scripts/restore.js backups/2026-10-18T10-30-00 --confirm');
    console.log('Options:');
    console.log('  --uri=mongodb+srv://...   restore into another database (recommended for a test)');
    console.log('  --only=hospitals,users    restore only these collections');
    console.log('  --replace                 delete what is in a collection first (dangerous)');
    return;
  }

  const dir = path.resolve(folder);
  if (!fs.existsSync(dir)) throw new Error(`Folder not found: ${dir}`);

  const uri = typeof args.uri === 'string' ? args.uri : process.env.MONGODB_URI;
  if (!uri) throw new Error('No database address. Set MONGODB_URI in .env or pass --uri=...');

  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  console.log(`Target database: ${db.databaseName}`);
  if (!args.confirm) {
    console.log('Nothing was changed. Add --confirm to really restore into this database.');
    await mongoose.disconnect();
    return;
  }

  const only = new Set(String(args.only || '').split(',').map((s) => s.trim()).filter(Boolean));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort();

  for (const file of files) {
    const name = file.replace(/\.jsonl$/, '');
    if (only.size && !only.has(name)) continue;

    const collection = db.collection(name);
    const existing = await collection.estimatedDocumentCount();

    if (existing > 0 && !args.replace) {
      console.log(`skipped   ${name}: it already has ${existing} documents (use --replace to overwrite)`);
      continue;
    }
    if (existing > 0 && args.replace) await collection.deleteMany({});

    const rl = readline.createInterface({ input: fs.createReadStream(path.join(dir, file)), crlfDelay: Infinity });
    let batch = [];
    let bytes = 0;
    let inserted = 0;
    let failed = 0;

    const flush = async () => {
      if (batch.length === 0) return;
      try {
        const res = await collection.insertMany(batch, { ordered: false });
        inserted += res.insertedCount;
      } catch (err) {
        inserted += (err.result && err.result.insertedCount) || 0;
        failed += batch.length - ((err.result && err.result.insertedCount) || 0);
      }
      batch = [];
      bytes = 0;
    };

    for await (const line of rl) {
      if (!line.trim()) continue;
      batch.push(revive(JSON.parse(line)));
      bytes += line.length;
      if (batch.length >= 100 || bytes > 8 * 1024 * 1024) await flush();
    }
    await flush();

    console.log(`restored  ${name}: ${inserted}${failed ? `, ${failed} could not be added` : ''}`);
  }

  await mongoose.disconnect();
  console.log('\nDone. Start the backend once so it can rebuild the indexes.');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});