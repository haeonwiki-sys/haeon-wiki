// 위키 내용 동기화 (GitHub Actions에서 실행)
// 1) 이번 푸시에서 바뀐 content/<문서>.html 을 파이어베이스에 반영합니다.
//    사이트에서 그사이 누가 고쳤으면(판 번호가 다르면) 반영하지 않고 건너뜁니다.
// 2) 파이어베이스의 모든 문서를 content/ 로 다시 내보냅니다.
// 결과는 ops/last-result.json 에 남습니다. 코드(secrets)와 로그인 기록(grants)은 다루지 않습니다.
import admin from 'firebase-admin';
import fs from 'fs';
import { execSync } from 'child_process';

const result = { at: new Date().toISOString(), applied: [], skipped: [], exported: 0, error: null };
const HOME_META = { title: '대문', short: '대문', floor: 0, parent: null, order: 0, sub: '', badge: '' };

try {
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.SA)) });
  const db = admin.firestore();
  const FV = admin.firestore.FieldValue;

  const before = process.env.BEFORE || '';
  let changed = [];
  if (before && !/^0+$/.test(before)) {
    try {
      changed = execSync(`git diff --name-only ${before} HEAD -- content`).toString().split('\n')
        .filter(f => /^content\/[a-z0-9-]+\.html$/.test(f));
    } catch (e) { result.skipped.push({ id: '*', reason: 'diff 실패: ' + e.message }); }
  }
  let metaPrev = {};
  try { metaPrev = JSON.parse(execSync(`git show ${before}:content/_meta.json`).toString()); } catch (e) { /* 처음 */ }
  const summary = (process.env.MSG || '').split('\n')[0].slice(0, 100);

  for (const f of changed) {
    const id = f.slice('content/'.length, -'.html'.length);
    if (!fs.existsSync(f)) continue;
    const body = fs.readFileSync(f, 'utf8').trim();
    const base = metaPrev[id] ? metaPrev[id].version : 0;
    const ref = db.collection('docs').doc(id);
    try {
      await db.runTransaction(async tx => {
        const cur = await tx.get(ref);
        const d = cur.exists ? cur.data() : null;
        const v = d ? (d.version || 0) : 0;
        if (v !== base) throw new Error(`사이트에서 먼저 고친 판이 있습니다 (사이트 ${v}판, 기준 ${base}판)`);
        let meta;
        if (d) meta = { title: d.title, short: d.short, floor: d.floor, parent: d.parent ?? null, order: d.order, sub: d.sub || '', badge: d.badge || '' };
        else if (id === 'home') meta = HOME_META;
        else throw new Error('사이트에 없는 문서입니다');
        tx.set(ref, { ...meta, body, version: v + 1, updatedAt: FV.serverTimestamp(), updatedBy: 'Claude' });
        tx.create(ref.collection('revisions').doc(), { body, title: meta.title, version: v + 1, savedAt: FV.serverTimestamp(), by: 'Claude', summary });
      });
      result.applied.push(id);
    } catch (e) { result.skipped.push({ id, reason: String(e.message || e) }); }
  }

  const snap = await db.collection('docs').get();
  const meta = {};
  fs.mkdirSync('content', { recursive: true });
  for (const s of snap.docs) {
    const d = s.data();
    fs.writeFileSync(`content/${s.id}.html`, (d.body || '') + '\n');
    meta[s.id] = { title: d.title, version: d.version || 0, updatedAt: d.updatedAt ? d.updatedAt.toDate().toISOString() : null, updatedBy: d.updatedBy || '' };
  }
  fs.writeFileSync('content/_meta.json', JSON.stringify(meta, null, 1) + '\n');
  result.exported = snap.size;
} catch (e) {
  result.error = String((e && e.stack) || e);
}
fs.writeFileSync('ops/last-result.json', JSON.stringify(result, null, 1) + '\n');
