(function () {
  'use strict';
  const D = window.WN;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CAT = Object.fromEntries(D.categories.map((c) => [c.id, c]));
  const STATUS = { done: 'Hoàn thành', wip: 'Đang làm', planned: 'Kế hoạch' };
  const LANES = [['now', 'Đang làm'], ['next', 'Tiếp theo'], ['later', 'Để sau'], ['idea', 'Ý tưởng']];
  const fmtDate = (d) => { const [y, m, dd] = d.split('-'); return `${dd}/${m}/${y}`; };

  const state = { q: '', sysCat: 'all', logCat: 'all', weapon: D.weapons[0].id };

  // Search: lower-case, accents removed, so "deflect", "lua" and "lửa" all find their matches.
  const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
  const matches = (...parts) => !state.q || norm(parts.flat().join(' ')).includes(norm(state.q));
  function hl(text) {
    const t = esc(text);
    if (!state.q) return t;
    const q = norm(state.q);
    const n = norm(text);
    const i = n.indexOf(q);
    if (i < 0) return t;
    // Same length after normalisation for Vietnamese letters, so the indices line up with the original.
    return esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length));
  }

  // ---------------------------------------------------------------- hero, overview

  function hero() {
    $('#heroBg').style.backgroundImage = `url(${D.meta.hero})`;
    $('#updated').textContent = fmtDate(D.updated);
    $('#updated2').textContent = fmtDate(D.updated);
    $('#tagline').textContent = D.meta.tagline;
    $('#heroChips').innerHTML = [D.meta.engine, D.meta.platform, 'Single player', 'Đang phát triển']
      .map((c) => `<span class="chip">${esc(c)}</span>`).join('');
    $('#stats').innerHTML = D.stats.map((s) => `<div class="stat"><b data-count="${s.n}">0</b><span>${esc(s.label)}</span></div>`).join('');
    $('#pitch').textContent = D.meta.pitch;
    $('#loop').innerHTML = D.loop.map((s) => `<li>${esc(s)}</li>`).join('');
    $('#pillars').innerHTML = D.pillars.map((p) => `<div class="pillar reveal"><i>${p.icon}</i><b>${esc(p.title)}</b><p>${esc(p.text)}</p></div>`).join('');
  }

  function countUp(el) {
    const end = +el.dataset.count;
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 1100);
      el.textContent = Math.round(end * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ---------------------------------------------------------------- progress

  function progress() {
    const sys = D.systems;
    const avg = Math.round(sys.reduce((a, s) => a + s.progress, 0) / sys.length);
    const count = (st) => sys.filter((s) => s.status === st).length;
    const r = 70, c = 2 * Math.PI * r;
    $('#progressTotal').innerHTML = `
      <div class="ring">
        <svg width="170" height="170" viewBox="0 0 170 170">
          <circle cx="85" cy="85" r="${r}" fill="none" stroke="var(--bg2)" stroke-width="14"/>
          <circle id="ringArc" cx="85" cy="85" r="${r}" fill="none" stroke="url(#rg)" stroke-width="14" stroke-linecap="round"
            stroke-dasharray="${c}" stroke-dashoffset="${c}" style="transition: stroke-dashoffset 1.2s cubic-bezier(.2,.7,.2,1)"/>
          <defs><linearGradient id="rg" x1="0" x2="1"><stop offset="0" stop-color="#d8463f"/><stop offset="1" stop-color="#e5b85c"/></linearGradient></defs>
        </svg>
        <b>${avg}%</b>
      </div>
      <div style="font-weight:700;margin-bottom:8px">Toàn bộ ${sys.length} hệ thống</div>
      <div class="legend">
        <span><i class="dot" style="background:var(--ok)"></i>${count('done')} hoàn thành</span>
        <span><i class="dot" style="background:var(--wip)"></i>${count('wip')} đang làm</span>
        <span><i class="dot" style="background:var(--plan)"></i>${count('planned')} kế hoạch</span>
      </div>`;
    $('#progressTotal').dataset.offset = c * (1 - avg / 100);
    $('#progressBars').innerHTML = D.categories.map((cat) => {
      const list = sys.filter((s) => s.cat === cat.id);
      if (!list.length) return '';
      const p = Math.round(list.reduce((a, s) => a + s.progress, 0) / list.length);
      return `<div class="pbar" data-cat="${cat.id}" title="Lọc hệ thống: ${esc(cat.label)}">
        <div class="name"><i class="dot" style="background:${cat.color}"></i>${esc(cat.label)} <small>${list.length}</small></div>
        <div class="track"><div class="fill" data-w="${p}" style="background:${cat.color}"></div></div>
        <div class="pct">${p}%</div></div>`;
    }).join('');
    $$('.pbar').forEach((b) => b.addEventListener('click', () => {
      state.sysCat = b.dataset.cat;
      renderSystems();
      $('#systems').scrollIntoView();
    }));
  }

  function animateProgress() {
    const arc = $('#ringArc');
    if (arc) arc.style.strokeDashoffset = $('#progressTotal').dataset.offset;
    $$('#progressBars .fill').forEach((f) => { f.style.width = f.dataset.w + '%'; });
  }

  // ---------------------------------------------------------------- systems

  function chipRow(el, key, items, onPick) {
    const counts = items;
    el.innerHTML = [`<button class="fchip ${state[key] === 'all' ? 'on' : ''}" data-v="all">Tất cả <small>${counts.all}</small></button>`]
      .concat(D.categories.filter((c) => counts[c.id]).map((c) =>
        `<button class="fchip ${state[key] === c.id ? 'on' : ''}" data-v="${c.id}"><i class="dot" style="background:${c.color}"></i>${esc(c.label)} <small>${counts[c.id]}</small></button>`))
      .join('');
    $$('.fchip', el).forEach((b) => b.addEventListener('click', () => { state[key] = b.dataset.v; onPick(); }));
  }

  function renderSystems() {
    const visible = D.systems.filter((s) => matches(s.name, s.summary, s.details, CAT[s.cat].label));
    const counts = { all: visible.length };
    visible.forEach((s) => { counts[s.cat] = (counts[s.cat] || 0) + 1; });
    if (state.sysCat !== 'all' && !counts[state.sysCat]) counts[state.sysCat] = 0;
    chipRow($('#sysFilters'), 'sysCat', counts, renderSystems);
    const list = visible.filter((s) => state.sysCat === 'all' || s.cat === state.sysCat);
    $('#sysCards').innerHTML = list.map((s) => {
      const c = CAT[s.cat];
      return `<button class="card" style="--c:${c.color}" data-id="${s.id}">
        <div class="card-top"><span class="cat">${esc(c.label)}</span><span class="badge ${s.status}">${STATUS[s.status]}</span></div>
        <h4>${hl(s.name)}</h4>
        <p>${hl(s.summary)}</p>
        <div class="nums">${(s.numbers || []).slice(0, 3).map(([k, v]) => `<span>${esc(k)} <b>${esc(v)}</b></span>`).join('')}</div>
        <div class="track"><div class="fill" style="width:${s.progress}%;background:${c.color}"></div></div>
      </button>`;
    }).join('');
    $('#sysEmpty').hidden = list.length > 0;
    $$('#sysCards .card').forEach((b) => b.addEventListener('click', () => openSystem(b.dataset.id)));
  }

  function openSystem(id) {
    const s = D.systems.find((x) => x.id === id);
    if (!s) return;
    const c = CAT[s.cat];
    const logs = D.changelog.filter((l) => l.cats.includes(s.cat));
    const road = D.roadmap.filter((r) => r.cat === s.cat);
    $('#dBody').innerHTML = `
      <span class="cat" style="--c:${c.color};color:${c.color}">${esc(c.label)}</span>
      <h2 id="dTitle">${esc(s.name)}</h2>
      <p class="lead">${esc(s.summary)}</p>
      <div class="meta-row"><span class="badge ${s.status}">${STATUS[s.status]}</span>
        <div class="track"><div class="fill" style="width:${s.progress}%;background:${c.color}"></div></div>
        <span class="mono" style="color:var(--muted)">${s.progress}%</span></div>
      <h5>Chi tiết</h5>
      <ul class="det">${s.details.map((d) => `<li>${hl(d)}</li>`).join('')}</ul>
      ${s.numbers && s.numbers.length ? `<h5>Số liệu</h5><table class="table">${s.numbers.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>` : ''}
      <h5>Sắp tới · ${esc(c.label)}</h5>
      ${road.length ? road.map((r) => `<div class="ritem" style="--c:${c.color}"><span class="tag" style="--c:${c.color}">${esc(LANES.find((l) => l[0] === r.lane)[1])}</span><b>${esc(r.title)}</b><p>${esc(r.text)}</p></div>`).join('') : '<p class="lead">Chưa có mục nào.</p>'}
      <h5>Ghi chú thay đổi · ${esc(c.label)}</h5>
      ${logs.length ? logs.map((l) => `<div class="entry"><div class="entry-h"><span class="mono" style="color:var(--gold);font-size:12px">${fmtDate(l.date)}</span><b>${esc(l.title)}</b></div><ul>${l.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>`).join('') : '<p class="lead">Chưa có ghi chú.</p>'}`;
    const d = $('#drawer');
    d.hidden = false;
    document.body.style.overflow = 'hidden';
    $('.drawer-panel', d).scrollTop = 0;
    $('.x', d).focus();
    history.replaceState(null, '', '#sys-' + id);
  }
  function closeDrawer() {
    $('#drawer').hidden = true;
    document.body.style.overflow = '';
    if (location.hash.startsWith('#sys-')) history.replaceState(null, '', '#systems');
  }

  // ---------------------------------------------------------------- weapons, world, enemies, controls

  function renderWeapons() {
    $('#wTabs').innerHTML = D.weapons.map((w) => `<button class="wtab ${w.id === state.weapon ? 'on' : ''}" role="tab" data-id="${w.id}">${esc(w.name)}</button>`).join('');
    $$('.wtab').forEach((b) => b.addEventListener('click', () => { state.weapon = b.dataset.id; renderWeapons(); }));
    const w = D.weapons.find((x) => x.id === state.weapon);
    $('#wView').innerHTML = `
      <div class="wimgs">${w.img.map((src) => `<img src="${src}" alt="${esc(w.name)}" loading="lazy" data-lightbox>`).join('')}</div>
      <div class="winfo"><h3>${esc(w.name)}</h3><p>${esc(w.text)}</p><ul class="facts">${w.facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul></div>`;
    // Re-render restarts the fade.
    const v = $('#wView'); v.style.animation = 'none'; void v.offsetWidth; v.style.animation = '';
  }

  function elementColor(e) {
    if (/Lửa \/ Băng/.test(e)) return '#c98bff';
    if (/Lửa/.test(e)) return '#ff6b3d';
    if (/Băng/.test(e)) return '#7fd3ff';
    if (/Sét/.test(e)) return '#ffd84a';
    if (/Chaos/.test(e)) return '#b06bff';
    return '#a8998a';
  }

  function staticParts() {
    $('#rooms').innerHTML = '<tr><th>Phòng</th><th>Cỡ</th><th>Ghi chú</th></tr>' +
      D.castleRooms.map(([n, s, t]) => `<tr><td>${esc(n)}</td><td>${esc(s)}</td><td>${esc(t)}</td></tr>`).join('');
    $('#bosses').innerHTML = D.bosses.map((b) => {
      const col = elementColor(b.element);
      return `<div class="boss reveal"><b>${esc(b.name)}</b><span class="where">${esc(b.where)}</span><br>
        <span class="el" style="color:${col};background:${col}22">${esc(b.element)}</span><p>${esc(b.note)}</p></div>`;
    }).join('');
    $('#keys').innerHTML = D.controls.map(([k, v]) => `<div class="key"><kbd>${esc(k)}</kbd><span>${esc(v)}</span></div>`).join('');
    $('#notesBox').innerHTML = D.notes.map((n) => `<div class="note reveal"><h3>${esc(n.title)}</h3><ul>${n.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>`).join('');
    $('#galleryBox').innerHTML = D.gallery.map(([src, cap]) => `<figure><img src="${src}" alt="${esc(cap)}" loading="lazy" data-lightbox><figcaption>${esc(cap)}</figcaption></figure>`).join('');
    $('#techTable').innerHTML = D.tech.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('');
  }

  // ---------------------------------------------------------------- roadmap, changelog

  function renderRoadmap() {
    $('#kanban').innerHTML = LANES.map(([lane, label]) => {
      const items = D.roadmap.filter((r) => r.lane === lane && matches(r.title, r.text, CAT[r.cat].label));
      return `<div class="lane"><div class="lane-h"><b>${label}</b><span>${items.length}</span></div>
        ${items.map((r) => { const c = CAT[r.cat]; return `<div class="ritem" style="--c:${c.color}"><span class="tag" style="--c:${c.color}">${esc(c.label)}</span><b>${hl(r.title)}</b><p>${hl(r.text)}</p></div>`; }).join('') || '<p class="empty" style="padding:10px">—</p>'}
      </div>`;
    }).join('');
  }

  function renderLog() {
    const visible = D.changelog.filter((l) => matches(l.title, l.items, l.cats.map((c) => CAT[c].label)));
    const counts = { all: visible.length };
    visible.forEach((l) => l.cats.forEach((c) => { counts[c] = (counts[c] || 0) + 1; }));
    if (state.logCat !== 'all' && !counts[state.logCat]) counts[state.logCat] = 0;
    chipRow($('#logFilters'), 'logCat', counts, renderLog);
    const list = visible.filter((l) => state.logCat === 'all' || l.cats.includes(state.logCat));
    const days = [];
    list.forEach((l) => { let d = days.find((x) => x.date === l.date); if (!d) days.push(d = { date: l.date, items: [] }); d.items.push(l); });
    $('#timeline').innerHTML = days.map((d) => `<div class="day"><div class="day-h">${fmtDate(d.date)}</div>
      ${d.items.map((l) => `<div class="entry"><div class="entry-h"><b>${hl(l.title)}</b>${l.cats.map((c) => `<span class="tag" style="--c:${CAT[c].color}">${esc(CAT[c].label)}</span>`).join('')}</div>
        <ul>${l.items.map((i) => `<li>${hl(i)}</li>`).join('')}</ul></div>`).join('')}</div>`).join('');
    $('#logEmpty').hidden = list.length > 0;
  }

  // ---------------------------------------------------------------- lightbox

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

  // ---------------------------------------------------------------- wiring

  function wire() {
    document.addEventListener('click', (e) => {
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
      if (e.key === '/' && document.activeElement !== $('#q')) { e.preventDefault(); $('#q').focus(); }
    });

    let timer;
    $('#q').addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        state.q = $('#q').value.trim();
        renderSystems(); renderRoadmap(); renderLog();
      }, 120);
    });
    $('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#systems').scrollIntoView(); });

    $('#theme').addEventListener('click', () => {
      const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('whosnext.theme', next); } catch (e) {}
    });

    // Nav follows the section in view; stats count up and bars fill once seen.
    const links = $$('.nav a');
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        links.forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + en.target.id));
      });
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

  hero();
  progress();
  renderSystems();
  renderWeapons();
  staticParts();
  renderRoadmap();
  renderLog();
  wire();
})();
