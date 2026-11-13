// 한 번만 쓰는 점검용: 최근 며칠간 Firestore 문서 읽기 수를 시간별로 받아 ops/usage.json 에 적는다.
import admin from 'firebase-admin';
import fs from 'fs';
const sa = JSON.parse(process.env.SA);
const { access_token } = await admin.credential.cert(sa).getAccessToken();
const end = new Date(), start = new Date(end - 6 * 864e5);
const out = {};
for (const metric of ['firestore.googleapis.com/document/read_count', 'firestore.googleapis.com/api/request_count']) {
  const q = new URLSearchParams({
    filter: `metric.type="${metric}"`,
    'interval.startTime': start.toISOString(), 'interval.endTime': end.toISOString(),
    'aggregation.alignmentPeriod': '3600s', 'aggregation.perSeriesAligner': 'ALIGN_SUM',
  });
  const r = await fetch(`https://monitoring.googleapis.com/v3/projects/${sa.project_id}/timeSeries?${q}`, { headers: { Authorization: `Bearer ${access_token}` } });
  const j = await r.json();
  out[metric] = r.ok ? (j.timeSeries || []).map(t => ({ labels: { ...t.metric.labels, ...t.resource.labels }, points: t.points.map(p => [p.interval.endTime, Number(p.value.int64Value ?? p.value.doubleValue ?? 0)]) })) : { status: r.status, error: j.error?.message };
}
fs.writeFileSync('ops/usage.json', JSON.stringify({ at: end.toISOString(), ...out }, null, 1));
