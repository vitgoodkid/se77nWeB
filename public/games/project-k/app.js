(function () {
  'use strict';
  const D = window.WN;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CAT = Object.fromEntries(D.categories.map((c) => [c.id, c]));
  const LANES = [['now', 'Đang làm'], ['next', 'Tiếp theo'], ['later', 'Để sau'], ['idea', 'Ý tưởng'], ['implemented', 'Đã có triển khai']];
  const STATUS = { implemented: 'Đã có code / dữ liệu', partial: 'Đã làm một phần', planned: 'Chưa triển khai' };
  const implementation = item => `<span class="implementation ${esc(item.implementation || 'planned')}">${STATUS[item.implementation] || STATUS.planned}</span>`;
  const fmtDate = (d) => { const [y, m, dd] = d.split('-'); return `${dd}/${m}/${y}`; };
  const fmtStamp = (t) => { const d = new Date(t); const p = (n) => String(n).padStart(2, '0'); return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`; };
  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const state = { q: '', sysCat: 'all', logCat: 'all', logAll: false, weapon: D.weapons[0].id, wimg: 0 };

  const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
  const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const matches = (...parts) => !state.q || norm(parts.flat().join(' ')).includes(norm(state.q));
  function hl(text) {
    const t = esc(text);
    if (!state.q) return t;
    const q = norm(state.q), i = norm(text).indexOf(q);
    if (i < 0) return t;
    return esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length));
  }
  function go(el) {
    if (typeof el === 'string') el = $(el);
    if (!el) return;
    const off = innerWidth <= 1024 ? 68 : 20;
    window.scrollTo({ top: el.getBoundingClientRect().top + scrollY - off, behavior: RM ? 'auto' : 'smooth' });
  }

  // ================================================================ notes (IDs + storage format unchanged)
  const ITEMS = {};
  const NOTE_KEY = 'whosnext.notes.v1';
  const notes = { data: {}, user: null, timer: 0, status: 'local' };
  function loadLocal() { try { return JSON.parse(localStorage.getItem(NOTE_KEY)) || {}; } catch (e) { return {}; } }
  function saveLocal() { try { localStorage.setItem(NOTE_KEY, JSON.stringify(notes.data)); } catch (e) {} }
  function merge(a, b) {
    const out = {};
    for (const k of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
      const byId = {};
      for (const n of [...((a || {})[k] || []), ...((b || {})[k] || [])]) if (!byId[n.id] || (n.updated || 0) > (byId[n.id].updated || 0)) byId[n.id] = n;
      out[k] = Object.values(byId).sort((x, y) => x.created - y.created);
    }
    return out;
  }
  const live = (id) => (notes.data[id] || []).filter((n) => !n.deleted);
  const count = (id) => live(id).length;
  function commit() {
    saveLocal(); refreshBadges(); renderMyNotes();
    if (!notes.user) return;
    clearTimeout(notes.timer); setSync('saving');
    notes.timer = setTimeout(() => {
      fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'whosnextNotes', value: notes.data }) })
        .then((r) => setSync(r.ok ? 'synced' : 'error')).catch(() => setSync('error'));
    }, 600);
  }
  function addNote(id, text) { const t = Date.now(); (notes.data[id] = notes.data[id] || []).push({ id: t.toString(36) + Math.random().toString(36).slice(2, 6), text, created: t, updated: t }); commit(); }
  function editNote(id, nid, text) { const n = (notes.data[id] || []).find((x) => x.id === nid); if (n) { n.text = text; n.updated = Date.now(); commit(); } }
  function deleteNote(id, nid) { const n = (notes.data[id] || []).find((x) => x.id === nid); if (n) { n.deleted = true; n.text = ''; n.updated = Date.now(); commit(); } }
  async function initNotes() {
    setSync('local');
    try {
      const me = await fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null));
      if (!me || !me.user) return;
      notes.user = me.user;
      const r = await fetch('/api/data?key=whosnextNotes');
      if (!r.ok) { setSync('error'); return; }
      notes.data = merge((await r.json()).value || {}, notes.data);
      saveLocal(); refreshBadges(); renderMyNotes(); commit();
    } catch (e) { /* offline / no API */ }
  }
  async function initAccount() {
    await initNotes();
    await initDone();
  }
  function setSync(s) {
    notes.status = s;
    const who = notes.user ? esc(notes.user.displayName || notes.user.username || 'tài khoản') : '';
    const text = {
      local: 'Lưu trên trình duyệt này. <a href="/">Đăng nhập se77n</a> để đồng bộ.',
      saving: `Đang lưu vào tài khoản ${who}…`, synced: `Đã đồng bộ với ${who}.`,
      error: 'Không lưu được lên tài khoản — vẫn giữ trên trình duyệt này.',
    }[s];
    $$('.sync').forEach((el) => { el.innerHTML = text; el.dataset.s = s; });
  }
  function nbtn(id, title, kind, open) {
    ITEMS[id] = { title, kind, open: open || (() => openNotes(id)) };
    const n = count(id);
    return `<button class="nbtn ${n ? 'has' : ''}" data-note="${esc(id)}" title="Ghi chú cho mục này" aria-label="Ghi chú: ${esc(title)}">✎<span>${n || ''}</span></button>`;
  }
  function refreshBadges() {
    $$('[data-note]').forEach((b) => { const n = count(b.dataset.note); b.classList.toggle('has', n > 0); $('span', b).textContent = n || ''; });
    const total = Object.keys(notes.data).reduce((a, id) => a + count(id), 0);
    const nc = $('#nav a[href="#mynotes"] .nc'); if (nc) nc.textContent = total || '';
  }
  function notesBlock(id) {
    const list = live(id);
    return `<div class="notes-block" data-notes-for="${esc(id)}">
      <h5>Ghi chú của bạn${list.length ? ` · ${list.length}` : ''}</h5>
      <div class="nlist">${list.length ? list.map((n) => `
        <div class="nitem" data-nid="${n.id}"><div class="ntext">${esc(n.text)}</div>
          <div class="nmeta"><span>${fmtStamp(n.updated || n.created)}${n.updated && n.updated !== n.created ? ' · đã sửa' : ''}</span><button data-nedit>Sửa</button><button data-ndel>Xoá</button></div></div>`).join('') : '<p class="nempty">Chưa có ghi chú cho mục này.</p>'}</div>
      <form class="nform"><textarea rows="3" placeholder="Viết ghi chú… (Ctrl + Enter để lưu)"></textarea>
        <div class="nform-row"><span class="sync"></span><button type="submit" class="nsave">Thêm ghi chú</button></div></form></div>`;
  }
  function bindNotes(root, id) {
    const box = $('[data-notes-for]', root);
    if (!box) return;
    const ta = $('textarea', box);
    const redraw = () => { box.outerHTML = notesBlock(id); bindNotes(root, id); setSync(notes.status); };
    $('.nform', box).addEventListener('submit', (e) => { e.preventDefault(); const text = ta.value.trim(); if (!text) return; addNote(id, text); redraw(); $('[data-notes-for] textarea', root).focus(); });
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('.nform', box).requestSubmit(); });
    $$('.nitem', box).forEach((it) => {
      const nid = it.dataset.nid;
      $('[data-ndel]', it).addEventListener('click', () => { if (confirm('Xoá ghi chú này?')) { deleteNote(id, nid); redraw(); } });
      $('[data-nedit]', it).addEventListener('click', () => {
        const n = live(id).find((x) => x.id === nid);
        it.innerHTML = `<textarea rows="3">${esc(n.text)}</textarea><div class="nmeta"><span></span><button data-nok>Lưu</button><button data-ncancel>Huỷ</button></div>`;
        const t = $('textarea', it); t.focus();
        $('[data-nok]', it).addEventListener('click', () => { if (t.value.trim()) editNote(id, nid, t.value.trim()); redraw(); });
        $('[data-ncancel]', it).addEventListener('click', redraw);
      });
    });
    setSync(notes.status);
  }
  function openNotes(id) {
    const item = ITEMS[id];
    openDrawer(`<span class="cat">${esc(item ? item.kind : 'Ghi chú')}</span><h2 id="dTitle">${esc(item ? item.title : id)}</h2>${notesBlock(id)}`, id);
  }

  // ================================================================ done / undone
  // Personal Done marks stay separate from the public source audit.
  const DONE_KEY = 'projectk.done.v1';
  const done = { data: {}, timer: 0 };
  const sysId = (s) => 'sys:' + s.id;
  const roadId = (r) => 'road:' + slug(r.title);
  const TRACK = [...D.systems.map((s) => ({ id: sysId(s), cat: s.cat, kind: 'sys', implementation: s.implementation })), ...D.roadmap.map((r) => ({ id: roadId(r), cat: r.cat, kind: 'road', implementation: r.implementation }))];
  function loadDone() { try { return JSON.parse(localStorage.getItem(DONE_KEY)) || {}; } catch (e) { return {}; } }
  function saveDone() { try { localStorage.setItem(DONE_KEY, JSON.stringify(done.data)); } catch (e) {} }
  const isDone = (id) => !!(done.data[id] && done.data[id].d);
  function mergeDone(a, b) {
    const out = {};
    for (const k of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
      const x = (a || {})[k], y = (b || {})[k];
      out[k] = !y || (x && (x.t || 0) >= (y.t || 0)) ? x : y;
    }
    return out;
  }
  function setDoneSync(st) {
    const who = notes.user ? esc(notes.user.displayName || notes.user.username || 'tài khoản') : '';
    const text = {
      local: 'Lưu trên trình duyệt này. <a href="/">Đăng nhập se77n</a> để đồng bộ.',
      saving: `Đang lưu vào tài khoản ${who}…`, synced: `Đã đồng bộ với ${who}.`, error: 'Không lưu được lên tài khoản — vẫn giữ trên trình duyệt này.',
    }[st];
    $$('.dsync').forEach((el) => { el.innerHTML = text; el.dataset.s = st; });
  }
  function pushDone() {
    if (!notes.user) return;
    clearTimeout(done.timer); setDoneSync('saving');
    done.timer = setTimeout(() => {
      fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'projectKDone', value: done.data }) })
        .then((r) => setDoneSync(r.ok ? 'synced' : 'error')).catch(() => setDoneSync('error'));
    }, 600);
  }
  function setDone(id, v) { done.data[id] = { d: v ? 1 : 0, t: Date.now() }; saveDone(); paintDone(); pushDone(); }
  function resetDone() { const t = Date.now(); TRACK.forEach((x) => { if (isDone(x.id)) done.data[x.id] = { d: 0, t }; }); saveDone(); paintDone(); pushDone(); }
  async function initDone() {
    setDoneSync('local');
    if (!notes.user) return;
    try {
      const r = await fetch('/api/data?key=projectKDone');
      if (!r.ok) { setDoneSync('error'); return; }
      done.data = mergeDone((await r.json()).value || {}, done.data);
      saveDone(); paintDone(); pushDone();
    } catch (e) { /* offline / no API */ }
  }
  function doneBtn(id, size) {
    const on = isDone(id);
    return `<button class="donebtn ${size || ''} ${on ? 'on' : ''}" data-done="${esc(id)}" aria-pressed="${on}" title="Đánh dấu cá nhân; không thay đổi tiến độ theo code"><i></i><span>${on ? 'Đã đánh dấu' : 'Tự đánh dấu'}</span></button>`;
  }
  function doneStats() {
    const mine = (f) => TRACK.filter(f);
    const d = (list) => list.filter((x) => x.implementation === 'implemented').length;
    const all = TRACK, sys = mine((x) => x.kind === 'sys'), road = mine((x) => x.kind === 'road');
    return { total: all.length, done: d(all), pct: all.length ? Math.round(100 * d(all) / all.length) : 0, sysDone: d(sys), sysTotal: sys.length, roadDone: d(road), roadTotal: road.length, d, mine };
  }
  function tween(el, to, fmt) {
    const from = +el.dataset.v || 0; el.dataset.v = to;
    const tok = (el._tw = (el._tw || 0) + 1);
    if (RM || from === to) { el.textContent = fmt(to); return; }
    const t0 = performance.now();
    const step = (t) => { if (el._tw !== tok) return; const k = Math.min(1, (t - t0) / 900); el.textContent = fmt(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)))); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }

  // ================================================================ drawer
  function openDrawer(html, noteId) {
    $('#dBody').innerHTML = html;
    if (noteId) bindNotes($('#dBody'), noteId);
    const d = $('#drawer'); d.hidden = false;
    document.body.style.overflow = 'hidden';
    $('.drawer-panel', d).scrollTop = 0;
    $('.x', d).focus();
  }
  function closeDrawer() {
    $('#drawer').hidden = true; document.body.style.overflow = '';
    if (location.hash.startsWith('#sys-')) history.replaceState(null, '', '#systems');
  }

  // ================================================================ hero, overview
  function hero() {
    $('#heroBg').style.backgroundImage = `url(${D.meta.hero})`;
    $('#updated').textContent = fmtDate(D.updated);
    $('#updated2').textContent = fmtDate(D.updated);
    $('#logo').innerHTML = [...D.meta.title].map((ch, i) => ch === ' ' ? `<span class="sp" style="--i:${i}">&nbsp;</span>` : `<span style="--i:${i}">${esc(ch)}</span>`).join('');
    $('#tagline').textContent = D.meta.tagline;
    $('#heroChips').innerHTML = [D.meta.engine, D.meta.platform, 'Single player', 'Đang phát triển'].map((c) => `<span class="chip">${esc(c)}</span>`).join('');
    $('#stats').innerHTML = D.stats.map((s, i) => `<div class="stat" style="--i:${i}"><b data-count="${s.n}">${s.n}</b><span>${esc(s.label)}</span></div>`).join('');
    $('#pitch').textContent = D.meta.pitch;
    $('#loop').innerHTML = D.loop.map((s, i) => `<li style="--i:${i}"><span>${esc(s)}</span></li>`).join('');
    $('#pillars').innerHTML = D.pillars.map((p, i) => `<div class="pillar reveal" style="--d:${i}"><i>${p.icon}</i><b>${esc(p.title)}</b><p>${esc(p.text)}</p></div>`).join('');
  }
  function buildNav() {
    $('#nav').innerHTML = '<a href="weapons.html"><i>↗</i>Catalog vũ khí</a><a href="gear.html"><i>↗</i>Trang bị &amp; nhân vật</a><a href="audio.html"><i>↗</i>Âm thanh</a>' + $$('main > section.sec').map((sec, i) =>
      `<a href="#${sec.id}"><i>${String(i + 1).padStart(2, '0')}</i>${esc($('h2', sec).textContent)}${sec.id === 'mynotes' ? '<span class="nc"></span>' : ''}</a>`).join('');
  }
  function sectionNotes() {
    $$('main > section.sec').forEach((sec, i) => {
      const head = $('.sec-head', sec);
      $('.num', head).textContent = String(i + 1).padStart(2, '0');
      if (sec.id === 'mynotes') return;
      head.insertAdjacentHTML('beforeend', nbtn('sec:' + sec.id, $('h2', head).textContent, 'Phần'));
    });
  }
  function registerAll() {
    const reg = (id, title, kind, open) => { ITEMS[id] = { title, kind, open: open || (() => openNotes(id)) }; };
    D.systems.forEach((s) => reg('sys:' + s.id, s.name, 'Hệ thống', () => openSystem(s.id)));
    D.weapons.forEach((w) => reg('wpn:' + w.id, w.name, 'Vũ khí', () => { state.weapon = w.id; state.wimg = 0; renderWeapons(); go('#weapons'); openNotes('wpn:' + w.id); }));
    D.bosses.forEach((b) => reg('boss:' + slug(b.name), b.name, 'Boss'));
    D.notes.forEach((n) => reg('note:' + slug(n.title), n.title, 'Ghi chú thiết kế'));
    D.roadmap.forEach((r) => reg('road:' + slug(r.title), r.title, 'Sắp tới · ' + LANES.find((l) => l[0] === r.lane)[1]));
    D.changelog.forEach((l) => reg('log:' + l.date + ':' + slug(l.title), l.title, 'Thay đổi ' + fmtDate(l.date)));
    $$('main > section.sec').forEach((sec) => reg('sec:' + sec.id, $('h2', sec).textContent, 'Phần'));
  }
  function countUp(el) {
    const end = +el.dataset.count;
    if (RM) { el.textContent = end; return; }
    const t0 = performance.now();
    const step = (t) => { const k = Math.min(1, (t - t0) / 1400); el.textContent = Math.round(end * (1 - Math.pow(1 - k, 4))); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }

  // ================================================================ progress dashboard
  function progress() {
    const r = 80, c = 2 * Math.PI * r;
    $('#progressTotal').innerHTML = `
      <h3 class="panel-h">Theo code / dữ liệu</h3>
      <div class="ring"><svg width="190" height="190" viewBox="0 0 190 190">
        <circle cx="95" cy="95" r="${r}" fill="none" stroke="var(--bg3)" stroke-width="10"/>
        <circle id="ringArc" cx="95" cy="95" r="${r}" fill="none" stroke="var(--gold)" stroke-width="10" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c}" style="transition: stroke-dashoffset 1.4s cubic-bezier(.2,.7,.2,1)"/>
      </svg><b id="ringNum" data-v="0">0%</b><small>mục đã có triển khai</small></div>
      <div class="ring-title" id="ringTitle"></div>
      <div class="legend"><span>Có triển khai<b id="lgDone">0</b></span><span>Một phần / kế hoạch<b id="lgUndone">0</b></span>
        <span class="lg-sub">Hệ thống<b id="lgSys"></b></span><span class="lg-sub">Việc sắp tới<b id="lgRoad"></b></span></div>
      <p class="done-note">Tỷ lệ số mục trong danh sách có triển khai, không phải % hoàn thiện game. Đối chiếu source ngày ${fmtDate(D.updated)}; chưa chạy lại Unity. <a href="status-data.json">Nguồn & số đếm</a>.</p>
      <p class="done-note">Dấu cá nhân lưu riêng. <span class="dsync"></span></p>
      <button class="tool" id="doneReset">↺ Xoá dấu cá nhân</button>`;
    $('#progressTotal').dataset.c = c;
    $('#progressBars').innerHTML = D.categories.map((cat, i) => {
      if (!TRACK.some((x) => x.cat === cat.id)) return '';
      return `<div class="pbar" data-cat="${cat.id}" title="Lọc hệ thống: ${esc(cat.label)}"><div class="name">${esc(cat.label)}<small data-frac></small></div>
        <div class="track"><div class="fill" style="--i:${i}" data-w="0"></div></div><div class="pct" data-v="0">0%</div></div>`;
    }).join('');
    $$('.pbar').forEach((b) => b.addEventListener('click', () => { state.sysCat = b.dataset.cat; renderSystems(); go('#systems'); }));
    $('#doneReset').addEventListener('click', () => { if (confirm('Xoá dấu cá nhân? Tiến độ theo code giữ nguyên.')) resetDone(); });
    const last = D.changelog[0].date;
    $('#latestDate').textContent = fmtDate(last);
    $('#latestList').innerHTML = D.changelog.filter((l) => l.date === last).map((l) => `<li>${esc(l.title)}</li>`).join('');
    paintNow();
    paintProgress();
    setDoneSync('local');
  }
  // Items on the "now" lane that are not Done yet.
  function paintNow() {
    const list = D.roadmap.filter((r) => r.lane === 'now' && r.implementation !== 'implemented');
    $('#nowList').innerHTML = list.length ? list.map((r) =>
      `<div class="now-item"><span>${esc(CAT[r.cat].label)}</span><b>${esc(r.title)}</b>${nbtn(roadId(r), r.title, 'Sắp tới · Đang làm')}${doneBtn(roadId(r), 'sm')}</div>`).join('')
      : '<p class="empty small">Chưa có mục đang làm trong lần đối chiếu này.</p>';
  }
  function paintProgress() {
    const st = doneStats();
    const arc = $('#ringArc');
    if (arc) arc.style.strokeDashoffset = +$('#progressTotal').dataset.c * (1 - st.pct / 100);
    tween($('#ringNum'), st.pct, (n) => n + '%');
    $('#ringTitle').textContent = `${st.done} / ${st.total} mục đã có triển khai`;
    $('#lgDone').textContent = st.done; $('#lgUndone').textContent = st.total - st.done;
    $('#lgSys').textContent = `${st.sysDone} / ${st.sysTotal}`; $('#lgRoad').textContent = `${st.roadDone} / ${st.roadTotal}`;
    $$('#progressBars .pbar').forEach((row) => {
      const list = st.mine((x) => x.cat === row.dataset.cat), n = st.d(list), p = Math.round(100 * n / list.length);
      $('.fill', row).style.width = p + '%';
      $('small', row).textContent = `${n}/${list.length}`;
      tween($('.pct', row), p, (v) => v + '%');
    });
  }
  function paintDone() {
    paintNow();
    $$('[data-done]').forEach((b) => {
      const on = isDone(b.dataset.done);
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); $('span', b).textContent = on ? 'Đã đánh dấu' : 'Tự đánh dấu';
      const host = b.closest('.card, .ritem'); if (host) host.classList.toggle('is-done', on);
    });
    $$('[data-hint]').forEach((h) => { h.textContent = 'Dấu cá nhân không thay đổi trạng thái theo code.'; });
    paintProgress();
  }
  function animateProgress() { paintProgress(); }

  // ================================================================ systems
  function chipRow(el, key, counts, onPick) {
    el.innerHTML = [`<button class="fchip ${state[key] === 'all' ? 'on' : ''}" data-v="all">Tất cả <small>${counts.all}</small></button>`]
      .concat(D.categories.filter((c) => counts[c.id] !== undefined).map((c) => `<button class="fchip ${state[key] === c.id ? 'on' : ''}" data-v="${c.id}">${esc(c.label)} <small>${counts[c.id]}</small></button>`)).join('');
    $$('.fchip', el).forEach((b) => b.addEventListener('click', () => { state[key] = b.dataset.v; onPick(); }));
  }
  function renderSystems() {
    const visible = D.systems.filter((s) => matches(s.name, s.summary, s.details, CAT[s.cat].label));
    const counts = { all: visible.length };
    visible.forEach((s) => { counts[s.cat] = (counts[s.cat] || 0) + 1; });
    if (state.sysCat !== 'all' && counts[state.sysCat] === undefined) counts[state.sysCat] = 0;
    chipRow($('#sysFilters'), 'sysCat', counts, renderSystems);
    const list = visible.filter((s) => state.sysCat === 'all' || s.cat === state.sysCat);
    $('#sysCards').innerHTML = list.map((s, i) => `
      <article class="card ${isDone(sysId(s)) ? 'is-done' : ''}" tabindex="0" role="button" data-id="${s.id}" style="--i:${i}">
        <div class="card-top"><span class="cat">${esc(CAT[s.cat].label)}</span>${implementation(s)}</div>
        <h4>${hl(s.name)}</h4><p>${hl(s.summary)}</p>
        <div class="nums">${(s.numbers || []).slice(0, 3).map(([k, v]) => `<span>${esc(k)} <b>${esc(v)}</b></span>`).join('')}</div>
        <span class="arrow">→</span>
        <div class="card-foot">${doneBtn(sysId(s))}${nbtn('sys:' + s.id, s.name, 'Hệ thống', () => openSystem(s.id))}</div>
      </article>`).join('');
    $('#sysEmpty').hidden = list.length > 0;
    $$('#sysCards .card').forEach((b) => {
      b.addEventListener('click', (e) => { if (!e.target.closest('[data-note], [data-done]')) openSystem(b.dataset.id); });
      b.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === b) openSystem(b.dataset.id); });
    });
  }
  function openSystem(id) {
    const s = D.systems.find((x) => x.id === id);
    if (!s) return;
    const c = CAT[s.cat];
    const logs = D.changelog.filter((l) => l.cats.includes(s.cat));
    const road = D.roadmap.filter((r) => r.cat === s.cat);
    const noteId = 'sys:' + s.id;
    ITEMS[noteId] = { title: s.name, kind: 'Hệ thống', open: () => openSystem(id) };
    openDrawer(`
      <span class="cat">${esc(c.label)}</span>
      <h2 id="dTitle">${esc(s.name)}</h2>
      <p class="lead">${esc(s.summary)}</p>
      <div class="meta-row done-row">${implementation(s)}${doneBtn(sysId(s), 'lg')}<span class="done-hint" data-hint="${sysId(s)}">Dấu cá nhân không thay đổi trạng thái theo code.</span></div>
      ${(s.evidence || []).length ? `<details class="source-evidence"><summary>Nguồn đối chiếu</summary><ul>${s.evidence.map(p => `<li><code>${esc(p)}</code></li>`).join('')}</ul><p>Đọc source/asset; không phải kết quả chạy thử mới.</p></details>` : ''}
      ${notesBlock(noteId)}
      <h5>Chi tiết</h5><ul class="det">${s.details.map((d) => `<li>${hl(d)}</li>`).join('')}</ul>
      ${s.numbers && s.numbers.length ? `<h5>Số liệu</h5><table class="table">${s.numbers.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>` : ''}
      <h5>Sắp tới · ${esc(c.label)}</h5>
      ${road.length ? road.map((r) => `<div class="ritem ${isDone(roadId(r)) ? 'is-done' : ''}"><span class="tag">${esc(LANES.find((l) => l[0] === r.lane)[1])}</span><b>${esc(r.title)}</b><p>${esc(r.text)}</p></div>`).join('') : '<p class="lead">Chưa có mục nào.</p>'}
      <h5>Nhật ký · ${esc(c.label)}</h5>
      ${logs.length ? logs.map((l) => `<div class="entry"><div class="entry-h"><span class="mono date">${fmtDate(l.date)}</span><b>${esc(l.title)}</b></div><ul>${l.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>`).join('') : '<p class="lead">Chưa có ghi chú.</p>'}`, noteId);
    history.replaceState(null, '', '#sys-' + id);
  }

  // ================================================================ weapons
  function renderWeapons() {
    $('#wTabs').innerHTML = D.weapons.map((w, i) => `<button class="wtab ${w.id === state.weapon ? 'on' : ''}" role="tab" data-id="${w.id}"><i>${String(i + 1).padStart(2, '0')}</i><b>${esc(w.name)}</b><small>${count('wpn:' + w.id) ? '✎' + count('wpn:' + w.id) : ''}</small></button>`).join('');
    $$('.wtab').forEach((b) => b.addEventListener('click', () => { if (state.weapon === b.dataset.id) return; state.weapon = b.dataset.id; state.wimg = 0; renderWeapons(); }));
    const w = D.weapons.find((x) => x.id === state.weapon);
    $('#wView').innerHTML = `
      <div class="wstage">
        <div class="wmain-wrap"><img class="wmain" src="${w.img[state.wimg]}" alt="${esc(w.name)}" data-lightbox></div>
        ${w.img.length > 1 ? `<div class="wthumbs">${w.img.map((src, i) => `<button class="wthumb ${i === state.wimg ? 'on' : ''}" data-i="${i}" aria-label="Ảnh ${i + 1}"><img src="${src}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}
      </div>
      <div class="winfo"><span class="kicker">Bộ đòn ${String(D.weapons.indexOf(w) + 1).padStart(2, '0')} / ${String(D.weapons.length).padStart(2, '0')}</span>
        <div class="winfo-h"><h3>${esc(w.name)}</h3>${nbtn('wpn:' + w.id, w.name, 'Vũ khí')}</div>
        <p>${esc(w.text)}</p><ul class="facts">${w.facts.map((f, i) => `<li style="--i:${i}">${esc(f)}</li>`).join('')}</ul></div>`;
    $$('.wthumb').forEach((b) => b.addEventListener('click', () => {
      state.wimg = +b.dataset.i;
      const m = $('.wmain'); m.src = w.img[state.wimg]; m.style.animation = 'none'; void m.offsetWidth; m.style.animation = '';
      $$('.wthumb').forEach((t) => t.classList.toggle('on', t === b));
    }));
  }

  // ================================================================ static parts
  function staticParts() {
    $('#rooms').innerHTML = '<tr><th>Phòng</th><th>Cỡ</th><th>Ghi chú</th></tr>' + D.castleRooms.map(([n, s, t]) => `<tr><td>${esc(n)}</td><td>${esc(s)}</td><td>${esc(t)}</td></tr>`).join('');
    $('#bosses').innerHTML = D.bosses.map((b, i) => `
      <div class="boss reveal" style="--d:${i % 4}"><span class="bn">${String(i + 1).padStart(2, '0')}</span><div class="boss-h"><b>${esc(b.name)}</b>${nbtn('boss:' + slug(b.name), b.name, 'Boss')}</div>
        <span class="where">${esc(b.where)}</span><span class="el">${esc(b.element)}</span><p>${esc(b.note)}</p></div>`).join('');
    $('#keys').innerHTML = D.controls.map(([k, v], i) => `<div class="key reveal" style="--d:${i % 4}"><kbd>${esc(k)}</kbd><span>${esc(v)}</span></div>`).join('');
    $('#notesBox').innerHTML = D.notes.map((n, i) => `<div class="dnote reveal" style="--d:${i}"><div class="boss-h"><h3>${esc(n.title)}</h3>${nbtn('note:' + slug(n.title), n.title, 'Ghi chú thiết kế')}</div><ul>${n.items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`).join('');
    $('#galleryBox').innerHTML = D.gallery.map(([src, cap], i) => `<figure class="reveal" style="--d:${i % 3}"><img src="${src}" alt="${esc(cap)}" loading="lazy" data-lightbox><figcaption>${esc(cap)}</figcaption></figure>`).join('');
    $('#techTable').innerHTML = D.tech.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('');
  }

  // ================================================================ roadmap, changelog
  function renderRoadmap() {
    $('#kanban').innerHTML = LANES.map(([lane, label]) => {
      const items = D.roadmap.filter((r) => r.lane === lane && matches(r.title, r.text, CAT[r.cat].label));
      return `<div class="lane" data-lane="${lane}"><div class="lane-h"><b>${label}</b><span>${items.length}</span></div>
        ${items.map((r, i) => `<div class="ritem ${isDone(roadId(r)) ? 'is-done' : ''}" style="--i:${i}"><div class="ritem-h"><span class="tag">${esc(CAT[r.cat].label)}</span><span class="ritem-act">${doneBtn(roadId(r), 'sm')}${nbtn('road:' + slug(r.title), r.title, 'Sắp tới · ' + label)}</span></div>${implementation(r)}<b>${hl(r.title)}</b><p>${hl(r.text)}</p></div>`).join('') || '<p class="empty">—</p>'}</div>`;
    }).join('');
  }
  const WD = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
  const LOG_DAYS = 3; // newest days shown before "show older"
  function logStats() {
    const last = D.changelog[0].date, today = D.changelog.filter((l) => l.date === last);
    const days = new Set(D.changelog.map((l) => l.date)).size;
    const bullets = D.changelog.reduce((a, l) => a + l.items.length, 0);
    $('#logStats').innerHTML = `
      <div class="ls main"><span>Cập nhật gần nhất</span><b>${fmtDate(last)}</b><small>${WD[new Date(...last.split('-').map((v, i) => (i === 1 ? v - 1 : +v))).getDay()]}</small></div>
      <div class="ls"><span>Trong ngày đó</span><b>${today.length}</b><small>thay đổi lớn</small></div>
      <div class="ls"><span>Tổng cộng</span><b>${D.changelog.length}</b><small>thay đổi · ${bullets} ý</small></div>
      <div class="ls"><span>Đã ghi</span><b>${days}</b><small>ngày làm việc</small></div>`;
  }
  function renderLog() {
    const visible = D.changelog.filter((l) => matches(l.title, l.items, l.cats.map((c) => CAT[c].label)));
    const counts = { all: visible.length };
    visible.forEach((l) => l.cats.forEach((c) => { counts[c] = (counts[c] || 0) + 1; }));
    if (state.logCat !== 'all' && counts[state.logCat] === undefined) counts[state.logCat] = 0;
    chipRow($('#logFilters'), 'logCat', counts, renderLog);
    const list = visible.filter((l) => state.logCat === 'all' || l.cats.includes(state.logCat));
    const days = [];
    list.forEach((l) => { let d = days.find((x) => x.date === l.date); if (!d) days.push(d = { date: l.date, items: [] }); d.items.push(l); });
    const collapse = !state.q && state.logCat === 'all' && !state.logAll && days.length > LOG_DAYS;
    const shown = collapse ? days.slice(0, LOG_DAYS) : days;
    const newest = D.changelog[0].date;
    $('#timeline').innerHTML = shown.map((d) => {
      const [y, m, dd] = d.date.split('-');
      const latest = d.date === newest;
      return `<div class="day ${latest ? 'newest' : ''}"><div class="day-h"><b>${dd}</b><em>Tháng ${+m}</em><span>${WD[new Date(+y, m - 1, +dd).getDay()]} · ${y}</span>${latest ? '<i class="newpill"><s></s>Mới nhất</i>' : ''}</div><div class="day-items">
      ${d.items.map((l) => `<div class="entry reveal"><div class="entry-h"><b>${hl(l.title)}</b>${l.cats.map((c) => `<span class="tag">${esc(CAT[c].label)}</span>`).join('')}${nbtn('log:' + l.date + ':' + slug(l.title), l.title, 'Thay đổi ' + fmtDate(l.date))}</div>
        <ul>${l.items.map((i) => `<li>${hl(i)}</li>`).join('')}</ul></div>`).join('')}</div></div>`;
    }).join('');
    const more = $('#logMore');
    more.hidden = !collapse;
    if (collapse) more.textContent = `↓ Xem ${days.length - LOG_DAYS} ngày cũ hơn`;
    $('#logEmpty').hidden = list.length > 0;
    observeReveals();
  }

  // ================================================================ my notes
  function renderMyNotes() {
    const box = $('#myNotes');
    if (!box) return;
    const ids = Object.keys(notes.data).filter((id) => count(id) > 0).sort((a, b) => Math.max(...live(b).map((n) => n.updated)) - Math.max(...live(a).map((n) => n.updated)));
    const total = ids.reduce((a, id) => a + count(id), 0);
    $('#myNotesCount').textContent = total ? `${total} ghi chú ở ${ids.length} mục` : 'Chưa có ghi chú nào';
    box.innerHTML = ids.length ? ids.map((id, i) => {
      const it = ITEMS[id] || { title: id, kind: '' };
      return `<div class="mynote" style="--i:${i}"><div class="mynote-h"><span class="cat">${esc(it.kind)}</span><b>${esc(it.title)}</b><button class="link" data-open="${esc(id)}">Mở mục →</button></div>
        ${live(id).map((n) => `<div class="ntext small">${esc(n.text)}<span class="nstamp">${fmtStamp(n.updated)}</span></div>`).join('')}</div>`;
    }).join('') : '<p class="nempty">Bấm nút ✎ trên bất kỳ mục nào — hệ thống, vũ khí, boss, lộ trình, nhật ký, đầu mỗi phần — để thêm ghi chú.</p>';
    $$('[data-open]', box).forEach((b) => b.addEventListener('click', () => (ITEMS[b.dataset.open] ? ITEMS[b.dataset.open].open() : openNotes(b.dataset.open))));
  }
  function exportNotes() {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(notes.data, null, 2)], { type: 'application/json' }));
    a.download = `project-k-notes-${new Date().toISOString().slice(0, 10)}.json`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function importNotes(file) { file.text().then((t) => { notes.data = merge(notes.data, JSON.parse(t)); commit(); }).catch(() => alert('File không đúng định dạng.')); }

  // ================================================================ lightbox
  let lbList = [], lbIndex = 0;
  function openLightbox(img) {
    lbList = $$('img[data-lightbox]').filter((i) => i.offsetParent !== null);
    lbIndex = Math.max(0, lbList.indexOf(img));
    showLb(); $('#lightbox').hidden = false; document.body.style.overflow = 'hidden';
  }
  function showLb() {
    const img = lbList[lbIndex]; if (!img) return;
    const el = $('#lbImg'); el.src = img.currentSrc || img.src; el.alt = img.alt;
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    $('#lbCap').textContent = img.closest('figure')?.querySelector('figcaption')?.textContent || img.alt;
  }
  function closeLb() { $('#lightbox').hidden = true; document.body.style.overflow = ''; }

  // ================================================================ motion
  let revealIO;
  function observeReveals() {
    if (!revealIO) return;
    $$('.reveal:not(.in), .sec-head:not(.in), .loop:not(.in)').forEach((r) => revealIO.observe(r));
  }
  function embers() {
    const cv = $('#embers'); if (!cv || RM) return;
    const ctx = cv.getContext('2d');
    let w, h, dpr, running = true;
    const P = [];
    const size = () => { dpr = Math.min(2, devicePixelRatio || 1); w = cv.clientWidth; h = cv.clientHeight; cv.width = w * dpr; cv.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    const spawn = (p = {}) => Object.assign(p, { x: Math.random() * w, y: h + Math.random() * h * .5, r: .6 + Math.random() * 2, vy: .25 + Math.random() * .8, vx: (Math.random() - .5) * .3, ph: Math.random() * 6.28, life: 0, max: 300 + Math.random() * 400, hue: 25 + Math.random() * 20 });
    size(); addEventListener('resize', size);
    const N = Math.round(Math.min(80, w / 18));
    for (let i = 0; i < N; i++) { const p = spawn(); p.y = Math.random() * h; P.push(p); }
    new IntersectionObserver(([e]) => { running = e.isIntersecting; if (running) requestAnimationFrame(tick); }).observe(cv);
    function tick() {
      if (!running) return;
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';
      for (const p of P) {
        p.life++; p.ph += .02; p.y -= p.vy; p.x += p.vx + Math.sin(p.ph) * .35;
        const a = Math.sin(Math.min(1, p.life / p.max) * Math.PI) * .9;
        if (p.y < -10 || p.life > p.max) spawn(p);
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4);
        g.addColorStop(0, `hsla(${p.hue},95%,70%,${a})`); g.addColorStop(1, `hsla(${p.hue},95%,50%,0)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 4, 0, 6.29); ctx.fill();
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // ================================================================ wiring
  function wire() {
    const side = $('#side');
    const closeSide = () => side.classList.remove('open');
    document.addEventListener('click', (e) => {
      const db = e.target.closest('[data-done]');
      if (db) { e.stopPropagation(); setDone(db.dataset.done, !isDone(db.dataset.done)); return; }
      const nb = e.target.closest('[data-note]');
      if (nb) { e.stopPropagation(); const it = ITEMS[nb.dataset.note]; it && it.kind === 'Hệ thống' ? it.open() : openNotes(nb.dataset.note); return; }
      const img = e.target.closest('img[data-lightbox]');
      if (img) { openLightbox(img); return; }
      const a = e.target.closest('a[href^="#"]');
      if (a && a.getAttribute('href').length > 1) { const t = $(a.getAttribute('href')); if (t) { e.preventDefault(); closeSide(); go(t); history.replaceState(null, '', a.getAttribute('href')); return; } }
      if (e.target.closest('[data-close]')) closeDrawer();
      if (e.target.closest('[data-lb-close]') || e.target.id === 'lightbox') closeLb();
      const nav = e.target.closest('[data-lb]');
      if (nav) { lbIndex = (lbIndex + +nav.dataset.lb + lbList.length) % lbList.length; showLb(); }
    });
    $('#menuBtn').addEventListener('click', () => side.classList.toggle('open'));
    $('#sideScrim').addEventListener('click', closeSide);
    $('#searchBtn').addEventListener('click', () => { side.classList.add('open'); setTimeout(() => $('#q').focus(), 300); });
    document.addEventListener('keydown', (e) => {
      if (!$('#lightbox').hidden) {
        if (e.key === 'Escape') closeLb();
        if (e.key === 'ArrowRight') { lbIndex = (lbIndex + 1) % lbList.length; showLb(); }
        if (e.key === 'ArrowLeft') { lbIndex = (lbIndex - 1 + lbList.length) % lbList.length; showLb(); }
        return;
      }
      if (e.key === 'Escape') { if (!$('#drawer').hidden) closeDrawer(); else closeSide(); }
      const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
      if (e.key === '/' && !typing) { e.preventDefault(); if (innerWidth <= 1024) side.classList.add('open'); $('#q').focus(); }
    });

    let timer;
    $('#q').addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        state.q = $('#q').value.trim();
        renderSystems(); renderRoadmap(); renderLog();
        const info = $('#qInfo');
        if (!state.q) { info.hidden = true; return; }
        const s = D.systems.filter((x) => matches(x.name, x.summary, x.details, CAT[x.cat].label)).length;
        const r = D.roadmap.filter((x) => matches(x.title, x.text, CAT[x.cat].label)).length;
        const l = D.changelog.filter((x) => matches(x.title, x.items, x.cats.map((c) => CAT[c].label))).length;
        info.hidden = false; info.textContent = `${s} hệ thống · ${r} lộ trình · ${l} nhật ký`;
      }, 120);
    });
    $('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { closeSide(); go('#systems'); } });
    $('#theme').addEventListener('click', () => {
      const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('whosnext.theme', next); } catch (e) {}
    });
    $('#logMore').addEventListener('click', () => { state.logAll = true; renderLog(); });
    $('#notesExport').addEventListener('click', exportNotes);
    $('#notesImport').addEventListener('change', (e) => { if (e.target.files[0]) importNotes(e.target.files[0]); e.target.value = ''; });

    // spotlight on cards
    $('#sysCards').addEventListener('pointermove', (e) => {
      const c = e.target.closest('.card'); if (!c) return;
      const r = c.getBoundingClientRect();
      c.style.setProperty('--mx', (e.clientX - r.left) + 'px'); c.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });

    // scroll progress + hero parallax
    const line = $('#scrollLine'), bg = $('#heroBg'), heroIn = $('.hero-in');
    let ticking = false;
    const onScroll = () => {
      ticking = false;
      const max = document.documentElement.scrollHeight - innerHeight;
      line.style.transform = `scaleX(${max > 0 ? scrollY / max : 0})`;
      if (!RM && scrollY < innerHeight) { bg.style.translate = `0 ${scrollY * .3}px`; heroIn.style.transform = `translateY(${scrollY * .15}px)`; heroIn.style.opacity = 1 - scrollY / (innerHeight * .8); }
    };
    addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
    onScroll();

    const links = $$('#nav a');
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) links.forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + en.target.id)); });
    }, { rootMargin: '-40% 0px -55% 0px' });
    $$('main > section[id]').forEach((s) => io.observe(s));

    const once = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        once.unobserve(en.target);
        if (en.target.id === 'stats') { en.target.classList.add('in'); $$('#stats [data-count]').forEach(countUp); }
        else if (en.target.id === 'progressTotal') { en.target.classList.add('in'); animateProgress(); }
      });
    }, { threshold: .25 });
    once.observe($('#stats')); once.observe($('#progressTotal'));
    revealIO = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) { revealIO.unobserve(en.target); en.target.classList.add('in'); } });
    }, { threshold: .12, rootMargin: '0px 0px -40px 0px' });
    observeReveals();
    embers();

    if (location.hash.startsWith('#sys-')) openSystem(location.hash.slice(5));
  }

  notes.data = loadLocal();
  done.data = loadDone();
  hero();
  logStats();
  buildNav();
  progress();
  renderSystems();
  renderWeapons();
  staticParts();
  renderRoadmap();
  renderLog();
  sectionNotes();
  registerAll();
  renderMyNotes();
  refreshBadges();
  wire();
  initAccount();
})();
