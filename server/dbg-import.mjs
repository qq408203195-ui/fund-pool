import fs from 'node:fs';
import { db } from './src/db.js';
import { importAll } from './src/importSnapshot.js';

const raw = JSON.parse(fs.readFileSync('data/snapshot/em-full.json', 'utf8'));
console.log('cols', raw.cols.join(','));
console.log('rows', raw.rows.length);
console.log('row0', JSON.stringify(raw.rows[0]));

// 找 undefined 值
let bad = 0;
for (const r of raw.rows) {
  for (let i = 0; i < r.length; i++) {
    if (r[i] === undefined) { bad++; break; }
  }
}
console.log('rows with undefined:', bad);

try {
  const res = importAll();
  console.log('import ok', res);
} catch (e) {
  console.log('IMPORT ERROR:', e.message.slice(0, 500));
  console.log('STACK:', (e.stack || '').split('\n').slice(0, 6).join('\n'));
}
const n = db.prepare('SELECT COUNT(*) AS n FROM funds').get().n;
console.log('funds in db:', n);
