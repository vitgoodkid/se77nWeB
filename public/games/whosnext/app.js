(function () {
  'use strict';
  const D = window.WN;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CAT = Object.fromEntries(D.categories.map((c) => [c.id, c]));
  const STATUS = { done: '✓ Hoàn thành', wip: '◐ Đang làm', planned: '○ Kế hoạch' };
  const LANES = [['now', 'Đang làm'], ['next', 'Tiếp theo'], ['later', 'Để sau'], ['idea', 'Ý tưởng']];
  const fmtDate = (d) => { const [y, m, dd] = d.split('-'); return `${dd}/${m}/${y}`; };
  const fmtStamp = (t) => { const d = new Date(t); const p = (n) => String(n).padStart(2, '0'); return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`; };

  const state = { q: '', sysCat: 'all', logCat: 'all', weapon: D.weapons[0].id, noteItem: null };

  // Search: lower-case, accents removed, so "deflect", "lua" and "lửa" all find their matches.
  const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
  const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const matches = (...parts) => !state.q || norm(parts.flat().join(' ')).includes(norm(state.q));
  function hl(text) {
    const t = esc(text);
    if (!state.q) return t;
    const q = norm(state.q), i = norm(text).indexOf(q);
    if (i < 0) return t;
    return esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length));
  }

  // ================================================================ notes
  // Every item of the page can carry the reader's notes: kept in this browser, and synced to the se77n account
  // (/api/data, key whosnextNotes) when signed in. Deleted notes stay as tombstones so a merge never brings them back.

  const ITEMS = {};            // note id -> { title, kind, open() }
  const NOTE_KEY = 'whosnext.notes.v1';
  const notes = { data: {}, user: null, timer: 0, status: 'local' };

  function loadLocal() { try { return JSON.parse(localStorage.getItem(NOTE_KEY)) || {}; } catch (e) { return {}; } }
  function saveLocal() { try { localStorage.setItem(NOTE_KEY, JSON.stringify(notes.data)); } catch (e) {} }
  function merge(a, b) {
    const out = {};
    for (const k of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
      const byId = {};
      for (const n of [...((a || {})[k] || []), ...((b || {})[k] || [])]) {
        if (!byId[n.id] || (n.updated || 0) > (byId[n.id].updated || 0)) byId[n.id] = n;
      }
      out[k] = Object.values(byId).sort((x, y) => x.created - y.created);
    }
    return out;
  }
  const live = (id) => (notes.data[id] || []).filter((n) => !n.deleted);
  const count = (id) => live(id).length;

  function commit() {
    saveLocal();
    refreshBadges();
    renderMyNotes();
    if (!notes.user) return;
    clearTimeout(notes.timer);
    setSync('saving');
    notes.timer = setTimeout(() => {
      fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'whosnextNotes', value: notes.data }) })
        .then((r) => setSync(r.ok ? 'synced' : 'error')).catch(() => setSync('error'));
    }, 600);
  }

  function addNote(id, text) {
    const t = Date.now();
    (notes.data[id] = notes.data[id] || []).push({ id: t.toString(36) + Math.random().toString(36).slice(2, 6), text, created: t, updated: t });
    commit();
  }
  function editNote(id, nid, text) { const n = (notes.data[id] || []).find((x) => x.id === nid); if (n) { n.text = text; n.updated = Date.now(); commit(); } }
  function deleteNote(id, nid) { const n = (notes.data[id] || []).find((x) => x.id === nid); if (n) { n.deleted = true; n.text = ''; n.updated = Date.now(); commit(); } }

  async function initNotes() {
    notes.data = loadLocal();
    setSync('local');
    try {
      const me = await fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null));
      if (!me || !me.user) return;
      notes.user = me.user;
      const r = await fetch('/api/data?key=whosnextNotes');
      if (!r.ok) { setSync('error'); return; }
      const server = (await r.json()).value || {};
      notes.data = merge(server, notes.data);
      saveLocal();
      refreshBadges();
      renderMyNotes();
      commit();
    } catch (e) { /* offline or no API (local dev): browser only */ }
  }

  function setSync(s) {
    notes.status = s;
    const who = notes.user ? esc(notes.user.displayName || notes.user.username || 'tài khoản') : '';
    const text = {
      local: 'Ghi chú lưu trên trình duyệt này. <a href="/">Đăng nhập se77n</a> để đồng bộ giữa các máy.',
      saving: `Đang lưu vào tài khoản ${who}…`,
      synced: `Đã đồng bộ với tài khoản ${who}.`,
      error: 'Không lưu được lên tài khoản — vẫn giữ trên trình duyệt này.',
    }[s];
    $$('.sync').forEach((el) => { el.innerHTML = text; el.dataset.s = s; });
  }

  /** A note button for an item: a pen and how many notes it has. */
  function nbtn(id, title, kind, open) {
    ITEMS[id] = { title, kind, open: open || (() => openNotes(id)) };
    const n = count(id);
    return `<button class="nbtn ${n ? 'has' : ''}" data-note="${esc(id)}" title="Ghi chú cho mục này" aria-label="Ghi chú: ${esc(title)}">✎<span>${n || ''}</span></button>`;
  }
  function refreshBadges() {
    $$('[data-note]').forEach((b) => {
      const n = count(b.dataset.note);
      b.classList.toggle('has', n > 0);
      $('span', b).textContent = n || '';
    });
  }

  /** The note list and form for one item (inside a drawer). */
  function notesBlock(id) {
    const list = live(id);
    return `<div class="notes-block" data-notes-for="${esc(id)}">
      <h5>Ghi chú của bạn ${list.length ? `· ${list.length}` : ''}</h5>
      <div class="nlist">${list.length ? list.map((n) => `
        <div class="nitem" data-nid="${n.id}">
          <div class="ntext">${esc(n.text)}</div>
          <div class="nmeta"><span>${fmtStamp(n.updated || n.created)}${n.updated && n.updated !== n.created ? ' · đã sửa' : ''}</span>
            <button data-nedit>Sửa</button><button data-ndel>Xoá</button></div>
        </div>`).join('') : '<p class="nempty">Chưa có ghi chú cho mục này.</p>'}</div>
      <form class="nform">
        <textarea rows="3" placeholder="Viết ghi chú… (Ctrl + Enter để lưu)"></textarea>
        <div class="nform-row"><span class="sync"></span><button type="submit" class="nsave">Thêm ghi chú</button></div>
      </form>
    </div>`;
  }

  function bindNotes(root, id) {
    const box = $('[data-notes-for]', root);
    if (!box) return;
    const ta = $('textarea', box);
    const redraw = () => { box.outerHTML = notesBlock(id); bindNotes(root, id); setSync(notes.status); };
    $('.nform', box).addEventListener('submit', (e) => {
      e.preventDefault();
      const text = ta.value.trim();
      if (!text) return;
      addNote(id, text);
      redraw();
      $('[data-notes-for] textarea', root).focus();
    });
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('.nform', box).requestSubmit(); });
    $$('.nitem', box).forEach((it) => {
      const nid = it.dataset.nid;
      $('[data-ndel]', it).addEventListener('click', () => { if (confirm('Xoá ghi chú này?')) { deleteNote(id, nid); redraw(); } });
      $('[data-nedit]', it).addEventListener('click', () => {
        const n = live(id).find((x) => x.id === nid);
        it.innerHTML = `<textarea rows="3">${esc(n.text)}</textarea><div class="nmeta"><span></span><button data-nok>Lưu</button><button data-ncancel>Huỷ</button></div>`;
        const t = $('textarea', it);
        t.focus();
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

  // ================================================================ drawer

  function openDrawer(html, noteId) {
    $('#dBody').innerHTML = html;
    if (noteId) bindNotes($('#dBody'), noteId);
    const d = $('#drawer');
    d.hidden = false;
    document.body.style.overflow = 'hidden';
    $('.drawer-panel', d).scrollTop = 0;
    $('.x', d).focus();
  }
  function closeDrawer() {
    $('#drawer').hidden = true;
    document.body.style.overflow = '';
    if (location.hash.startsWith('#sys-')) history.replaceState(null, '', '#systems');
  }

  // ================================================================ hero, overview

  function hero() {
    $('#heroBg').style.backgroundImage = `url(${D.meta.hero})`;
    $('#updated').textContent = fmtDate(D.updated);
    $('#updated2').textContent = fmtDate(D.updated);
    $('#tagline').textContent = D.meta.tagline;
    $('#heroChips').innerHTML = [D.meta.engine, D.meta.platform, 'Single player', 'Đang phát triển'].map((c) => `<span class="chip">${esc(c)}</span>`).join('');
    $('#stats').innerHTML = D.stats.map((s) => `<div class="stat"><b data-count="${s.n}">0</b><span>${esc(s.label)}</span></div>`).join('');
    $('#pitch').textContent = D.meta.pitch;
    $('#loop').innerHTML = D.loop.map((s) => `<li>${esc(s)}</li>`).join('');
    $('#pillars').innerHTML = D.pillars.map((p) => `<div class="pillar reveal"><i>${p.icon}</i><b>${esc(p.title)}</b><p>${esc(p.text)}</p></div>`).join('');
  }

  /** Section numbers in page order, and a note button on every section heading (notes on the section as a whole). */
  function sectionNotes() {
    $$('main > section.sec').forEach((sec, i) => {
      const head = $('.sec-head', sec);
      $('.num', head).textContent = String(i + 1).padStart(2, '0');
      if (sec.id === 'mynotes') return;
      head.insertAdjacentHTML('beforeend', nbtn('sec:' + sec.id, $('h2', head).textContent, 'Phần'));
    });
  }

  /** Every item that can carry notes, named up front: the "my notes" list shows its title and opens it. */
  function registerAll() {
    const reg = (id, title, kind, open) => { ITEMS[id] = { title, kind, open: open || (() => openNotes(id)) }; };
    D.systems.forEach((s) => reg('sys:' + s.id, s.name, 'Hệ thống', () => openSystem(s.id)));
    D.weapons.forEach((w) => reg('wpn:' + w.id, w.name, 'Vũ khí', () => { state.weapon = w.id; renderWeapons(); $('#weapons').scrollIntoView(); openNotes('wpn:' + w.id); }));
    D.bosses.forEach((b) => reg('boss:' + slug(b.name), b.name, 'Boss'));
    D.notes.forEach((n) => reg('note:' + slug(n.title), n.title, 'Ghi chú thiết kế'));
    D.roadmap.forEach((r) => reg('road:' + slug(r.title), r.title, 'Sắp tới · ' + LANES.find((l) => l[0] === r.lane)[1]));
    D.changelog.forEach((l) => reg('log:' + l.date + ':' + slug(l.title), l.title, 'Thay đổi ' + fmtDate(l.date)));
    $$('main > section.sec').forEach((sec) => reg('sec:' + sec.id, $('h2', sec).textContent, 'Phần'));
  }

  function countUp(el) {
    const end = +el.dataset.count, t0 = performance.now();
    const step = (t) => { const k = Math.min(1, (t - t0) / 1100); el.textContent = Math.round(end * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }

  // ================================================================ progress

  function progress() {
    const sys = D.systems;
    const avg = Math.round(sys.reduce((a, s) => a + s.progress, 0) / sys.length);
    const count2 = (st) => sys.filter((s) => s.status === st).length;
    const r = 70, c = 2 * Math.PI * r;
    $('#progressTotal').innerHTML = `
      <div class="ring">
        <svg width="170" height="170" viewBox="0 0 170 170">
          <circle cx="85" cy="85" r="${r}" fill="none" stroke="var(--bg2)" stroke-width="12"/>
          <circle id="ringArc" cx="85" cy="85" r="${r}" fill="none" stroke="var(--gold)" stroke-width="12" stroke-linecap="round"
            stroke-dasharray="${c}" stroke-dashoffset="${c}" style="transition: stroke-dashoffset 1.2s cubic-bezier(.2,.7,.2,1)"/>
        </svg>
        <b>${avg}%</b>
      </div>
      <div style="font-weight:700;margin-bottom:8px">Toàn bộ ${sys.length} hệ thống</div>
      <div class="legend"><span>${count2('done')} hoàn thành</span><span>${count2('wip')} đang làm</span><span>${count2('planned')} kế hoạch</span></div>`;
    $('#progressTotal').dataset.offset = c * (1 - avg / 100);
    $('#progressBars').innerHTML = D.categories.map((cat) => {
      const list = sys.filter((s) => s.cat === cat.id);
      if (!list.length) return '';
      const p = Math.round(list.reduce((a, s) => a + s.progress, 0) / list.length);
      return `<div class="pbar" data-cat="${cat.id}" title="Lọc hệ thống: ${esc(cat.label)}">
        <div class="name">${esc(cat.label)} <small>${list.length}</small></div>
        <div class="track"><div class="fill" data-w="${p}"></div></div><div class="pct">${p}%</div></div>`;
    }).join('');
    $$('.pbar').forEach((b) => b.addEventListener('click', () => { state.sysCat = b.dataset.cat; renderSystems(); $('#systems').scrollIntoView(); }));
  }
  function animateProgress() {
    const arc = $('#ringArc');
    if (arc) arc.style.strokeDashoffset = $('#progressTotal').dataset.offset;
    $$('#progressBars .fill').forEach((f) => { f.style.width = f.dataset.w + '%'; });
  }

  // ================================================================ systems

  function chipRow(el, key, counts, onPick) {
    el.innerHTML = [`<button class="fchip ${state[key] === 'all' ? 'on' : ''}" data-v="all">Tất cả <small>${counts.all}</small></button>`]
      .concat(D.categories.filter((c) => counts[c.id] !== undefined).map((c) =>
        `<button class="fchip ${state[key] === c.id ? 'on' : ''}" data-v="${c.id}">${esc(c.label)} <small>${counts[c.id]}</small></button>`)).join('');
    $$('.fchip', el).forEach((b) => b.addEventListener('click', () => { state[key] = b.dataset.v; onPick(); }));
  }

  function renderSystems() {
    const visible = D.systems.filter((s) => matches(s.name, s.summary, s.details, CAT[s.cat].label));
    const counts = { all: visible.length };
    visible.forEach((s) => { counts[s.cat] = (counts[s.cat] || 0) + 1; });
    if (state.sysCat !== 'all' && counts[state.sysCat] === undefined) counts[state.sysCat] = 0;
    chipRow($('#sysFilters'), 'sysCat', counts, renderSystems);
    const list = visible.filter((s) => state.sysCat === 'all' || s.cat === state.sysCat);
    $('#sysCards').innerHTML = list.map((s) => `
      <article class="card" tabindex="0" role="button" data-id="${s.id}">
        <div class="card-top"><span class="cat">${esc(CAT[s.cat].label)}</span><span class="badge ${s.status}">${STATUS[s.status]}</span></div>
        <h4>${hl(s.name)}</h4>
        <p>${hl(s.summary)}</p>
        <div class="nums">${(s.numbers || []).slice(0, 3).map(([k, v]) => `<span>${esc(k)} <b>${esc(v)}</b></span>`).join('')}</div>
        <div class="card-foot"><div class="track"><div class="fill" style="width:${s.progress}%"></div></div>${nbtn('sys:' + s.id, s.name, 'Hệ thống', () => openSystem(s.id))}</div>
      </article>`).join('');
    $('#sysEmpty').hidden = list.length > 0;
    $$('#sysCards .card').forEach((b) => {
      b.addEventListener('click', (e) => { if (!e.target.closest('[data-note]')) openSystem(b.dataset.id); });
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
      <div class="meta-row"><span class="badge ${s.status}">${STATUS[s.status]}</span>
        <div class="track"><div class="fill" style="width:${s.progress}%"></div></div><span class="mono" style="color:var(--muted)">${s.progress}%</span></div>
      ${notesBlock(noteId)}
      <h5>Chi tiết</h5>
      <ul class="det">${s.details.map((d) => `<li>${hl(d)}</li>`).join('')}</ul>
      ${s.numbers && s.numbers.length ? `<h5>Số liệu</h5><table class="table">${s.numbers.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>` : ''}
      <h5>Sắp tới · ${esc(c.label)}</h5>
      ${road.length ? road.map((r) => `<div class="ritem"><span class="tag">${esc(LANES.find((l) => l[0] === r.lane)[1])}</span><b>${esc(r.title)}</b><p>${esc(r.text)}</p></div>`).join('') : '<p class="lead">Chưa có mục nào.</p>'}
      <h5>Ghi chú thay đổi · ${esc(c.label)}</h5>
      ${logs.length ? logs.map((l) => `<div class="entry"><div class="entry-h"><span class="mono date">${fmtDate(l.date)}</span><b>${esc(l.title)}</b></div><ul>${l.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>`).join('') : '<p class="lead">Chưa có ghi chú.</p>'}`, noteId);
    history.replaceState(null, '', '#sys-' + id);
  }

  // ================================================================ weapons, world, enemies, controls

  function renderWeapons() {
    $('#wTabs').innerHTML = D.weapons.map((w) => `<button class="wtab ${w.id === state.weapon ? 'on' : ''}" role="tab" data-id="${w.id}">${esc(w.name)}${count('wpn:' + w.id) ? ` <small>✎${count('wpn:' + w.id)}</small>` : ''}</button>`).join('');
    $$('.wtab').forEach((b) => b.addEventListener('click', () => { state.weapon = b.dataset.id; renderWeapons(); }));
    const w = D.weapons.find((x) => x.id === state.weapon);
    $('#wView').innerHTML = `
      <div class="wimgs">${w.img.map((src) => `<img src="${src}" alt="${esc(w.name)}" loading="lazy" data-lightbox>`).join('')}</div>
      <div class="winfo"><div class="winfo-h"><h3>${esc(w.name)}</h3>${nbtn('wpn:' + w.id, w.name, 'Vũ khí')}</div><p>${esc(w.text)}</p><ul class="facts">${w.facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul></div>`;
    const v = $('#wView'); v.style.animation = 'none'; void v.offsetWidth; v.style.animation = '';
  }

  function staticParts() {
    $('#rooms').innerHTML = '<tr><th>Phòng</th><th>Cỡ</th><th>Ghi chú</th></tr>' +
      D.castleRooms.map(([n, s, t]) => `<tr><td>${esc(n)}</td><td>${esc(s)}</td><td>${esc(t)}</td></tr>`).join('');
    $('#bosses').innerHTML = D.bosses.map((b) => `
      <div class="boss reveal"><div class="boss-h"><b>${esc(b.name)}</b>${nbtn('boss:' + slug(b.name), b.name, 'Boss')}</div>
        <span class="where">${esc(b.where)}</span><span class="el">${esc(b.element)}</span><p>${esc(b.note)}</p></div>`).join('');
    $('#keys').innerHTML = D.controls.map(([k, v]) => `<div class="key"><kbd>${esc(k)}</kbd><span>${esc(v)}</span></div>`).join('');
    $('#notesBox').innerHTML = D.notes.map((n) => `<div class="note reveal"><div class="boss-h"><h3>${esc(n.title)}</h3>${nbtn('note:' + slug(n.title), n.title, 'Ghi chú thiết kế')}</div><ul>${n.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>`).join('');
    $('#galleryBox').innerHTML = D.gallery.map(([src, cap]) => `<figure><img src="${src}" alt="${esc(cap)}" loading="lazy" data-lightbox><figcaption>${esc(cap)}</figcaption></figure>`).join('');
    $('#techTable').innerHTML = D.tech.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('');
  }

  // ================================================================ roadmap, changelog

  function renderRoadmap() {
    $('#kanban').innerHTML = LANES.map(([lane, label]) => {
      const items = D.roadmap.filter((r) => r.lane === lane && matches(r.title, r.text, CAT[r.cat].label));
      return `<div class="lane"><div class="lane-h"><b>${label}</b><span>${items.length}</span></div>
        ${items.map((r) => `<div class="ritem"><div class="ritem-h"><span class="tag">${esc(CAT[r.cat].label)}</span>${nbtn('road:' + slug(r.title), r.title, 'Sắp tới · ' + label)}</div><b>${hl(r.title)}</b><p>${hl(r.text)}</p></div>`).join('') || '<p class="empty" style="padding:10px">—</p>'}
      </div>`;
    }).join('');
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
    $('#timeline').innerHTML = days.map((d) => `<div class="day"><div class="day-h">${fmtDate(d.date)}</div>
      ${d.items.map((l) => `<div class="entry"><div class="entry-h"><b>${hl(l.title)}</b>${l.cats.map((c) => `<span class="tag">${esc(CAT[c].label)}</span>`).join('')}${nbtn('log:' + l.date + ':' + slug(l.title), l.title, 'Thay đổi ' + fmtDate(l.date))}</div>
        <ul>${l.items.map((i) => `<li>${hl(i)}</li>`).join('')}</ul></div>`).join('')}</div>`).join('');
    $('#logEmpty').hidden = list.length > 0;
  }

  // ================================================================ "my notes" section

  function renderMyNotes() {
    const box = $('#myNotes');
    if (!box) return;
    const ids = Object.keys(notes.data).filter((id) => count(id) > 0)
      .sort((a, b) => Math.max(...live(b).map((n) => n.updated)) - Math.max(...live(a).map((n) => n.updated)));
    const total = ids.reduce((a, id) => a + count(id), 0);
    $('#myNotesCount').textContent = total ? `${total} ghi chú ở ${ids.length} mục` : 'Chưa có ghi chú nào';
    box.innerHTML = ids.length ? ids.map((id) => {
      const it = ITEMS[id] || { title: id, kind: '' };
      return `<div class="mynote"><div class="mynote-h"><span class="cat">${esc(it.kind)}</span><b>${esc(it.title)}</b><button class="link" data-open="${esc(id)}">Mở mục →</button></div>
        ${live(id).map((n) => `<div class="ntext small">${esc(n.text)}<span class="nstamp">${fmtStamp(n.updated)}</span></div>`).join('')}</div>`;
    }).join('') : '<p class="nempty">Bấm nút ✎ trên bất kỳ mục nào (hệ thống, vũ khí, boss, lộ trình, nhật ký, đầu mỗi phần) để thêm ghi chú.</p>';
    $$('[data-open]', box).forEach((b) => b.addEventListener('click', () => (ITEMS[b.dataset.open] ? ITEMS[b.dataset.open].open() : openNotes(b.dataset.open))));
  }

  function exportNotes() {
    const blob = new Blob([JSON.stringify(notes.data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `whosnext-notes-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function importNotes(file) {
    file.text().then((t) => { notes.data = merge(notes.data, JSON.parse(t)); commit(); }).catch(() => alert('File không đúng định dạng.'));
  }

  // ================================================================ lightbox

  let lbList = [], lbIndex = 0;
  function openLightbox(img) {
    lbList = $$('img[data-lightbox]').filter((i) => i.offsetParent !== null);
    lbIndex = Math.max(0, lbList.indexOf(img));
    showLb();
    $('#lightbox').hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function showLb() {
    const img = lbList[lbIndex];
    if (!img) return;
    $('#lbImg').src = img.currentSrc || img.src;
    $('#lbImg').alt = img.alt;
    $('#lbCap').textContent = img.closest('figure')?.querySelector('figcaption')?.textContent || img.alt;
  }
  function closeLb() { $('#lightbox').hidden = true; document.body.style.overflow = ''; }

  // ================================================================ wiring

  function wire() {
    document.addEventListener('click', (e) => {
      const nb = e.target.closest('[data-note]');
      if (nb) { e.stopPropagation(); const it = ITEMS[nb.dataset.note]; it && it.kind === 'Hệ thống' ? it.open() : openNotes(nb.dataset.note); return; }
      const img = e.target.closest('img[data-lightbox]');
      if (img) { openLightbox(img); return; }
      if (e.target.closest('[data-close]')) closeDrawer();
      if (e.target.closest('[data-lb-close]') || e.target.id === 'lightbox') closeLb();
      const nav = e.target.closest('[data-lb]');
      if (nav) { lbIndex = (lbIndex + +nav.dataset.lb + lbList.length) % lbList.length; showLb(); }
    });
    document.addEventListener('keydown', (e) => {
      if (!$('#lightbox').hidden) {
        if (e.key === 'Escape') closeLb();
        if (e.key === 'ArrowRight') { lbIndex = (lbIndex + 1) % lbList.length; showLb(); }
        if (e.key === 'ArrowLeft') { lbIndex = (lbIndex - 1 + lbList.length) % lbList.length; showLb(); }
        return;
      }
      if (e.key === 'Escape' && !$('#drawer').hidden) closeDrawer();
      const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
      if (e.key === '/' && !typing) { e.preventDefault(); $('#q').focus(); }
    });

    let timer;
    $('#q').addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => { state.q = $('#q').value.trim(); renderSystems(); renderRoadmap(); renderLog(); }, 120);
    });
    $('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#systems').scrollIntoView(); });
    $('#theme').addEventListener('click', () => {
      const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('whosnext.theme', next); } catch (e) {}
    });
    $('#notesExport').addEventListener('click', exportNotes);
    $('#notesImport').addEventListener('change', (e) => { if (e.target.files[0]) importNotes(e.target.files[0]); e.target.value = ''; });

    const links = $$('.nav a');
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) links.forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + en.target.id)); });
    }, { rootMargin: '-45% 0px -50% 0px' });
    $$('main > section[id]').forEach((s) => io.observe(s));

    const once = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        once.unobserve(en.target);
        if (en.target.id === 'stats') $$('[data-count]').forEach(countUp);
        else if (en.target.id === 'progress') animateProgress();
        else en.target.classList.add('in');
      });
    }, { threshold: .2 });
    once.observe($('#stats'));
    once.observe($('#progress'));
    $$('.reveal').forEach((r) => once.observe(r));

    if (location.hash.startsWith('#sys-')) openSystem(location.hash.slice(5));
  }

  notes.data = loadLocal();
  hero();
  progress();
  renderSystems();
  renderWeapons();
  staticParts();
  renderRoadmap();
  renderLog();
  sectionNotes();
  registerAll();
  renderMyNotes();
  wire();
  initNotes();
})();
