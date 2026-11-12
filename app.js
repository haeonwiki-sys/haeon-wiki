// 해온 위키
// - 보기: 누구나. 문서는 파이어베이스(Firestore)의 docs 컬렉션에서 읽습니다.
// - 편집: 구글 로그인 + 코드. 단장 코드는 모든 문서, 문서 코드는 그 문서만.
//   헌장(charter)과 공통 매뉴얼(common)은 단장 코드로만 열립니다.
// - 실제 잠금은 firestore.rules가 서버에서 합니다. 이 파일의 확인은 화면 안내용입니다.
import { firebaseConfig } from './config.js';
import { SEED } from './seed.js';

const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
const FLOORS = { 1: '1층 헌장', 2: '2층 운영 문서', 3: '3층 봉사 매뉴얼' };
const MASTER_ONLY = ['charter', 'common', 'home'];
const FIRST_DATE = '2026-11-10';
// 대문 처음 내용. 문서 목록과 확인 칸 합계는 data-auto 자리에 자동으로 채워집니다.
const HOME_SEED = {
  id: 'home', title: '대문', short: '대문', floor: 0, parent: null, order: 0, sub: '', badge: '',
  body: '<p class="lead">해온 봉사단의 운영 문서를 모아 둔 곳입니다. 지금 단장 한 사람의 머릿속과 손에 있는 것을 문서로 옮겨, 누가 맡아도 해온이 해온답게 돌아가게 하는 것이 목표입니다.</p>' +
    '<div class="rules"><div class="rule"><b>위층이 우선</b><p>위층 문서가 아래층 문서보다 우선합니다. 아래 문서는 위 문서와 어긋나게 쓰지 않습니다.</p></div>' +
    '<div class="rule"><b>없으면 헌장</b><p>매뉴얼에 없는 상황을 만나면 헌장을 펴 보고 판단합니다.</p></div>' +
    '<div class="rule"><b>번호로 가리키기</b><p>"<a class="xref" data-to="charter--serve-kids"></a>"처럼 문서 이름과 번호로 짚습니다. 누르면 그 조항으로 갑니다.</p></div></div>' +
    '<p data-auto="ask-total"></p><p data-auto="doc-tree"></p>' +
    '<div class="tmpl rel"><b>이 위키에 쓰지 않는 것</b><p>연락처, 계좌번호, 회원 개인 기록, 사건 기록은 위키에 쓰지 않고 단장의 운영 노트에 따로 둡니다. 위키는 주소만 알면 누구나 볼 수 있기 때문입니다.</p></div>',
};

const S = {
  docs: [], byId: {}, NUM: {}, ASKS: {},
  user: null, fb: null,
  preview: !firebaseConfig,
  editing: null, editBase: 0, editStart: '',
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = t => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ───────── 파이어베이스 ───────── */

async function initFirebase() {
  const [appM, A, F] = await Promise.all([
    import(FB + 'firebase-app.js'),
    import(FB + 'firebase-auth.js'),
    import(FB + 'firebase-firestore.js'),
  ]);
  const app = appM.initializeApp(firebaseConfig);
  const auth = A.getAuth(app);
  const db = F.getFirestore(app);
  S.fb = { A, F, auth, db };
  try { await A.getRedirectResult(auth); } catch (e) { /* 리디렉트 로그인이 없으면 무시 */ }
  await new Promise(resolve => {
    let first = true;
    A.onAuthStateChanged(auth, u => {
      S.user = u;
      if (first) { first = false; resolve(); }
      else if (location.hash === '#admin') renderAdmin();
    });
  });
}

function seedDocs() { return SEED.map(d => ({ ...d, stored: false, version: 0 })); }

function index() {
  S.docs.sort((a, b) => (a.floor - b.floor) || (a.order - b.order));
  S.byId = Object.fromEntries(S.docs.map(d => [d.id, d]));
  S.byId.home = S.home;
}

async function loadDocs() {
  let home = null;
  if (S.preview) {
    S.docs = seedDocs();
  } else {
    const { F, db } = S.fb;
    const snap = await F.getDocs(F.collection(db, 'docs'));
    const stored = snap.docs.map(s => ({ id: s.id, ...s.data(), stored: true }));
    home = stored.find(d => d.id === 'home') || null;
    const rest = stored.filter(d => d.id !== 'home');
    const have = new Set(rest.map(d => d.id));
    S.docs = rest.concat(seedDocs().filter(d => !have.has(d.id)));
  }
  S.home = home || { ...HOME_SEED, stored: false, version: 0 };
  index();
}

function fmt(ts) {
  const d = ts && ts.toDate ? ts.toDate() : (ts instanceof Date ? ts : null);
  if (!d) return '';
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ───────── 안전한 HTML만 남기기 ───────── */

const ALLOW = {
  H2: ['id'], H3: ['id'], P: ['class', 'data-auto'], B: [], STRONG: [], EM: [], I: [], BR: [], SUP: [],
  A: ['href', 'class', 'data-to', 'data-full', 'target', 'rel'], SPAN: ['class'],
  OL: [], UL: [], LI: ['id'],
  TABLE: ['class'], THEAD: [], TBODY: [], TR: ['class', 'id'], TH: [], TD: ['class'],
  DIV: ['class'], SECTION: ['class', 'data-end'], BLOCKQUOTE: [], CITE: [], DL: ['class'], DT: [], DD: [],
};
const CLASSES = {
  P: ['lead', 'note', 'fns-title'], SPAN: ['ask', 'help', 'axis'], A: ['xref'], TABLE: ['wtable', 'kv'], TR: ['item'],
  TD: ['item-n', 'nm', 'ds', 'fq'], DIV: ['twrap', 'stack', 'rules', 'rule', 'tmpl', 'rel'], SECTION: ['fns'], DL: ['meta'],
};
const AUTO = /^(stats|help-list|doc-tree|ask-total)$/;
const BLOCKS = /^(P|H2|H3|OL|UL|TABLE|DIV|SECTION|BLOCKQUOTE|DL)$/;

function unwrap(el) { el.replaceWith(...Array.from(el.childNodes)); }
function rename(el, tag) {
  const n = document.createElement(tag);
  while (el.firstChild) n.appendChild(el.firstChild);
  el.replaceWith(n);
  return n;
}

function clean(node) {
  for (const ch of Array.from(node.childNodes)) {
    if (ch.nodeType === 3) continue;
    if (ch.nodeType !== 1) { ch.remove(); continue; }
    let el = ch;
    if (/^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|TEMPLATE|META|LINK)$/.test(el.tagName)) { el.remove(); continue; }
    if (el.tagName === 'DIV' && !CLASSES.DIV.some(c => el.classList.contains(c))) {
      if (Array.from(el.children).some(c => BLOCKS.test(c.tagName))) { clean(el); unwrap(el); continue; }
      el = rename(el, 'P');
    }
    if (/^H[1456]$/.test(el.tagName)) el = rename(el, el.tagName === 'H1' ? 'H2' : 'H3');
    const allow = ALLOW[el.tagName];
    if (!allow) { clean(el); unwrap(el); continue; }
    for (const a of Array.from(el.attributes)) if (!allow.includes(a.name)) el.removeAttribute(a.name);
    if (el.hasAttribute('class')) {
      const ok = CLASSES[el.tagName] || [];
      const keep = Array.from(el.classList).filter(c => ok.includes(c));
      if (keep.length) el.setAttribute('class', keep.join(' ')); else el.removeAttribute('class');
    }
    if (el.id && !/^[a-z0-9-]+$/.test(el.id)) el.removeAttribute('id');
    if (el.tagName === 'SPAN' && !el.hasAttribute('class')) { clean(el); unwrap(el); continue; }
    if (el.tagName === 'A') {
      if (el.classList.contains('xref')) {
        el.textContent = '';
        el.removeAttribute('href');
        if (!/^[a-z0-9-]+$/.test(el.getAttribute('data-to') || '')) { el.remove(); continue; }
      } else {
        const h = el.getAttribute('href') || '';
        if (/^https:\/\//.test(h)) { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener'); }
        else { el.removeAttribute('target'); el.removeAttribute('rel'); if (!/^#[a-z0-9-]+$/.test(h)) el.removeAttribute('href'); }
      }
    }
    if (el.tagName === 'P' && el.hasAttribute('data-auto')) {
      if (!AUTO.test(el.getAttribute('data-auto'))) el.removeAttribute('data-auto');
      else { el.textContent = ''; continue; }
    }
    clean(el);
  }
}

function sanitize(html) {
  const box = document.createElement('div');
  const parsed = new DOMParser().parseFromString('<div>' + (html || '') + '</div>', 'text/html');
  box.append(...Array.from(parsed.body.firstChild.childNodes));
  clean(box);
  return box.innerHTML;
}

/* ───────── 문서 그리기 ───────── */

function headingText(el) {
  return Array.from(el.childNodes).filter(n => n.nodeType === 3 || (n.nodeType === 1 && !n.classList.contains('axis') && !n.classList.contains('sn')))
    .map(n => n.textContent).join('').trim();
}

// 각주를 나무위키처럼 본문에 나오는 차례대로 1, 2, 3… 매기기.
// 원본에는 출처를 한 번씩만 적어 두고, 화면에서는 인용할 때마다 새 번호를 붙여 아래 목록을 펼친다.
function renumberFootnotes(root) {
  const lis = $$('.fns li[id]', root);
  if (!lis.length) return;
  const byId = new Map(lis.map(li => [li.id, li]));
  const refOf = a => decodeURIComponent(a.getAttribute('href').slice(1));
  const refs = $$('sup a[href^="#"]', root).filter(a => byId.has(refOf(a)));
  const ol = lis[0].parentNode;
  const content = li => {
    const c = li.cloneNode(true), t = c.firstChild;
    if (t && t.nodeType === 3) t.textContent = t.textContent.replace(/^\s*\[\d+\]\s*/, '');
    return Array.from(c.childNodes);
  };
  const out = [], used = new Set();
  const add = src => {
    const n = out.length + 1, li = document.createElement('li');
    li.id = src.id.split('--')[0] + '--note-' + n;
    li.append(document.createTextNode(`[${n}]`), ...content(src));
    out.push(li);
    return li;
  };
  refs.forEach(a => {
    const src = byId.get(refOf(a)); used.add(src.id);
    const li = add(src);
    a.setAttribute('href', '#' + li.id);
    a.textContent = `[${out.length}]`;
  });
  lis.forEach(li => { if (!used.has(li.id)) add(li); });
  ol.replaceChildren(...out);
}

/* 각주 팝업: 본문의 [n]을 누르면(마우스는 올리면) 각주 내용을 바로 보여 준다 */
let fnTimer = null;
function fnTarget(a) {
  if (!a || S.editing || a.closest('.ed-area')) return null;
  const li = document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1)));
  return li && li.closest('.fns') ? li : null;
}
function closeFnPop() { clearTimeout(fnTimer); const p = $('#fn-pop'); if (p) p.remove(); }
function openFnPop(a, li) {
  closeFnPop();
  const pop = document.createElement('div');
  pop.id = 'fn-pop'; pop.className = 'fn-pop'; pop.setAttribute('role', 'tooltip');
  const n = $('.fn-n', li);
  const body = li.cloneNode(true); const bn = $('.fn-n', body); if (bn) bn.remove();
  pop.innerHTML = `<b>${n ? n.textContent : a.textContent}</b>`;
  pop.append(...body.childNodes);
  document.body.append(pop);
  const r = a.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
  let left = r.left + r.width / 2 - w / 2;
  left = Math.max(12, Math.min(left, document.documentElement.clientWidth - w - 12));
  let top = r.bottom + 8;
  if (top + h > innerHeight - 8 && r.top - h - 8 > 0) top = r.top - h - 8;
  pop.style.left = left + scrollX + 'px';
  pop.style.top = top + scrollY + 'px';
  pop.dataset.for = a.getAttribute('href');
  pop.addEventListener('mouseenter', () => clearTimeout(fnTimer));
  pop.addEventListener('mouseleave', () => { fnTimer = setTimeout(closeFnPop, 200); });
}

function buildArticle(d) {
  const art = document.createElement('article');
  art.className = 'doc';
  art.id = 'doc-' + d.id;
  const content = document.createElement('div');
  content.className = 'content wbody';
  content.innerHTML = sanitize(d.body);
  art.append(content);
  renumberFootnotes(content);
  // 각주 번호 [1]을 왼쪽 칸으로 떼어 내기
  $$('.fns li', content).forEach(li => {
    const t = li.firstChild;
    const m = t && t.nodeType === 3 && t.textContent.match(/^\s*(\[\d+\])\s*/);
    if (m) { t.textContent = t.textContent.slice(m[0].length); li.insertAdjacentHTML('afterbegin', `<span class="fn-n">${m[1]}</span>`); }
  });

  let n2 = 0, n3 = 0, last = '', curH2 = null;
  const toc = [], asks = [], items = [], areas = new Set();
  $$('h2, h3, .item, .ask', content).forEach(el => {
    if (el.classList.contains('ask')) {
      const id = d.id + '--ask-' + (asks.length + 1);
      el.id = id;
      asks.push({ id, num: last || '개요', text: el.textContent });
      return;
    }
    if (el.tagName === 'H2') { n2++; n3 = 0; last = String(n2); curH2 = el; }
    else { n3++; last = n2 + '.' + n3; }
    let title;
    if (el.classList.contains('item')) {
      const b = $('.nm b', el); title = b ? b.textContent : '';
      const c = $('.item-n', el); if (c) c.textContent = last;
      items.push({ id: el.id, title, help: !!$('.help', el) });
      if (curH2) areas.add(curH2);
    } else {
      title = headingText(el);
      el.insertAdjacentHTML('afterbegin', `<a class="sn" href="#${d.id}--toc">${last}.</a>`);
      toc.push({ lvl: el.tagName === 'H2' ? 2 : 3, num: last, title, id: el.id });
    }
    if (el.id) S.NUM[el.id] = { doc: d.id, num: last, title };
  });
  S.ASKS[d.id] = asks;

  $$('[data-auto="stats"]', content).forEach(p => {
    p.outerHTML = `<div class="stats"><div><b>${areas.size}</b><span>영역</span></div><div><b>${items.length}</b><span>업무</span></div><div class="h"><b>${items.filter(i => i.help).length}</b><span>도움 구하는 중</span></div></div>`;
  });
  $$('[data-auto="help-list"]', content).forEach(p => {
    const hs = items.filter(i => i.help);
    p.outerHTML = hs.length ? '<ul>' + hs.map(h => `<li><a class="xref" data-to="${h.id}" data-full></a></li>`).join('') + '</ul>'
      : '<p class="note">지금은 도움을 구하는 일이 없습니다.</p>';
  });

  const firstH2 = $('h2', content);
  if (firstH2 && toc.length) {
    let h = `<nav class="toc" id="${d.id}--toc" aria-label="목차"><p class="toc-title">목차</p><ol>`, open = false;
    toc.forEach(t => {
      const li = `<li><a href="#${t.id}"><span class="n">${t.num}.</span>${esc(t.title)}</a>`;
      if (t.lvl === 2) { if (open) h += '</ol></li>'; h += li + '<ol>'; open = true; }
      else h += li + '</li>';
    });
    if (open) h += '</ol></li>';
    firstH2.insertAdjacentHTML('beforebegin', h + '</ol></nav>');
  }

  let cur = null;
  Array.from(content.children).forEach(el => {
    if (el.tagName === 'H2') {
      const det = document.createElement('details');
      det.className = 'sec'; det.open = true;
      const sum = document.createElement('summary');
      content.insertBefore(det, el);
      sum.appendChild(el); det.appendChild(sum);
      cur = document.createElement('div'); cur.className = 'sec-body'; det.appendChild(cur);
    } else if (el.hasAttribute('data-end')) cur = null;
    else if (cur) cur.appendChild(el);
  });

  art.insertAdjacentHTML('afterbegin', headHtml(d, asks));
  art.insertAdjacentHTML('beforeend', footHtml(d));
  return art;
}

function headHtml(d, asks) {
  const when = fmt(d.updatedAt) || FIRST_DATE;
  const by = d.updatedBy ? ' · ' + esc(d.updatedBy) : '';
  let h = `<div class="doc-head"><h1>${esc(d.title)}${d.badge ? `<span class="badge">${esc(d.badge)}</span>` : ''}${asks.length ? '<small>초안</small>' : ''}</h1>
    <div class="head-row"><p class="edited">최근 수정: ${when}${by}</p>
    <div class="actions"><button type="button" class="btn sm" data-edit="${d.id}">편집</button><button type="button" class="btn ghost sm" data-history="${d.id}">역사</button></div></div></div>
    <div class="cat"><b>분류</b><span>해온 문서</span><span>${FLOORS[d.floor]}</span>${MASTER_ONLY.includes(d.id) ? '<span>단장 코드로만 편집</span>' : ''}</div>`;
  if (d.parent && S.byId[d.parent]) h += `<div class="tmpl rel"><p>상위 문서: <a href="#${d.parent}">${esc(S.byId[d.parent].title)}</a></p></div>`;
  if (asks.length) {
    h += `<div class="tmpl draft"><b>이 문서는 초안입니다.</b><p>노란 점선 칸 ${asks.length}곳은 단장님 확인이 필요합니다.</p><ol>` +
      asks.map(a => `<li><a href="#${a.id}"><span class="an">${esc(a.num)}</span>${esc(a.text)}</a></li>`).join('') + '</ol></div>';
  }
  return h;
}

function footHtml(d) {
  const sibs = S.docs.filter(x => x.floor === d.floor);
  return `<div class="doc-foot"><span class="lbl">${FLOORS[d.floor]}</span><div class="sibs">` +
    sibs.map(x => x.id === d.id ? `<span class="cur">${esc(x.title)}</span>` : `<a href="#${x.id}">${esc(x.title)}</a>`).join('') +
    '</div><div class="links"><a href="#home">← 대문으로</a><a href="#admin">관리</a></div></div>';
}

function labelXref(a, here) {
  const to = a.getAttribute('data-to');
  a.href = '#' + to;
  if (S.byId[to]) { a.textContent = S.byId[to].title; return; }
  const t = S.NUM[to];
  if (!t) { a.textContent = '(지워진 조항)'; return; }
  const label = (t.doc === here ? '' : S.byId[t.doc].short + ' ') + t.num;
  a.textContent = a.hasAttribute('data-full') ? label + ' ' + t.title : label;
  a.title = `${S.byId[t.doc].title} ${t.num} ${t.title}`;
}

function fillXrefs(root) {
  $$('a.xref', root).forEach(a => {
    const art = a.closest('.doc');
    labelXref(a, art && art.id.startsWith('doc-') ? art.id.slice(4) : '');
  });
}

function buildHome(home) {
  let total = 0;
  const tree = [1, 2, 3].map(f => {
    const items = S.docs.filter(d => d.floor === f);
    return `<section class="floor f${f}"><h2><span class="lv">${f}층</span>${FLOORS[f].replace(f + '층 ', '')}</h2><ul>` +
      items.map(d => {
        const c = (S.ASKS[d.id] || []).length; total += c;
        return `<li><span><a href="#${d.id}">${esc(d.title)}</a>${d.sub ? `<span class="sub">${esc(d.sub)}</span>` : ''}</span>${c ? `<span class="cnt">확인 ${c}</span>` : ''}</li>`;
      }).join('') + '</ul></section>';
  }).join('');
  const h = S.home;
  const when = fmt(h.updatedAt) || FIRST_DATE;
  const by = h.updatedBy ? ' · ' + esc(h.updatedBy) : '';
  home.innerHTML = `<div class="doc-head"><h1>해온 위키</h1><div class="head-row"><p class="edited">최근 수정: ${when}${by}</p>
    <div class="actions"><button type="button" class="btn sm" data-edit="home">편집</button><button type="button" class="btn ghost sm" data-history="home">역사</button></div></div></div>
    <div class="content wbody">${sanitize(h.body)}</div>
    <div class="doc-foot"><div class="links"><a href="#admin">관리</a></div></div>`;
  $$('[data-auto="ask-total"]', home).forEach(p => {
    p.outerHTML = total ? `<div class="tmpl draft"><b>확인이 필요한 칸이 ${total}곳 있습니다.</b><p>문서마다 맨 위에 확인할 칸이 모여 있습니다.</p></div>` : '';
  });
  $$('[data-auto="doc-tree"]', home).forEach(p => { p.outerHTML = `<div class="tree">${tree}</div>`; });
  fillXrefs(home);
}

function buildMenu() {
  $('#menu-panel').innerHTML = '<ul><li><a href="#home">대문</a></li></ul>' + [1, 2, 3].map(f =>
    `<p class="fl">${FLOORS[f]}</p><ul>` + S.docs.filter(d => d.floor === f).map(d => `<li><a href="#${d.id}">${esc(d.title)}</a></li>`).join('') + '</ul>'
  ).join('');
}

function banner() {
  const b = $('#banner');
  let msg = '';
  if (S.loadError) msg = '문서를 불러오지 못해 처음 내용을 보여 주고 있습니다. 잠시 뒤 새로고침해 주세요.';
  else if (S.preview) msg = '미리보기 모드: 아직 파이어베이스에 연결하기 전이라 처음 문서 내용을 보여 주며, 저장은 되지 않습니다.';
  else if (S.docs.some(d => !d.stored)) msg = '아직 저장되지 않은 문서가 있어 처음 내용으로 보여 주고 있습니다. 관리 화면에서 "처음 문서 넣기"를 해 주세요.';
  b.hidden = !msg;
  b.innerHTML = msg ? `<div>${esc(msg)}</div>` : '';
}

function renderAll() {
  const main = $('#main');
  main.innerHTML = '';
  S.NUM = {}; S.ASKS = {};
  const home = document.createElement('article');
  home.className = 'doc'; home.id = 'doc-home';
  main.append(home);
  S.docs.forEach(d => main.append(buildArticle(d)));
  fillXrefs(main);
  buildHome(home);
  const admin = document.createElement('section');
  admin.className = 'doc'; admin.id = 'doc-admin';
  main.append(admin);
  buildMenu();
  banner();
  route();
}

function shareBase() { return location.origin + location.pathname; }

function buildShare() {
  const here = shareBase() + (location.hash || '');
  const rows = [S.home].concat(S.docs).map(d => {
    const url = shareBase() + '#' + d.id;
    return `<li><span>${esc(d.title)}</span><code>#${d.id}</code><button type="button" class="btn ghost sm" data-copy="${esc(url)}">복사</button></li>`;
  }).join('');
  $('#share-panel').innerHTML = `<p class="fl">지금 보고 있는 곳</p>
    <div class="share-now"><input type="text" readonly value="${esc(here)}" aria-label="지금 보고 있는 곳의 주소"><button type="button" class="btn sm" data-copy="${esc(here)}">복사</button></div>
    <p class="share-help">주소 끝에 <code>#문서이름</code>을 붙이면 그 문서가 바로 열립니다. 목차에서 조항을 누른 뒤 여기서 복사하면, 그 조항까지 바로 가는 주소가 됩니다.</p>
    <p class="fl">문서별 주소</p><ul class="share-list">${rows}</ul>`;
}

async function copyText(text, btn) {
  try { await navigator.clipboard.writeText(text); }
  catch (e) {
    const t = document.createElement('textarea');
    t.value = text; document.body.append(t); t.select();
    try { document.execCommand('copy'); } catch (err) { /* 복사 불가 */ }
    t.remove();
  }
  const old = btn.textContent;
  btn.textContent = '복사됨';
  setTimeout(() => { btn.textContent = old; }, 1500);
}

function closeMenus() { $$('.bar .menu').forEach(m => { m.open = false; }); }

function show(id) { $$('#main > .doc').forEach(a => a.classList.toggle('active', a.id === 'doc-' + id)); }

function route() {
  if (S.editing) return;
  closeMenus();
  let h = decodeURIComponent(location.hash.slice(1)) || 'home';
  let id = h.split('--')[0];
  if (id === 'admin') { show('admin'); renderAdmin(); scrollTo(0, 0); return; }
  if (!S.byId[id] && id !== 'home') { id = 'home'; h = 'home'; }
  show(id);
  if (h.includes('--')) {
    const el = document.getElementById(h);
    if (el) {
      const det = el.closest('details'); if (det) det.open = true;
      el.scrollIntoView({ block: 'start' });
      return;
    }
  }
  scrollTo(0, 0);
}

/* ───────── 창·알림 ───────── */

let modalClose = null;
function openModal(html, onClose) {
  const m = $('#modal');
  $('#modal-body').innerHTML = html;
  m.hidden = false;
  modalClose = onClose || null;
  const f = $('#modal-body input, #modal-body button'); if (f) f.focus();
  return $('#modal-body');
}
function closeModal(silent) {
  $('#modal').hidden = true;
  $('#modal-body').innerHTML = '';
  const cb = modalClose; modalClose = null;
  if (!silent && cb) cb();
}
let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3800);
}

/* ───────── 로그인과 코드 ───────── */

async function signIn() {
  const { A, auth } = S.fb;
  const provider = new A.GoogleAuthProvider();
  try {
    const r = await A.signInWithPopup(auth, provider);
    S.user = r.user;
    return true;
  } catch (e) {
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
      await A.signInWithRedirect(auth, provider);
    } else if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') {
      console.error(e); toast('구글 로그인을 하지 못했습니다. 잠시 뒤 다시 해 주세요.');
    }
    return false;
  }
}

const grantRef = key => S.fb.F.doc(S.fb.db, 'grants', S.user.uid + '_' + key);
async function hasGrant(key) {
  try { return (await S.fb.F.getDoc(grantRef(key))).exists(); } catch (e) { return false; }
}
async function tryGrant(key, code) {
  try {
    await S.fb.F.setDoc(grantRef(key), { uid: S.user.uid, key, code, at: S.fb.F.serverTimestamp() });
    return true;
  } catch (e) { return false; }
}
async function dropGrants(keys) {
  for (const k of keys) { try { await S.fb.F.deleteDoc(grantRef(k)); } catch (e) { /* 없으면 무시 */ } }
}

function askCode(docId) {
  const masterOnly = docId === 'admin' || MASTER_ONLY.includes(docId);
  const name = docId === 'admin' ? '관리 화면' : esc(S.byId[docId] ? S.byId[docId].title : '');
  return new Promise(resolve => {
    const box = openModal(`<h2 class="m-title">편집 코드</h2>
      <p>${masterOnly ? `<b>${name}</b>은 단장 코드로만 열립니다.` : `<b>${name}</b> 문서의 코드나 단장 코드를 입력하세요.`}</p>
      <form class="code-form"><input id="code-in" type="password" autocomplete="off" required minlength="4" aria-label="코드"><button class="btn" type="submit">확인</button></form>
      <p class="m-err" hidden>코드가 맞지 않습니다. 다시 확인해 주세요.</p>`, () => resolve(false));
    $('form', box).addEventListener('submit', async e => {
      e.preventDefault();
      const code = $('#code-in', box).value;
      const btn = $('button[type="submit"]', box); btn.disabled = true;
      let ok = await tryGrant('master', code);
      if (!ok && !masterOnly) ok = await tryGrant(docId, code);
      if (ok) { closeModal(true); resolve(true); return; }
      btn.disabled = false;
      $('.m-err', box).hidden = false;
      $('#code-in', box).select();
    });
  });
}

async function ensurePermission(docId) {
  if (!S.user && !(await signIn())) return false;
  if (await hasGrant('master')) return true;
  if (!MASTER_ONLY.includes(docId) && await hasGrant(docId)) return true;
  return askCode(docId);
}

/* ───────── 편집기 ───────── */

function prepEditable(area) {
  $$('a.xref', area).forEach(a => { a.contentEditable = 'false'; labelXref(a, ''); });
  $$('[data-auto]', area).forEach(p => { p.contentEditable = 'false'; });
}

function finalize(area, docId) {
  const box = document.createElement('div');
  box.innerHTML = sanitize(area.innerHTML);
  const seen = new Set();
  $$('h2, h3', box).forEach(h => {
    if (!h.textContent.trim()) { h.remove(); return; }
    let id = h.id;
    if (!id || seen.has(id) || !id.startsWith(docId + '--')) {
      do { id = docId + '--' + Math.random().toString(36).slice(2, 8); } while (seen.has(id));
      h.id = id;
    }
    seen.add(id);
  });
  $$('p', box).forEach(p => { if (!p.textContent.trim() && !p.querySelector('a, span, br') && !p.hasAttribute('data-auto')) p.remove(); });
  return box.innerHTML.trim();
}

function toggleAsk(area) {
  const sel = getSelection();
  if (!sel.rangeCount) return;
  const r = sel.getRangeAt(0);
  if (!area.contains(r.commonAncestorContainer)) return;
  const base = r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement;
  const ex = base.closest('span.ask');
  if (ex && area.contains(ex)) { unwrap(ex); return; }
  const s = document.createElement('span');
  s.className = 'ask';
  if (r.collapsed) s.textContent = '확인할 내용';
  else s.append(r.extractContents());
  r.insertNode(s);
  sel.removeAllRanges();
  const nr = document.createRange(); nr.selectNodeContents(s); sel.addRange(nr);
}

function pickXref() {
  return new Promise(resolve => {
    let list = '';
    S.docs.forEach(d => {
      list += `<li class="pd">${esc(d.title)}</li><li><button type="button" data-to="${d.id}">${esc(d.title)} 문서 전체</button></li>`;
      Object.entries(S.NUM).filter(([, t]) => t.doc === d.id).forEach(([id, t]) => {
        list += `<li><button type="button" data-to="${id}"><span class="n">${esc(d.short)} ${t.num}</span>${esc(t.title)}</button></li>`;
      });
    });
    const box = openModal(`<h2 class="m-title">조항 연결</h2><p>연결할 문서나 조항을 고르세요. 번호가 바뀌어도 연결은 따라갑니다.</p>
      <input id="pk-q" type="search" placeholder="찾기 (예: 아동, 정산)" aria-label="조항 찾기" style="font:inherit;padding:7px 10px;border:1px solid var(--line);border-radius:7px;background:var(--bg);color:var(--ink)">
      <ul class="picker-list">${list}</ul>`, () => resolve(null));
    $('#pk-q', box).addEventListener('input', e => {
      const q = e.target.value.trim();
      $$('.picker-list li', box).forEach(li => { if (!li.classList.contains('pd')) li.hidden = q && !li.textContent.includes(q); });
    });
    $('.picker-list', box).addEventListener('click', e => {
      const b = e.target.closest('button[data-to]'); if (!b) return;
      closeModal(true); resolve(b.dataset.to);
    });
  });
}

async function insertXref(area) {
  const sel = getSelection();
  const range = sel.rangeCount && area.contains(sel.getRangeAt(0).commonAncestorContainer) ? sel.getRangeAt(0).cloneRange() : null;
  const to = await pickXref();
  if (!to) return;
  const a = document.createElement('a');
  a.className = 'xref'; a.setAttribute('data-to', to); a.setAttribute('data-full', ''); a.contentEditable = 'false';
  labelXref(a, '');
  if (range) { range.collapse(false); range.insertNode(a); a.after(document.createTextNode(' ')); }
  else { const p = document.createElement('p'); p.append(a); area.append(p); }
  area.focus();
}

async function startEdit(docId, override, summary) {
  const d = S.byId[docId];
  if (!d || S.editing) return;
  if (!S.preview && !(await ensurePermission(docId))) return;
  S.editing = docId;
  S.editBase = d.version || 0;
  const ed = document.createElement('section');
  ed.className = 'doc active'; ed.id = 'editor';
  ed.innerHTML = `<div class="doc-head"><h1>${esc(d.title)}<small>편집 중</small></h1>
    <p class="edited">${S.preview ? '미리보기 모드라 저장되지 않습니다.' : esc((S.user && S.user.displayName ? S.user.displayName : '') + ' 님으로 편집합니다.')}</p></div>
    <p class="ed-help">제목 단계(큰 제목, 작은 제목)만 고르면 번호는 저장할 때 자동으로 붙습니다. 단장님 확인이 필요한 부분은 글자를 고른 뒤 "확인 필요"를 누르세요.</p>
    <div class="toolbar" role="toolbar" aria-label="편집 도구">
      <button type="button" data-cmd="h2">큰 제목</button><button type="button" data-cmd="h3">작은 제목</button><button type="button" data-cmd="p">본문</button>
      <button type="button" data-cmd="ol">번호 목록</button><button type="button" data-cmd="ul">점 목록</button><button type="button" data-cmd="bold"><b>굵게</b></button>
      <button type="button" data-cmd="ask">확인 필요</button><button type="button" data-cmd="xref">조항 연결</button><button type="button" data-cmd="undo">되돌리기</button>
    </div>
    <div class="ed-area wbody" contenteditable="true" spellcheck="false"></div>
    <label class="ed-sum">편집 요약<input id="ed-sum" type="text" maxlength="100" placeholder="무엇을 고쳤는지 한 줄로 (선택)"></label>
    <div class="ed-actions"><button type="button" class="btn" data-ed="save">저장</button><button type="button" class="btn ghost" data-ed="cancel">취소</button></div>`;
  $$('#main > .doc').forEach(a => a.classList.remove('active'));
  $('#main').append(ed);
  const area = $('.ed-area', ed);
  area.innerHTML = sanitize(override != null ? override : d.body);
  prepEditable(area);
  S.editStart = area.innerHTML;
  if (summary) $('#ed-sum', ed).value = summary;
  try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) { /* 지원 안 하는 브라우저 */ }

  const tb = $('.toolbar', ed);
  tb.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });
  tb.addEventListener('click', e => {
    const b = e.target.closest('button[data-cmd]'); if (!b) return;
    const c = b.dataset.cmd;
    if (c === 'ask') return toggleAsk(area);
    if (c === 'xref') return insertXref(area);
    area.focus();
    if (c === 'h2' || c === 'h3' || c === 'p') document.execCommand('formatBlock', false, '<' + c + '>');
    else if (c === 'ol') document.execCommand('insertOrderedList');
    else if (c === 'ul') document.execCommand('insertUnorderedList');
    else if (c === 'bold') document.execCommand('bold');
    else if (c === 'undo') document.execCommand('undo');
  });
  $('[data-ed="save"]', ed).addEventListener('click', () => doSave(false));
  $('[data-ed="cancel"]', ed).addEventListener('click', () => {
    if (area.innerHTML !== S.editStart && !confirm('고친 내용을 저장하지 않고 나갈까요?')) return;
    endEdit();
  });
  scrollTo(0, 0);
  area.focus();
}

function endEdit() {
  S.editing = null;
  const ed = $('#editor'); if (ed) ed.remove();
  route();
}

async function saveDoc(docId, html, summary, force) {
  const { F, db } = S.fb;
  const d = S.byId[docId];
  const ref = F.doc(db, 'docs', docId);
  const by = (S.user && S.user.displayName) || '이름 없음';
  await F.runTransaction(db, async tx => {
    const cur = await tx.get(ref);
    const curV = cur.exists() ? (cur.data().version || 0) : 0;
    if (curV !== S.editBase && !force) { const err = new Error('conflict'); err.code = 'conflict'; throw err; }
    const meta = { title: d.title, short: d.short, floor: d.floor, parent: d.parent || null, order: d.order, sub: d.sub || '', badge: d.badge || '' };
    tx.set(ref, { ...meta, body: html, version: curV + 1, updatedAt: F.serverTimestamp(), updatedBy: by });
    tx.set(F.doc(F.collection(db, 'docs', docId, 'revisions')), { body: html, title: d.title, version: curV + 1, savedAt: F.serverTimestamp(), by, summary: summary || '' });
  });
}

let saving = false;
async function doSave(force) {
  if (saving) return;
  const docId = S.editing;
  const area = $('#editor .ed-area');
  const html = finalize(area, docId);
  const summary = $('#ed-sum').value.trim();
  if (S.preview) { toast('미리보기 모드에서는 저장되지 않습니다. 파이어베이스를 연결하면 저장됩니다.'); return; }
  saving = true;
  const btn = $('[data-ed="save"]'); btn.disabled = true;
  try {
    await saveDoc(docId, html, summary, force);
  } catch (e) {
    saving = false; btn.disabled = false;
    if (e && e.code === 'conflict') {
      if (confirm('편집하는 사이 다른 사람이 이 문서를 먼저 고쳤습니다. 내 내용으로 덮어쓸까요?\n(취소를 누르면 편집 화면에 그대로 남습니다)')) return doSave(true);
      return;
    }
    if (e && e.code === 'permission-denied') {
      await dropGrants(['master', docId]);
      toast('코드가 바뀌었을 수 있습니다. 코드를 다시 입력해 주세요.');
      if (await askCode(docId)) return doSave(force);
      return;
    }
    console.error(e);
    toast('저장하지 못했습니다. 인터넷 연결을 확인하고 다시 눌러 주세요.');
    return;
  }
  saving = false;
  S.editing = null;
  await loadDocs();
  renderAll();
  toast('저장했습니다.');
}

/* ───────── 역사 ───────── */

async function showHistory(docId) {
  if (S.preview) { toast('미리보기 모드에서는 역사가 없습니다.'); return; }
  const { F, db } = S.fb;
  let revs = [];
  try {
    const snap = await F.getDocs(F.query(F.collection(db, 'docs', docId, 'revisions'), F.orderBy('savedAt', 'desc'), F.limit(50)));
    revs = snap.docs.map(s => ({ id: s.id, ...s.data() }));
  } catch (e) { console.error(e); toast('역사를 불러오지 못했습니다.'); return; }
  const d = S.byId[docId];
  const list = revs.length ? '<ol class="revs">' + revs.map((r, i) => `<li><div><b>${r.version ? r.version + '판' : ''}</b> ${fmt(r.savedAt)} · ${esc(r.by || '')}${r.summary ? `<span class="rs">${esc(r.summary)}</span>` : ''}</div>
      <div class="rb"><button type="button" class="btn ghost sm" data-rv="${i}">보기</button>${i > 0 ? `<button type="button" class="btn ghost sm" data-rr="${i}">이 판으로 되돌리기</button>` : ''}</div></li>`).join('') + '</ol>'
    : '<p>아직 저장된 기록이 없습니다.</p>';
  const box = openModal(`<h2 class="m-title">${esc(d.title)} 역사</h2><p class="edited">최근 50개까지 보입니다. 되돌리기는 그 판의 내용으로 편집 화면을 엽니다.</p>${list}`);
  box.addEventListener('click', e => {
    const v = e.target.closest('[data-rv]');
    const r = e.target.closest('[data-rr]');
    if (v) {
      const rv = revs[+v.dataset.rv];
      const b2 = openModal(`<h2 class="m-title">${esc(d.title)} ${rv.version || ''}판</h2><p class="edited">${fmt(rv.savedAt)} · ${esc(rv.by || '')}</p><div class="wbody rev-view">${sanitize(rv.body)}</div>`);
      fillXrefs(b2);
    }
    if (r) {
      const rv = revs[+r.dataset.rr];
      closeModal(true);
      startEdit(docId, rv.body, `${rv.version}판으로 되돌림`);
    }
  });
}

/* ───────── 관리 ───────── */

async function renderAdmin() {
  const v = $('#doc-admin');
  if (!v) return;
  const head = '<div class="doc-head"><h1>관리</h1><p class="edited">단장 코드로 들어오는 화면입니다.</p></div>';
  if (S.preview) {
    v.innerHTML = head + '<div class="adm"><p>파이어베이스를 연결하면 이 화면에서 처음 문서를 넣고, 단장 코드와 문서 코드를 바꿀 수 있습니다.</p></div>';
    return;
  }
  if (!S.user) {
    v.innerHTML = head + '<div class="adm"><p>구글로 로그인한 뒤 단장 코드를 입력하면 들어올 수 있습니다.</p><div><button type="button" class="btn" id="adm-login">구글로 로그인</button></div></div>';
    $('#adm-login', v).addEventListener('click', async () => { if (await signIn()) renderAdmin(); });
    return;
  }
  const signOutBtn = '<button type="button" class="btn ghost sm" id="adm-out">로그아웃</button>';
  const bindOut = () => { const b = $('#adm-out', v); if (b) b.addEventListener('click', async () => { await dropGrants(['master']); await S.fb.A.signOut(S.fb.auth); S.user = null; renderAdmin(); }); };
  const { F, db } = S.fb;
  let info = null;
  if (await hasGrant('master')) {
    try { info = Object.fromEntries((await F.getDocs(F.collection(db, 'codeinfo'))).docs.map(s => [s.id, s.data()])); }
    catch (e) { await dropGrants(['master']); info = null; }
  }
  if (!info) {
    v.innerHTML = head + `<div class="adm"><p>${esc(S.user.displayName || '')} 님으로 로그인했습니다. 관리 화면은 단장 코드로만 열립니다.</p><div class="actions"><button type="button" class="btn" id="adm-code">단장 코드 입력</button>${signOutBtn}</div></div>`;
    $('#adm-code', v).addEventListener('click', async () => { if (await askCode('admin')) renderAdmin(); });
    bindOut();
    return;
  }

  const missing = S.docs.filter(d => !d.stored);
  const when = k => info[k] && info[k].at ? '마지막 변경 ' + fmt(info[k].at) : '아직 정하지 않음';
  const codeDocs = S.docs.filter(d => !MASTER_ONLY.includes(d.id));
  v.innerHTML = `<div class="doc-head"><h1>관리</h1><div class="head-row"><p class="edited">${esc(S.user.displayName || '')} 님 · 단장 코드로 들어옴</p>${signOutBtn}</div></div>
    <section class="adm"><h2>처음 문서 넣기</h2>${missing.length
      ? `<p>아직 저장되지 않은 문서 ${missing.length}개: ${missing.map(d => esc(d.title)).join(', ')}</p><div><button type="button" class="btn" id="adm-seed">${missing.length}개 넣기</button></div>`
      : `<p>문서 ${S.docs.length}개가 모두 저장돼 있습니다.</p>`}</section>
    <section class="adm"><h2>단장 코드 바꾸기</h2>
      <p>헌장과 공통 매뉴얼을 포함한 모든 문서, 그리고 모든 코드를 바꿀 수 있는 코드입니다. 바꾸면 이전 코드로 들어와 있던 사람은 새 코드를 다시 입력해야 합니다. ${when('master')}</p>
      <form id="adm-master"><input type="password" id="m1" placeholder="새 단장 코드 (8자 이상)" minlength="8" required autocomplete="new-password"><input type="password" id="m2" placeholder="한 번 더" minlength="8" required autocomplete="new-password"><div><button class="btn" type="submit">단장 코드 바꾸기</button></div></form></section>
    <section class="adm"><h2>문서 코드</h2>
      <p>문서마다 따로 정합니다. 코드는 화면에 다시 보이지 않으니, 정한 코드는 운영 노트에 적어 두세요. 담당자가 바뀌거나 정기적으로 바꿀 때 여기서 새 코드를 넣으면 이전 코드는 바로 막힙니다. 헌장과 공통 매뉴얼은 단장 코드로만 열려서 여기에 없습니다.</p>
      <div class="codes">${codeDocs.map(d => `<div class="code-row"><div class="t"><b>${esc(d.title)}</b><span>${when(d.id)}</span></div>
        <form data-key="${d.id}"><input type="password" placeholder="새 코드 (4자 이상)" minlength="4" required autocomplete="new-password" aria-label="${esc(d.title)} 새 코드"><button class="btn sm" type="submit">저장</button></form></div>`).join('')}</div></section>`;
  bindOut();

  const setCode = async (key, code) => {
    await F.setDoc(F.doc(db, 'secrets', key), { code });
    await F.setDoc(F.doc(db, 'codeinfo', key), { at: F.serverTimestamp(), by: S.user.displayName || '' });
  };
  const seedBtn = $('#adm-seed', v);
  if (seedBtn) seedBtn.addEventListener('click', async () => {
    seedBtn.disabled = true;
    const by = S.user.displayName || '이름 없음';
    let done = 0;
    for (const d of missing) {
      const meta = { title: d.title, short: d.short, floor: d.floor, parent: d.parent || null, order: d.order, sub: d.sub || '', badge: d.badge || '' };
      try {
        await F.setDoc(F.doc(db, 'docs', d.id), { ...meta, body: d.body, version: 1, updatedAt: F.serverTimestamp(), updatedBy: by });
        await F.addDoc(F.collection(db, 'docs', d.id, 'revisions'), { body: d.body, title: d.title, version: 1, savedAt: F.serverTimestamp(), by, summary: '처음 문서' });
        done++;
        seedBtn.textContent = `넣는 중… ${done}/${missing.length}`;
      } catch (e) { console.error(e); toast(d.title + ' 문서를 넣지 못했습니다.'); break; }
    }
    await loadDocs(); renderAll();
    toast(`문서 ${done}개를 넣었습니다.`);
  });
  $('#adm-master', v).addEventListener('submit', async e => {
    e.preventDefault();
    const a = $('#m1', v).value, b = $('#m2', v).value;
    if (a !== b) { toast('두 칸의 코드가 서로 다릅니다.'); return; }
    if (!confirm('단장 코드를 바꿀까요? 새 코드는 운영 노트에 꼭 적어 두세요.')) return;
    try { await setCode('master', a); await tryGrant('master', a); toast('단장 코드를 바꿨습니다.'); renderAdmin(); }
    catch (err) { console.error(err); toast('바꾸지 못했습니다. 단장 코드로 다시 들어와 주세요.'); await dropGrants(['master']); renderAdmin(); }
  });
  $$('.code-row form', v).forEach(f => f.addEventListener('submit', async e => {
    e.preventDefault();
    const key = f.dataset.key, input = $('input', f);
    try { await setCode(key, input.value); input.value = ''; toast(`${S.byId[key].title} 코드를 저장했습니다.`); renderAdmin(); }
    catch (err) { console.error(err); toast('저장하지 못했습니다. 단장 코드로 다시 들어와 주세요.'); await dropGrants(['master']); renderAdmin(); }
  }));
}

/* ───────── 시작 ───────── */

$('#share').addEventListener('toggle', e => { if (e.target.open) { buildShare(); $('#menu').open = false; } });
$('#menu').addEventListener('toggle', e => { if (e.target.open) $('#share').open = false; });
document.addEventListener('click', e => {
  if (!e.target.closest('.bar .menu')) closeMenus();
  const fa = e.target.closest('sup a[href^="#"]'), fli = fnTarget(fa);
  if (fli) {
    e.preventDefault();
    const p = $('#fn-pop');
    if (p && p.dataset.for === fa.getAttribute('href') && !matchMedia('(hover: hover)').matches) closeFnPop(); else openFnPop(fa, fli);
    return;
  }
  if (!e.target.closest('#fn-pop')) closeFnPop();
  const cp = e.target.closest('[data-copy]');
  if (cp) { copyText(cp.dataset.copy, cp); return; }
  const ed = e.target.closest('[data-edit]');
  if (ed) { startEdit(ed.dataset.edit); return; }
  const hi = e.target.closest('[data-history]');
  if (hi) { showHistory(hi.dataset.history); return; }
});
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal' || e.target.closest('.modal-x')) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeFnPop(); if (!$('#modal').hidden) closeModal(); } });
addEventListener('hashchange', () => { closeFnPop(); route(); });
addEventListener('resize', closeFnPop);
if (matchMedia('(hover: hover)').matches) {
  document.addEventListener('mouseover', e => {
    const a = e.target.closest('sup a[href^="#"]'), li = fnTarget(a);
    if (li) { clearTimeout(fnTimer); const p = $('#fn-pop'); if (!p || p.dataset.for !== a.getAttribute('href')) openFnPop(a, li); }
  });
  document.addEventListener('mouseout', e => {
    if (fnTarget(e.target.closest('sup a[href^="#"]'))) fnTimer = setTimeout(closeFnPop, 200);
  });
}
addEventListener('beforeunload', e => {
  const area = $('#editor .ed-area');
  if (S.editing && area && area.innerHTML !== S.editStart) { e.preventDefault(); e.returnValue = ''; }
});

(async function main() {
  try {
    if (!S.preview) await initFirebase();
    await loadDocs();
  } catch (e) {
    console.error(e);
    S.loadError = true;
    S.docs = seedDocs();
    S.home = { ...HOME_SEED, stored: false, version: 0 };
    index();
  }
  renderAll();
  if (S.preview) window.__haeon = { S, startEdit, sanitize, finalize };
})();
