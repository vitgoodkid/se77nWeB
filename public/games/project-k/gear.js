import { copy, same, DEFENCES, pieceBaseline, optionBaseline, validatePiece, validateOption, makeExport, readImport } from './gear-model.js';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = value => String(value).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();
const SIZE = 24;
const TABS = ['Body', 'Gloves', 'Boots', 'Helmet', 'Side', 'Creator'];
const TAB_NAMES = { Body: 'Giáp thân', Gloves: 'Găng tay', Boots: 'Giày', Helmet: 'Mũ', Side: 'Side', Creator: 'Tạo nhân vật' };
const TAB_HELP = {
  Body: 'Giáp thân: thân + hông của một bộ.', Gloves: 'Tay áo giáp nối với bàn tay: tay trên + tay dưới + bàn tay, cả hai bên.',
  Boots: 'Giày: hai chân + hai bàn chân (mảnh LEG và FOT gộp lại).', Helmet: 'Phụ kiện đội đầu. Tóc ẩn hay không do cờ "che tóc".',
  Side: 'Ô thay áo choàng. Phụ kiện đi theo giáp của bộ (vai, hông → giáp thân; khuỷu → găng; đầu gối → giày; mặt nạ → mũ); ở đây còn mọi đồ đeo lưng (áo choàng, ba lô, ống tên) và món của bộ không có giáp tương ứng.', Creator: 'Các lựa chọn trong màn tạo nhân vật: mặt, tóc, râu, lông mày, mắt, tai, mũi, răng.'
};
let data, edits = {}, tab = 'Body', active, page = 0, storageKey, renderTimer, storageBlocked = false;
const items = new Map();   // id -> { item, creator }
const initial = new Map();
const get = id => edits[id] || initial.get(id);
const changed = id => !same(get(id), initial.get(id));
const message = text => { $('#message').hidden = !text; $('#message').textContent = text; };
const list = () => [...items.values()].filter(({ creator, item }) => tab === 'Creator' ? creator : !creator && item.kind === tab).map(x => x.item);
const subOf = item => tab === 'Creator' ? item.group : tab === 'Side' ? item.side : null;
const tierOf = id => get(id).tier ?? 0;
const nameOf = item => item.original.name ?? get(item.id).label ?? item.id;
const labelOf = item => items.get(item.id).creator ? `${item.group} · ${item.packName} ${String(item.set).padStart(2, '0')}` : get(item.id).name;

function save() {
  if (storageBlocked) { $('#save-status').textContent = 'Bản nháp cũ chưa đọc được. Xuất JSON để giữ thay đổi mới.'; return; }
  try { localStorage.setItem(storageKey, JSON.stringify({ source: data.source.sha256, edits })); $('#save-status').textContent = 'Đã lưu bản nháp trên trình duyệt này.'; }
  catch { $('#save-status').textContent = 'Không lưu được trên trình duyệt. Hãy xuất JSON trước khi đóng trang.'; }
}
function update(id, mutate) {
  const edit = copy(get(id));
  mutate(edit);
  if (same(edit, initial.get(id))) delete edits[id]; else edits[id] = edit;
  save(); totals();
  clearTimeout(renderTimer); renderTimer = setTimeout(renderList, 180);
  if (id === active) renderErrors();
}
function totals() {
  const all = [...items.keys()];
  const kept = all.filter(id => get(id).included).length;
  $('#totals').innerHTML = [[all.length, 'TỔNG'], [kept, 'ĐÃ CHỌN'], [all.length - kept, 'ĐÃ BỎ'], [all.filter(changed).length, 'ĐÃ SỬA']].map(([n, l]) => `<span><b>${n}</b>${l}</span>`).join('');
  $('#tabs').innerHTML = TABS.map(t => {
    const ids = [...items.values()].filter(({ creator, item }) => t === 'Creator' ? creator : !creator && item.kind === t).map(x => x.item.id);
    return `<button class="${t === tab ? 'on' : ''}" data-tab="${t}">${TAB_NAMES[t]} <small>${ids.filter(id => get(id).included).length}/${ids.length}</small></button>`;
  }).join('');
}
function fillFilters() {
  const rows = list();
  const unique = values => [...new Set(values)].sort();
  const set = (selector, values, all) => { const el = $(selector); const cur = el.value; el.innerHTML = `<option value="">${all}</option>` + values.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join(''); el.value = values.includes(cur) ? cur : ''; };
  set('#pack-filter', unique(rows.map(i => i.packName)), 'Tất cả gói');
  const sub = tab === 'Creator' ? unique(rows.map(i => i.group)) : tab === 'Side' ? unique(rows.map(i => i.side)) : DEFENCES;
  const wrap = $('#defence-wrap');
  wrap.firstChild.textContent = tab === 'Creator' ? 'Nhóm' : tab === 'Side' ? 'Loại phụ kiện' : 'Phòng thủ';
  set('#defence-filter', sub, 'Tất cả');
  $('#species-wrap').hidden = tab !== 'Creator';
  if (tab === 'Creator') set('#species-filter', unique(rows.map(i => i.speciesName)), 'Tất cả loài');
}
function filtered() {
  const search = norm($('#search').value.trim()), pack = $('#pack-filter').value, sub = $('#defence-filter').value, species = $('#species-filter').value, status = $('#status-filter').value;
  const rows = list().filter(item => {
    const e = get(item.id);
    const okSub = !sub || (tab === 'Creator' || tab === 'Side' ? subOf(item) === sub : e.defence.includes(sub));
    return (!search || norm(`${labelOf(item)} ${item.original.name ?? ''} ${item.id}`).includes(search)) && (!pack || item.packName === pack) && okSub
      && (tab !== 'Creator' || !species || item.speciesName === species)
      && (!status || ({ included: e.included, excluded: !e.included, changed: changed(item.id) })[status]);
  });
  const order = $('#sort').value;
  return rows.sort((a, b) => order === 'name' ? labelOf(a).localeCompare(labelOf(b)) : order === 'tier' ? tierOf(b.id) - tierOf(a.id) || a.id.localeCompare(b.id)
    : a.packName.localeCompare(b.packName) || a.set - b.set || a.id.localeCompare(b.id));
}
function renderList() {
  fillFiltersOnce();
  const rows = filtered(), pages = Math.max(1, Math.ceil(rows.length / SIZE));
  page = Math.min(page, pages - 1);
  $('#result-count').textContent = `${rows.length} kết quả`;
  $('#page-label').textContent = `${page + 1} / ${pages}`;
  $('#prev').disabled = page === 0; $('#next').disabled = page + 1 >= pages;
  $('#empty').hidden = rows.length > 0;
  $('#select-filtered').disabled = $('#exclude-filtered').disabled = rows.length === 0;
  $('#weapon-list').innerHTML = rows.slice(page * SIZE, (page + 1) * SIZE).map(item => {
    const e = get(item.id), creator = items.get(item.id).creator;
    const thumb = item.icon ? `<img src="${esc(item.icon)}" alt="" loading="lazy" width="180" height="145">` : `<span class="no-icon">${esc(item.group ?? '')}</span>`;
    const sub = creator ? `${esc(item.speciesName)} · ${esc(item.packName)} ${String(item.set).padStart(2, '0')}` : `${esc(item.packName)} ${String(item.set).padStart(2, '0')}${item.side ? ' · ' + esc(item.side) : ''}`;
    const bottom = creator ? `<span class="rarity Normal">${esc(item.group)}</span>` : `<span class="rarity T${e.tier}">Bậc ${e.tier}</span>`;
    return `<article class="weapon-card ${active === item.id ? 'active' : ''} ${!e.included ? 'excluded' : ''}">
      <label class="pick"><input type="checkbox" data-pick="${esc(item.id)}" ${e.included ? 'checked' : ''} aria-label="Giữ ${esc(labelOf(item))}"></label>
      <button class="weapon-open" data-open="${esc(item.id)}" aria-pressed="${active === item.id}">
        ${thumb}<strong>${esc(creator ? item.id.replace(/^SK_/, '') : e.name)}</strong><small>${sub}</small>
        <span class="card-bottom">${bottom}<span class="changed-dot">${!e.included ? 'Đã bỏ' : changed(item.id) ? 'Đã sửa' : (creator ? '' : esc(e.defence.join('/')))}</span></span>
      </button></article>`;
  }).join('');
}
let filtersFor;
function fillFiltersOnce() { if (filtersFor !== tab) { filtersFor = tab; fillFilters(); } }
function renderEditor() {
  const found = items.get(active);
  if (!found) { $('#editor').innerHTML = '<p>Chọn một món để chỉnh sửa.</p>'; return; }
  const { item, creator } = found, e = get(active);
  const thumb = item.icon ? `<img src="${esc(item.icon)}" alt="${esc(labelOf(item))}">` : '';
  if (creator) {
    $('#editor').innerHTML = `<div class="editor-portrait">${thumb}<div><span class="rarity Normal">${esc(item.group)} / ${esc(item.speciesName)}</span><h2>${esc(item.id)}</h2><span class="mono">${esc(item.packName)} bộ ${item.set}</span></div></div>
      <label class="pick"><input type="checkbox" data-field="included" ${e.included ? 'checked' : ''}>Giữ lựa chọn này trong màn tạo nhân vật</label>
      <div class="editor-fields"><label>Ghi chú cho AI<textarea data-field="notes" maxlength="8000">${esc(e.notes)}</textarea></label></div>
      <div class="editor-errors" id="editor-errors" aria-live="polite"></div><div class="editor-footer"><button class="text-button" id="reset-one" type="button">Khôi phục món này</button></div>`;
  } else {
    const defs = DEFENCES.map(d => `<label class="check"><input type="checkbox" data-defence="${d}" ${e.defence.includes(d) ? 'checked' : ''}>${d}</label>`).join('');
    $('#editor').innerHTML = `<div class="editor-portrait">${thumb}<div><span class="rarity T${e.tier}">${esc(item.kind)}${item.side ? ' · ' + esc(item.side) : ''} / bậc ${e.tier}</span><h2>${esc(e.name)}</h2><span class="mono">${esc(item.id)}</span></div></div>
      <label class="pick"><input type="checkbox" data-field="included" ${e.included ? 'checked' : ''}>Giữ trang bị trong game</label>
      <div class="editor-fields">
        <label>Tên (tiếng Anh)<input data-field="name" value="${esc(e.name)}" maxlength="120" required></label>
        <p class="field-help">Gốc: ${esc(item.original.name)} · ${esc(item.packName)} bộ ${item.set}. Mảnh: ${esc(item.original.parts.join(', '))}.</p>
        <div class="field-group"><span>Phòng thủ (chọn nhiều = lai, mỗi loại 60%)</span><div class="checks">${defs}</div></div>
        <div class="two-fields"><label>Bậc (1–4)<input type="number" data-field="tier" value="${e.tier}" min="1" max="4" step="1" required></label>
          <label class="pick inline"><input type="checkbox" data-field="special" ${e.special ? 'checked' : ''}>Đặc biệt (chế từ chiến lợi phẩm boss, không rơi)</label></div>
        ${item.kind === 'Helmet' ? `<label class="pick inline"><input type="checkbox" data-field="hidesHair" ${e.hidesHair ? 'checked' : ''}>Che tóc (tóc không hiện dưới mũ)</label>` : ''}
        <label>Yêu cầu hiệu ứng mới / ghi chú cho AI<textarea data-field="notes" maxlength="8000" placeholder="Ví dụ: bộ này +10% thể lực khi mặc đủ 3 món…">${esc(e.notes)}</textarea></label>
      </div>
      <div class="editor-errors" id="editor-errors" aria-live="polite"></div><div class="editor-footer"><button class="text-button" id="reset-one" type="button">Khôi phục món này</button></div>`;
  }
  renderErrors();
}
function renderErrors() { const found = items.get(active); if (!found) return; $('#editor-errors').textContent = (found.creator ? validateOption : validatePiece)(get(active)).join(' '); }

function download(payload, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2) + '\n'], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function bind() {
  for (const selector of ['#search', '#pack-filter', '#defence-filter', '#species-filter', '#status-filter', '#sort']) $(selector).addEventListener(selector === '#search' ? 'input' : 'change', () => { page = 0; renderList(); });
  $('#tabs').addEventListener('click', event => { const b = event.target.closest('[data-tab]'); if (!b) return; tab = b.dataset.tab; page = 0; filtersFor = null; active = null; totals(); renderList(); renderEditor(); });
  $('#prev').onclick = () => { page--; renderList(); };
  $('#next').onclick = () => { page++; renderList(); };
  $('#weapon-list').addEventListener('click', event => {
    const button = event.target.closest('[data-open]'); if (!button) return;
    active = button.dataset.open; renderList(); renderEditor(); history.replaceState(null, '', `#${active}`);
    if (innerWidth <= 720) $('#editor').scrollIntoView({ behavior: 'instant', block: 'start' });
  });
  $('#weapon-list').addEventListener('change', event => {
    if (!event.target.dataset.pick) return;
    update(event.target.dataset.pick, e => { e.included = event.target.checked; });
    if (active === event.target.dataset.pick) renderEditor();
  });
  for (const [selector, included] of [['#select-filtered', true], ['#exclude-filtered', false]]) {
    $(selector).onclick = () => {
      const rows = filtered();
      if (!confirm(`${included ? 'Chọn' : 'Bỏ'} toàn bộ ${rows.length} món khớp bộ lọc (mọi trang)?`)) return;
      rows.forEach(r => { const e = copy(get(r.id)); e.included = included; if (same(e, initial.get(r.id))) delete edits[r.id]; else edits[r.id] = e; });
      save(); totals(); renderList(); renderEditor();
    };
  }
  $('#editor').addEventListener('input', event => {
    const el = event.target, field = el.dataset.field;
    if (!field || el.tagName === 'SELECT') return;
    const value = el.type === 'checkbox' ? el.checked : el.type === 'number' ? (el.value === '' ? null : Number(el.value)) : el.value;
    update(active, e => { e[field] = value; });
    if (field === 'name') $('#editor h2').textContent = value;
  });
  $('#editor').addEventListener('change', event => {
    const el = event.target;
    if (el.dataset.defence) update(active, e => { e.defence = DEFENCES.filter(d => d === el.dataset.defence ? el.checked : e.defence.includes(d)); });
    if (el.dataset.field === 'included' || el.dataset.field === 'hidesHair' || el.dataset.field === 'special') renderList();
  });
  $('#editor').addEventListener('click', event => {
    const el = event.target.closest('button'); if (!el) return;
    if (el.id === 'reset-one' && confirm('Khôi phục món này về dữ liệu gốc?')) { delete edits[active]; save(); totals(); renderList(); renderEditor(); }
  });
  $('#reset-all').onclick = () => {
    if (!confirm('Xoá mọi chỉnh sửa trong bản nháp và chọn lại toàn bộ? Hãy xuất JSON trước nếu cần giữ bản hiện tại.')) return;
    edits = {}; storageBlocked = false; save(); totals(); renderList(); renderEditor(); message('Đã khôi phục toàn bộ.');
  };
  $('#export').onclick = () => {
    try { const out = makeExport(data, edits); download(out, `project-k-gear-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      message(`Đã xuất ${out.summary.pieces.total} trang bị (${out.summary.pieces.included} chọn, ${out.summary.pieces.excluded} bỏ) và ${out.summary.creator.total} lựa chọn tạo nhân vật (${out.summary.creator.included} chọn, ${out.summary.creator.excluded} bỏ).`); }
    catch (error) { message(`Chưa thể xuất: ${error.message}`); }
  };
  $('#import').onchange = async event => {
    const file = event.target.files[0]; if (!file) return;
    try {
      if (file.size > 8 * 1024 * 1024) throw new Error('File vượt 8 MB.');
      const imported = readImport(JSON.parse(await file.text()), data.source);
      if (!confirm(`Nhập ${Object.keys(imported).length} món đã sửa và thay thế bản nháp hiện tại?`)) return;
      edits = imported; storageBlocked = false; save(); totals(); renderList(); renderEditor(); message('Đã nhập bản thiết kế.');
    } catch (error) { message(`Không nhập: ${error.message}`); }
    finally { event.target.value = ''; }
  };
  addEventListener('storage', event => { if (event.key === storageKey) { storageBlocked = true; message('Bản nháp đã thay đổi ở tab khác. Xuất bản đang mở trước khi tải lại trang; tự lưu tạm dừng để tránh ghi đè.'); } });
}
$('#theme-toggle').onclick = () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('whosnext.theme', theme); } catch {}
};

async function start() {
  try {
    const response = await fetch('gear-data.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    data = await response.json();
    for (const p of data.pieces) { items.set(p.id, { item: p, creator: false }); initial.set(p.id, pieceBaseline(p)); }
    for (const o of data.creator) { items.set(o.id, { item: o, creator: true }); initial.set(o.id, optionBaseline(o)); }
    storageKey = `project-k.gear-review.v1.${data.source.sha256}`;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (saved) {
        if (saved.source !== data.source.sha256 || !saved.edits || Object.keys(saved.edits).some(id => !items.has(id))) throw new Error('Dữ liệu nháp không hợp lệ');
        for (const [id, edit] of Object.entries(saved.edits)) if ((items.get(id).creator ? validateOption : validatePiece)(edit).length) throw new Error('Dòng nháp không hợp lệ');
        edits = saved.edits;
      }
    } catch { storageBlocked = true; message('Không đọc được bản nháp đã lưu. Dữ liệu đó chưa bị ghi đè; có thể khôi phục tất cả để bắt đầu lại.'); }
    active = items.has(location.hash.slice(1)) ? location.hash.slice(1) : null;
    if (active) tab = items.get(active).creator ? 'Creator' : items.get(active).item.kind;
    $('#source-date').textContent = `Dữ liệu xuất ngày ${new Date(data.generatedAt).toLocaleDateString('vi-VN')}`;
    bind(); totals(); renderList(); renderEditor();
    $('#export').disabled = $('#import').disabled = $('#reset-all').disabled = false;
    $('#save-status').textContent = storageBlocked ? 'Bản nháp cũ được giữ nguyên; tự lưu tạm dừng.' : 'Bản nháp tự lưu trên trình duyệt này. Xuất JSON để chuyển máy.';
  } catch (error) { message(`Không tải được dữ liệu: ${error.message}. Thử tải lại trang.`); }
}
start();
