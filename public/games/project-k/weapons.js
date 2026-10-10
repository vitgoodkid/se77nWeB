import { baseline, copy, same, validate, makeExport, readImport, RARITIES } from './weapons-model.js';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();
const number = value => Number.isFinite(value) ? Number(value.toFixed(5)) : '';
const SIZE = 24;
let catalog, edits = {}, active, page = 0, storageKey, renderTimer;
let storageBlocked = false;
const initialById = new Map();
const get = id => edits[id] || initialById.get(id);
const changed = id => !same(get(id), initialById.get(id));
function message(text) { $('#message').hidden = !text; $('#message').textContent = text; }

function save() {
  if (storageBlocked) { $('#save-status').textContent = 'Bản nháp cũ chưa đọc được. Xuất JSON để giữ thay đổi mới.'; return; }
  try {
    localStorage.setItem(storageKey, JSON.stringify({ source: catalog.source.sha256, edits }));
    $('#save-status').textContent = 'Đã lưu bản nháp trên trình duyệt này.';
  } catch { $('#save-status').textContent = 'Không lưu được trên trình duyệt. Hãy xuất JSON trước khi đóng trang.'; }
}
function update(id, mutate) {
  const edit = copy(get(id));
  mutate(edit);
  if (same(edit, initialById.get(id))) delete edits[id]; else edits[id] = edit;
  save(); totals();
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderList, 180);
  if (id === active) renderErrors();
}
function totals() {
  const all = catalog.weapons;
  const kept = all.filter(w => get(w.id).included).length;
  $('#totals').innerHTML = [[all.length, 'TRONG CATALOG'], [kept, 'ĐÃ CHỌN'], [all.length - kept, 'ĐÃ BỎ'], [all.filter(w => changed(w.id)).length, 'ĐÃ SỬA']]
    .map(([n, label]) => `<span><b>${n}</b>${label}</span>`).join('');
}
function filtered() {
  const search = norm($('#search').value.trim()), type = $('#type-filter').value;
  const rarity = $('#rarity-filter').value, status = $('#status-filter').value;
  const rows = catalog.weapons.filter(w => {
    const e = get(w.id);
    return (!search || norm(`${e.name} ${w.original.name} ${w.id}`).includes(search)) && (!type || w.type === type)
      && (!rarity || e.rarity === rarity)
      && (!status || ({ included: e.included, excluded: !e.included, changed: changed(w.id), wieldable: w.canWield, unavailable: !w.canWield })[status]);
  });
  return rows.sort((a, b) => {
    const x = get(a.id), y = get(b.id), order = $('#sort').value;
    if (order === 'attack') return (y.attack ?? 0) - (x.attack ?? 0) || a.id.localeCompare(b.id);
    if (order === 'rarity') return RARITIES.indexOf(y.rarity) - RARITIES.indexOf(x.rarity) || x.name.localeCompare(y.name);
    if (order === 'type' && a.type !== b.type) return a.type.localeCompare(b.type);
    return x.name.localeCompare(y.name);
  });
}
function renderList() {
  const rows = filtered(), pages = Math.max(1, Math.ceil(rows.length / SIZE));
  page = Math.min(page, pages - 1);
  $('#result-count').textContent = `${rows.length} kết quả`;
  $('#page-label').textContent = `${page + 1} / ${pages}`;
  $('#prev').disabled = page === 0; $('#next').disabled = page + 1 >= pages;
  $('#empty').hidden = rows.length > 0;
  $('#select-filtered').disabled = $('#exclude-filtered').disabled = rows.length === 0;
  $('#weapon-list').innerHTML = rows.slice(page * SIZE, (page + 1) * SIZE).map(w => {
    const e = get(w.id);
    return `<article class="weapon-card ${active === w.id ? 'active' : ''} ${!e.included ? 'excluded' : ''}">
      <label class="pick"><input type="checkbox" data-pick="${esc(w.id)}" ${e.included ? 'checked' : ''} aria-label="Giữ ${esc(e.name)}"></label>
      <button class="weapon-open" data-open="${esc(w.id)}" aria-pressed="${active === w.id}">
        <img src="${esc(w.icon)}" alt="" loading="lazy" width="180" height="145">
        <strong>${esc(e.name)}</strong><small>${esc(w.type)} · ${w.canWield ? 'Cầm được' : 'Chưa có bộ đòn'}</small>
        <span class="card-bottom"><span class="rarity ${esc(e.rarity)}">${esc(e.rarity)}</span><span class="changed-dot">${!e.included ? 'Đã bỏ' : changed(w.id) ? 'Đã sửa' : `ATK ${number(e.attack)}`}</span></span>
      </button></article>`;
  }).join('');
}
const options = (values, current) => values.map(v => `<option value="${esc(v)}" ${v === current ? 'selected' : ''}>${esc(v)}</option>`).join('');
function numeric(key, label, value, min = '0', max = '1000000', scale = 1, step = 'any') {
  return `<label>${label}<input type="number" data-field="${key}" data-scale="${scale}" value="${number(value == null ? NaN : value * scale)}" min="${min}" max="${max}" step="${step}" required></label>`;
}
function renderEditor() {
  const w = catalog.weapons.find(v => v.id === active), e = get(active);
  $('#editor').innerHTML = `<div class="editor-portrait"><img src="${esc(w.icon)}" alt="${esc(w.original.name)}"><div><span class="rarity ${esc(e.rarity)}">${esc(w.type)} / ${esc(e.rarity)}</span><h2>${esc(e.name)}</h2><span class="mono">${esc(w.id)}</span></div></div>
    <label class="pick"><input type="checkbox" data-field="included" ${e.included ? 'checked' : ''}>Giữ vũ khí trong game</label>
    <div class="editor-fields">
      <label>Tên vũ khí (tiếng Anh)<input data-field="name" value="${esc(e.name)}" maxlength="120" required></label>
      <div class="two-fields"><label>Độ hiếm yêu cầu<select data-field="rarity">${options(RARITIES, e.rarity)}</select></label><label>Nguyên tố / hiệu ứng<select data-field="element">${options(catalog.elements, e.element)}</select></label></div>
      <p class="field-help">Gốc: ${esc(w.original.name)} · grade ${w.original.grade}. Loại ${esc(w.type)} ${w.canWield ? 'đã có bộ đòn' : 'chưa cầm được trong game'}.</p>
      <div class="two-fields">${numeric('attack', 'Attack cơ bản', e.attack)}${numeric('attackSpeed', 'Tốc độ đánh cộng thêm (%)', e.attackSpeed, '-99.99', '1000', 100)}</div>
      <div class="two-fields">${numeric('critChance', 'Chí mạng cộng thêm (%)', e.critChance, '0', '100', 100)}${numeric('guard', 'Guard', e.guard)}</div>
      <div class="two-fields">${numeric('weight', 'Weight (dữ liệu gốc)', e.weight)}${numeric('uniqueLevel', 'Cấp Unique', e.uniqueLevel, '1', '100', 1, '1')}</div>
    </div>
    <h3>Chỉ số Unique</h3>
    <p class="field-help" id="unique-help">${e.rarity === 'Unique' ? 'Giá trị thiết kế; game roll 80–120% khi rơi.' : 'Các dòng được giữ trong bản nháp; chỉ áp dụng khi chọn Unique.'} Phần trăm nhập như 15 = 15%.</p>
    <div id="modifier-list"></div><button class="text-button" id="add-modifier" type="button">+ Thêm chỉ số / nội tại</button>
    <div class="editor-fields" style="margin-top:18px">
      <label>Lore (tiếng Anh)<textarea data-field="lore" maxlength="8000">${esc(e.lore)}</textarea></label>
      <label>Yêu cầu hiệu ứng mới / ghi chú cho AI<textarea data-field="notes" maxlength="8000" placeholder="Ví dụ: đỡ hoàn hảo tạo một sóng băng…">${esc(e.notes)}</textarea></label>
    </div>
    <div class="editor-errors" id="editor-errors" aria-live="polite"></div>
    <div class="editor-footer"><button class="text-button" id="reset-one" type="button">Khôi phục món này</button><a class="text-button" href="#weapon-list">Về danh sách</a></div>`;
  renderModifiers(); renderErrors();
}
function renderModifiers() {
  $('#modifier-list').innerHTML = get(active).uniqueLines.map((line, index) => {
    const def = catalog.modifiers.find(d => d.id === line.id);
    return `<div class="modifier-line" data-line="${index}"><label>Chỉ số<select data-mod-id="${index}" aria-label="Chỉ số Unique ${index + 1}">${['affix', 'passive'].map(kind => `<optgroup label="${kind === 'affix' ? 'Chỉ số' : 'Nội tại'}">${catalog.modifiers.filter(d => d.kind === kind && (d.weaponCompatible || d.id === line.id)).map(d => `<option value="${esc(d.id)}" ${line.id === d.id ? 'selected' : ''}>${esc(d.name)} · ${esc(d.id)}</option>`).join('')}</optgroup>`).join('')}</select></label>
      <div class="modifier-values"><label>Giá trị ${def.percent ? '(%)' : '(số gốc)'}<input type="number" step="any" required data-mod-value="${index}" value="${number(line.value == null ? NaN : line.value * (def.percent ? 100 : 1))}"></label><button class="text-button" type="button" data-remove="${index}" aria-label="Xoá chỉ số ${index + 1}">Xoá</button></div>
      <p class="modifier-description">${esc(def.text.replaceAll('{0}', String(number(line.value == null ? NaN : line.value * (def.percent ? 100 : 1)))))}</p><span class="modifier-id">${esc(line.id)}</span>${!def.weaponCompatible ? '<p class="editor-errors">Dòng gốc ngoài nhóm vũ khí; cần AI kiểm tra tác dụng thực tế.</p>' : ''}</div>`;
  }).join('');
  $('#add-modifier').disabled = get(active).uniqueLines.length >= 32;
}
function renderErrors() { $('#editor-errors').textContent = validate(get(active), catalog).join(' '); }

function download(payload, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2) + '\n'], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function bind() {
  for (const selector of ['#search', '#type-filter', '#rarity-filter', '#status-filter', '#sort']) {
    $(selector).addEventListener(selector === '#search' ? 'input' : 'change', () => { page = 0; renderList(); });
  }
  $('#prev').onclick = () => { page--; renderList(); };
  $('#next').onclick = () => { page++; renderList(); };
  $('#weapon-list').addEventListener('click', event => {
    const button = event.target.closest('[data-open]'); if (!button) return;
    active = button.dataset.open; renderList(); renderEditor();
    history.replaceState(null, '', `#${active}`);
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
      rows.forEach(w => { const e = copy(get(w.id)); e.included = included; if (same(e, initialById.get(w.id))) delete edits[w.id]; else edits[w.id] = e; });
      save(); totals(); renderList(); renderEditor();
    };
  }
  $('#editor').addEventListener('input', event => {
    const el = event.target, field = el.dataset.field;
    if (field && el.tagName !== 'SELECT') {
      const value = el.type === 'checkbox' ? el.checked : el.type === 'number' ? (el.value === '' ? null : Number(el.value) / Number(el.dataset.scale || 1)) : el.value;
      update(active, e => { e[field] = value; });
      if (field === 'name') $('#editor h2').textContent = value;
    }
    if (el.dataset.modValue !== undefined) {
      const index = Number(el.dataset.modValue), def = catalog.modifiers.find(d => d.id === get(active).uniqueLines[index].id);
      update(active, e => { e.uniqueLines[index].value = el.value === '' ? null : Number(el.value) / (def.percent ? 100 : 1); });
      el.closest('.modifier-line').querySelector('.modifier-description').textContent = def.text.replaceAll('{0}', el.value || '…');
    }
  });
  $('#editor').addEventListener('change', event => {
    const el = event.target;
    if (el.tagName === 'SELECT' && el.dataset.field) {
      update(active, e => { e[el.dataset.field] = el.value; }); renderEditor();
    }
    if (el.dataset.modId !== undefined) {
      const def = catalog.modifiers.find(d => d.id === el.value);
      update(active, e => { e.uniqueLines[Number(el.dataset.modId)] = { id: def.id, value: def.defaultValue }; }); renderModifiers();
    }
  });
  $('#editor').addEventListener('click', event => {
    const el = event.target.closest('button'); if (!el) return;
    if (el.id === 'add-modifier') { update(active, e => { e.uniqueLines.push({ id: 'attack_pct', value: .1 }); }); renderModifiers(); }
    if (el.dataset.remove !== undefined) { update(active, e => { e.uniqueLines.splice(Number(el.dataset.remove), 1); }); renderModifiers(); }
    if (el.id === 'reset-one' && confirm('Khôi phục món này về catalog gốc?')) {
      delete edits[active]; save(); totals(); renderList(); renderEditor();
    }
  });
  $('#reset-all').onclick = () => {
    if (!confirm('Xoá mọi chỉnh sửa trong bản nháp và chọn lại toàn bộ catalog? Hãy xuất JSON trước nếu cần giữ bản hiện tại.')) return;
    edits = {}; storageBlocked = false; save(); totals(); renderList(); renderEditor(); message('Đã khôi phục toàn bộ catalog.');
  };
  $('#export').onclick = () => {
    try { const data = makeExport(catalog, edits); download(data, `project-k-weapons-${new Date().toISOString().replace(/[:.]/g, '-')}.json`); message(`Đã xuất ${data.summary.total} món: ${data.summary.included} chọn, ${data.summary.excluded} bỏ, ${data.summary.changed} thay đổi.`); }
    catch (error) { message(`Chưa thể xuất: ${error.message}`); }
  };
  $('#import').onchange = async event => {
    const file = event.target.files[0]; if (!file) return;
    try {
      if (file.size > 8 * 1024 * 1024) throw new Error('File vượt 8 MB.');
      const imported = readImport(JSON.parse(await file.text()), catalog);
      if (!confirm(`Nhập ${Object.keys(imported).length} món đã sửa và thay thế bản nháp hiện tại?`)) return;
      edits = imported; storageBlocked = false; save(); totals(); renderList(); renderEditor(); message('Đã nhập bản thiết kế.');
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
    const response = await fetch('weapons-data.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    catalog = await response.json();
    for (const w of catalog.weapons) initialById.set(w.id, baseline(w, catalog));
    storageKey = `project-k.weapon-review.v1.${catalog.source.sha256}`;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (saved) {
        if (saved.source !== catalog.source.sha256 || !saved.edits || Object.keys(saved.edits).some(id => !initialById.has(id))) throw new Error('Dữ liệu nháp không hợp lệ');
        for (const [id, edit] of Object.entries(saved.edits)) {
          if (!edit || typeof edit.name !== 'string' || !RARITIES.includes(edit.rarity) || typeof edit.included !== 'boolean' || Object.keys(initialById.get(id)).some(key => !(key in edit)) || !Array.isArray(edit.uniqueLines)
              || edit.uniqueLines.some(line => !line || !catalog.modifiers.some(d => d.id === line.id))) throw new Error('Dòng chỉ số nháp không hợp lệ');
        }
        edits = saved.edits;
      }
    } catch { storageBlocked = true; message('Không đọc được bản nháp đã lưu. Dữ liệu đó chưa bị ghi đè; có thể khôi phục tất cả để bắt đầu lại.'); }
    $('#type-filter').insertAdjacentHTML('beforeend', options(catalog.types, ''));
    $('#rarity-filter').insertAdjacentHTML('beforeend', options(RARITIES, ''));
    active = initialById.has(location.hash.slice(1)) ? location.hash.slice(1) : catalog.weapons.find(w => w.canWield)?.id || catalog.weapons[0].id;
    $('#source-date').textContent = `Catalog xuất ngày ${new Date(catalog.generatedAt).toLocaleDateString('vi-VN')}`;
    bind(); totals(); renderList(); renderEditor();
    $('#export').disabled = $('#import').disabled = $('#reset-all').disabled = false;
    $('#save-status').textContent = storageBlocked ? 'Bản nháp cũ được giữ nguyên; tự lưu tạm dừng.' : 'Bản nháp tự lưu trên trình duyệt này. Xuất JSON để chuyển máy.';
  } catch (error) { message(`Không tải được catalog: ${error.message}. Thử tải lại trang.`); }
}
start();
