import { copy, same, valid, warnings, expected, makeExport, readImport } from './drops-model.js';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const round = (v, d = 4) => Number(Number(v).toFixed(d));
let data, byId, edits = {}, notes = { general: '', groups: {} }, storageKey, storageBlocked = false, sideTimer;

const get = id => (id in edits ? edits[id] : byId.get(id).value);
const changed = id => id in edits;
function message(text) { $('#message').hidden = !text; $('#message').textContent = text; }

/** How a value reads: chances as percent, ranges min–max. */
function show(entry, value) {
  if (entry.kind === 'chance') return `${round(value * 100, 3)}%`;
  if (entry.kind === 'range') return value[0] === value[1] ? `${value[0]}` : `${value[0]}–${value[1]}`;
  if (entry.kind === 'color') return value;
  return `${round(value)}`;
}
function oneIn(entry, value) { return entry.kind === 'chance' && value > 0 && value < .2 ? ` · 1/${round(1 / value, 1)}` : ''; }

function save() {
  if (storageBlocked) { $('#save-status').textContent = 'Bản nháp cũ chưa đọc được. Xuất JSON để giữ thay đổi mới.'; return; }
  try { localStorage.setItem(storageKey, JSON.stringify({ source: data.source.sha256, edits, notes })); $('#save-status').textContent = 'Đã lưu bản nháp trên trình duyệt này.'; }
  catch { $('#save-status').textContent = 'Không lưu được trên trình duyệt. Hãy xuất JSON trước khi đóng trang.'; }
}

function input(entry) {
  const v = get(entry.id), id = esc(entry.id), label = esc(`${entry.rowLabel} ${entry.col}`);
  switch (entry.kind) {
    case 'chance': return `<span class="unit"><input type="number" data-id="${id}" value="${round(v * 100, 4)}" min="0" max="100" step="any" aria-label="${label} (%)"><i>%</i></span>`;
    case 'range': return `<span class="range"><input type="number" data-id="${id}" data-part="0" value="${v[0]}" min="0" max="1000" step="1" aria-label="${label} tối thiểu"><i>–</i><input type="number" data-id="${id}" data-part="1" value="${v[1]}" min="0" max="1000" step="1" aria-label="${label} tối đa"></span>`;
    case 'color': return `<span class="colour"><input type="color" data-id="${id}" value="${esc(v)}" aria-label="${label}"><input type="text" data-id="${id}" data-hex="1" value="${esc(v)}" maxlength="7" spellcheck="false" aria-label="${label} mã màu"></span>`;
    default: return `<input type="number" data-id="${id}" value="${round(v)}" min="0" step="${entry.kind === 'int' ? 1 : 'any'}" aria-label="${label}">`;
  }
}

function cell(entry) {
  if (!entry) return '<td class="none">—</td>';
  const was = changed(entry.id) ? `<span class="was">gốc ${esc(show(entry, entry.value))}<button type="button" data-undo="${esc(entry.id)}" aria-label="Về giá trị gốc">↺</button></span>` : `<span class="was quiet">${esc(oneIn(entry, entry.value).slice(3))}</span>`;
  return `<td class="${changed(entry.id) ? 'edited' : ''}" data-cell="${esc(entry.id)}">${input(entry)}${was}</td>`;
}

function floor() {
  const kinds = data.entries.filter(e => e.group === 'colours' && e.col === 'colour');
  return `<div class="floor" role="img" aria-label="Nhãn đồ rơi và cột sáng theo số đang sửa"><div class="beams">${kinds.map(e => {
    const c = get(e.id), h = get(`colours.${e.row}.beam`);
    return `<div class="drop" style="--c:${esc(c)};--h:${Math.max(0, Math.min(12, h))}"><div class="shaft ${h > 0 ? '' : 'none'}"></div><div class="label">${esc(e.rowLabel)}</div><div class="mval">${h > 0 ? `${round(h, 2)} m` : 'không cột'}</div></div>`;
  }).join('')}</div><div class="ground"></div></div>`;
}

function renderSections() {
  $('#sections').innerHTML = data.groups.map(g => {
    const rows = [...new Set(data.entries.filter(e => e.group === g.id).map(e => e.row))];
    const at = (row, col) => data.entries.find(e => e.group === g.id && e.row === row && e.col === col);
    const head = g.columns.length > 1 || g.columns[0].label !== 'Giá trị' ? `<thead><tr><th></th>${g.columns.map(c => `<th>${esc(c.label)}</th>`).join('')}</tr></thead>` : '';
    return `<section class="drop-group" id="g-${esc(g.id)}">
      <h2>${esc(g.title)}</h2><p>${esc(g.intro)}</p>${g.notes.map(n => `<p class="field-help">${esc(n)}</p>`).join('')}
      ${g.id === 'colours' ? `<div id="floor">${floor()}</div>` : ''}
      <div class="tbl"><table>${head}<tbody>${rows.map(row => {
        const first = data.entries.find(e => e.group === g.id && e.row === row);
        return `<tr><th scope="row">${g.id === 'colours' ? `<span class="sw" style="--c:${esc(get(`colours.${row}.colour`))}"></span>` : ''}${esc(first.rowLabel)}</th>${g.columns.map(c => cell(at(row, c.id))).join('')}</tr>`;
      }).join('')}</tbody></table></div>
      <p class="code-ref">${esc(g.code)}</p>
      <label class="group-note">Ghi chú cho bảng này<textarea data-note="${esc(g.id)}" maxlength="8000" placeholder="Lý do sửa, hoặc điều muốn đổi mà bảng chưa có ô…">${esc(notes.groups[g.id] || '')}</textarea></label>
    </section>`;
  }).join('');
}

function renderSide() {
  const changedEntries = data.entries.filter(e => changed(e.id));
  $('#totals').innerHTML = [[data.entries.length, 'TỈ LỆ'], [data.groups.length, 'BẢNG'], [changedEntries.length, 'ĐÃ SỬA']]
    .map(([n, label]) => `<span><b>${n}</b>${label}</span>`).join('');
  const rows = expected(get), items = rows.filter(r => !r[2]), top = Math.max(...items.map(r => r[1]), 1e-9);
  $('#expected').innerHTML = rows.map(([name, v, gold]) => gold
    ? `<div class="row gold"><span>${esc(name)}</span><span></span><span class="v">~${round(v, 0)}</span></div>`
    : `<div class="row"><span>${esc(name)}</span><span class="track"><span class="fill" style="width:${round(v / top * 100, 2)}%"></span></span><span class="v">${round(v, v < .01 ? 4 : 3)}</span></div>`).join('');
  const warn = warnings(get);
  $('#warnings').innerHTML = warn.length ? warn.map(w => `<li>${esc(w)}</li>`).join('') : '<li class="ok">Không có. Các tỉ lệ cần cộng đủ 100% đều đúng.</li>';
  $('#changed').innerHTML = changedEntries.length ? changedEntries.map(e => {
    const g = data.groups.find(x => x.id === e.group), col = g.columns.length > 1 ? ` · ${g.columns.find(c => c.id === e.col).label}` : '';
    return `<li><a href="#g-${esc(e.group)}">${esc(g.title)}: ${esc(e.rowLabel)}${esc(col)}</a><span>${esc(show(e, e.value))} → <b>${esc(show(e, get(e.id)))}</b></span></li>`;
  }).join('') : '<li class="quiet">Chưa sửa mục nào.</li>';
}

function set(id, value) {
  const entry = byId.get(id);
  if (!valid(entry, value)) return false;
  if (same(value, entry.value)) delete edits[id]; else edits[id] = copy(value);
  save();
  const td = document.querySelector(`[data-cell="${CSS.escape(id)}"]`);
  if (td) {
    td.classList.toggle('edited', changed(id));
    td.querySelector('.was').outerHTML = changed(id) ? `<span class="was">gốc ${esc(show(entry, entry.value))}<button type="button" data-undo="${esc(id)}" aria-label="Về giá trị gốc">↺</button></span>` : `<span class="was quiet">${esc(oneIn(entry, entry.value).slice(3))}</span>`;
  }
  if (entry.group === 'colours') {
    $('#floor').innerHTML = floor();
    const sw = document.querySelector(`#g-colours tr:has([data-cell="${CSS.escape(id)}"]) .sw`);
    if (sw && entry.kind === 'color') sw.style.setProperty('--c', value);
  }
  clearTimeout(sideTimer); sideTimer = setTimeout(renderSide, 120);
  return true;
}

function read(el) {
  const entry = byId.get(el.dataset.id);
  if (entry.kind === 'chance') return el.value === '' ? NaN : Number(el.value) / 100;
  if (entry.kind === 'range') { const v = copy(get(entry.id)); v[Number(el.dataset.part)] = el.value === '' ? NaN : Number(el.value); return v; }
  if (entry.kind === 'color') return el.value.trim().toLowerCase();
  return el.value === '' ? NaN : Number(el.value);
}

function download(payload, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2) + '\n'], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function bind() {
  $('#sections').addEventListener('input', event => {
    const el = event.target;
    if (el.dataset.note) { if (el.value.trim()) notes.groups[el.dataset.note] = el.value; else delete notes.groups[el.dataset.note]; save(); renderSide(); return; }
    if (!el.dataset.id) return;
    const value = read(el), ok = set(el.dataset.id, value);
    el.classList.toggle('bad', !ok);
    if (ok && byId.get(el.dataset.id).kind === 'color') {
      const twin = el.closest('.colour').querySelector(el.dataset.hex ? 'input[type=color]' : 'input[type=text]');
      twin.value = value;
    }
  });
  $('#sections').addEventListener('click', event => {
    const undo = event.target.closest('[data-undo]'); if (!undo) return;
    const id = undo.dataset.undo, entry = byId.get(id);
    delete edits[id]; save();
    const td = undo.closest('td'); td.outerHTML = cell(entry);
    if (entry.group === 'colours') { renderSections(); }
    renderSide();
  });
  $('#general-note').addEventListener('input', event => { notes.general = event.target.value; save(); });
  $('#reset-all').onclick = () => {
    if (!confirm('Xoá mọi chỉnh sửa và ghi chú trong bản nháp? Hãy xuất JSON trước nếu cần giữ bản hiện tại.')) return;
    edits = {}; notes = { general: '', groups: {} }; storageBlocked = false; save(); $('#general-note').value = ''; renderSections(); renderSide(); message('Đã khôi phục toàn bộ về số trong code.');
  };
  $('#export').onclick = () => {
    try {
      const out = makeExport(data, edits, notes);
      download(out, `project-k-drops-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      message(`Đã xuất ${out.summary.total} tỉ lệ: ${out.summary.changed} đã sửa, ${out.summary.notes} ghi chú${out.warnings.length ? `, ${out.warnings.length} cảnh báo` : ''}.`);
    } catch (error) { message(`Chưa thể xuất: ${error.message}`); }
  };
  $('#import').onchange = async event => {
    const file = event.target.files[0]; if (!file) return;
    try {
      if (file.size > 4 * 1024 * 1024) throw new Error('File vượt 4 MB.');
      const imported = readImport(JSON.parse(await file.text()), data);
      if (!confirm(`Nhập ${Object.keys(imported.edits).length} mục đã sửa và thay thế bản nháp hiện tại?`)) return;
      edits = imported.edits; notes = imported.notes; storageBlocked = false; save();
      $('#general-note').value = notes.general; renderSections(); renderSide(); message('Đã nhập bản thiết kế.');
    } catch (error) { message(`Không nhập: ${error.message}`); }
    finally { event.target.value = ''; }
  };
  addEventListener('storage', event => {
    if (event.key === storageKey) { storageBlocked = true; message('Bản nháp đã thay đổi ở tab khác. Xuất bản đang mở trước khi tải lại trang; tự lưu tạm dừng để tránh ghi đè.'); }
  });
}

$('#theme-toggle').onclick = () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('whosnext.theme', theme); } catch {}
};

async function start() {
  try {
    const response = await fetch('drops-data.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    data = await response.json();
    byId = new Map(data.entries.map(e => [e.id, e]));
    storageKey = `project-k.drop-review.v1.${data.source.sha256}`;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (saved) {
        if (saved.source !== data.source.sha256 || !saved.edits) throw new Error('bad draft');
        for (const [id, value] of Object.entries(saved.edits)) if (!byId.has(id) || !valid(byId.get(id), value)) throw new Error('bad entry');
        edits = saved.edits;
        notes = { general: typeof saved.notes?.general === 'string' ? saved.notes.general : '', groups: saved.notes?.groups && typeof saved.notes.groups === 'object' ? saved.notes.groups : {} };
      }
    } catch { storageBlocked = true; message('Không đọc được bản nháp đã lưu. Dữ liệu đó chưa bị ghi đè; có thể khôi phục tất cả để bắt đầu lại.'); }
    $('#source-date').textContent = `Số đọc từ code ngày ${new Date(data.generatedAt).toLocaleDateString('vi-VN')}`;
    $('#general-note').value = notes.general;
    bind(); renderSections(); renderSide();
    $('#export').disabled = $('#import').disabled = $('#reset-all').disabled = false;
    $('#save-status').textContent = storageBlocked ? 'Bản nháp cũ được giữ nguyên; tự lưu tạm dừng.' : 'Bản nháp tự lưu trên trình duyệt này. Xuất JSON để chuyển máy.';
    if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
  } catch (error) { message(`Không tải được dữ liệu: ${error.message}. Thử tải lại trang.`); }
}
start();
