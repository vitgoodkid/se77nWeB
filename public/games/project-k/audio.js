import {baseline, makeExport, readImport, MAX_GAIN} from './audio-model.js';
const $ = s => document.querySelector(s);
const escape = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels = {Player:'Nhân vật', Boss:'Boss', Skills:'Kỹ năng', Loot:'Rơi đồ', World:'Thế giới', UI:'Giao diện', Effects:'Hiệu ứng / quái', Fallback:'Dự phòng'};
const states = {referenced:'Có tham chiếu', unreferenced:'Chưa thấy tham chiếu', fallback:'Âm dự phòng'};
let catalog, gains, key, page = 0, active = null, context, gainNode, request = 0;
const player = $('#player'), pageSize = 20;
const remembered = new Map();
function message(text) { $('#message').hidden = !text; $('#message').textContent = text; }
function percent(gain) { return +(gain * 100).toFixed(3); }
function db(gain) { return gain === 0 ? 'Tắt tiếng' : `${(20 * Math.log10(gain)).toFixed(1)} dB`; }
function save() {
  try { localStorage.setItem(key, JSON.stringify(makeExport(catalog, gains))); $('#save-status').textContent = 'Đã lưu bản nháp trên trình duyệt này.'; }
  catch { $('#save-status').textContent = 'Không lưu được trên trình duyệt. Hãy xuất JSON để giữ bản chỉnh sửa.'; }
  totals();
}
function totals() {
  const changed = catalog.clips.filter(c => gains[c.id] !== c.originalGain).length;
  $('#totals').innerHTML = `<span><b>${catalog.clips.length}</b>SFX</span><span><b>${changed}</b>đã chỉnh</span><span><b>${Object.values(gains).filter(g => g === 0).length}</b>tắt tiếng</span>`;
}
function filtered() {
  const query = $('#search').value.trim().toLowerCase(), category = $('#category').value, state = $('#status').value;
  return catalog.clips.filter(c => (!category || c.category === category) &&
    (!query || [c.name, c.path, ...c.usages].join(' ').toLowerCase().includes(query)) &&
    (!state || (state === 'changed' ? gains[c.id] !== c.originalGain : state === 'muted' ? gains[c.id] === 0 : c.status === state)));
}
function render() {
  const list = filtered(), pages = Math.max(1, Math.ceil(list.length / pageSize));
  page = Math.min(page, pages - 1);
  $('#result-count').textContent = `${list.length} / ${catalog.clips.length} âm thanh`;
  $('#page-label').textContent = `${page + 1} / ${pages}`;
  $('#prev').disabled = page === 0; $('#next').disabled = page === pages - 1;
  $('#audio-list').innerHTML = list.slice(page * pageSize, (page + 1) * pageSize).map(c => `
    <article class="sound-row${gains[c.id] !== c.originalGain ? ' changed' : ''}${active?.id === c.id ? ' playing' : ''}" data-id="${c.id}">
      <button class="tool sound-play" data-action="play" aria-label="Nghe ${escape(c.name)}" aria-pressed="${active?.id === c.id}">${active?.id === c.id ? '■' : '▶'}</button>
      <div><div class="sound-title">${escape(c.name)}</div><span class="sound-meta">${escape(labels[c.category] || c.category)} · ${c.duration.toFixed(2)}s · ${states[c.status]}</span>
      <details class="sound-details"><summary>Nguồn & nơi dùng</summary><p>${escape(c.path)}</p><p>${escape(c.balanceNote || 'Chưa có gain riêng trong bảng cân bằng; mặc định ×1.')}</p>${c.cues.map(cue => `<p>${escape(cue.cue)} · cue volume ${percent(cue.volume)}%</p>`).join('')}<p>${c.usages.map(escape).join('<br>') || 'File còn trong project; chưa thấy tham chiếu trong asset.'}</p></details></div>
      <div class="gain-control"><div class="gain-values"><label>Gain (%)<input class="gain-number" data-action="gain" type="number" min="0" max="${MAX_GAIN * 100}" step="any" value="${percent(gains[c.id])}" aria-label="Gain ${escape(c.name)}"></label><span class="gain-db">${db(gains[c.id])}</span></div><input data-action="slider" type="range" min="0" max="${MAX_GAIN * 100}" step="0.1" value="${percent(gains[c.id])}" aria-label="Thanh gain ${escape(c.name)}"><span class="gain-original">Gốc: ${percent(c.originalGain)}%</span></div>
      <div class="row-actions"><button class="tool" data-action="mute">${gains[c.id] === 0 ? 'Bật tiếng' : 'Tắt tiếng'}</button><button class="tool" data-action="reset">Về gốc</button></div>
    </article>`).join('') || '<p>Không có âm thanh khớp bộ lọc.</p>';
}
function syncGain() {
  if (gainNode && active) gainNode.gain.setTargetAtTime(gains[active.id] * Number($('#monitor').value) / 100, context.currentTime, .015);
}
function setGain(clip, gain) {
  // Unity keys SoundLevels by clip name, including files sharing that name.
  for (const c of catalog.clips.filter(c => c.name === clip.name)) gains[c.id] = gain;
  syncGain(); save();
  for (const row of document.querySelectorAll('.sound-row')) {
    const c = catalog.clips.find(c => c.id === row.dataset.id);
    if (c.name !== clip.name) continue;
    row.classList.toggle('changed', gain !== c.originalGain);
    for (const input of row.querySelectorAll('[data-action=gain],[data-action=slider]')) if (input !== document.activeElement) input.value = percent(gain);
    row.querySelector('.gain-db').textContent = db(gain);
    row.querySelector('[data-action=mute]').textContent = gain === 0 ? 'Bật tiếng' : 'Tắt tiếng';
  }
}
function syncPlayback() {
  for (const row of document.querySelectorAll('.sound-row')) {
    const playing = active?.id === row.dataset.id;
    row.classList.toggle('playing', playing);
    const button = row.querySelector('[data-action=play]');
    button.textContent = playing ? '■' : '▶'; button.setAttribute('aria-pressed', String(playing));
  }
}
function stop() { request++; player.pause(); player.removeAttribute('src'); player.load(); active = null; $('#now-playing').textContent = 'Chọn một SFX để nghe thử'; $('#play-time').textContent = '0:00 / 0:00'; syncPlayback(); }
async function play(clip) {
  if (active?.id === clip.id) { stop(); return; }
  const token = ++request;
  player.pause(); active = clip;
  try {
    if (!context) { context = new AudioContext(); gainNode = context.createGain(); context.createMediaElementSource(player).connect(gainNode); gainNode.connect(context.destination); }
    await context.resume();
    if (token !== request) return;
    syncGain(); player.src = clip.preview; player.loop = $('#loop').checked;
    $('#now-playing').textContent = clip.name; syncPlayback(); await player.play();
    if (token === request) message('');
  } catch (err) { if (token === request) { stop(); message(`Không phát được âm thanh: ${err.message}`); } }
}
$('#audio-list').addEventListener('click', event => {
  const button = event.target.closest('button[data-action]'); if (!button) return;
  const clip = catalog.clips.find(c => c.id === button.closest('[data-id]').dataset.id);
  if (button.dataset.action === 'play') play(clip);
  if (button.dataset.action === 'reset') { setGain(clip, clip.originalGain); render(); }
  if (button.dataset.action === 'mute') {
    const current = gains[clip.id];
    if (current > 0) remembered.set(clip.name, current);
    setGain(clip, current === 0 ? remembered.get(clip.name) ?? (clip.originalGain || 1) : 0); render();
  }
});
$('#audio-list').addEventListener('input', event => {
  const input = event.target;
  if (!['gain','slider'].includes(input.dataset.action) || input.value === '' || !input.validity.valid) return;
  setGain(catalog.clips.find(c => c.id === input.closest('[data-id]').dataset.id), Number((Number(input.value) / 100).toFixed(6)));
});
$('#audio-list').addEventListener('change', event => {
  if (!event.target.matches('input')) return;
  const clip = catalog.clips.find(c => c.id === event.target.closest('[data-id]').dataset.id);
  if (event.target.value === '' || !event.target.validity.valid) { event.target.value = percent(gains[clip.id]); message('Gain phải nằm trong khoảng 0–1600%.'); }
});
for (const selector of ['#search','#category','#status']) $(selector).addEventListener('input', () => { page = 0; if (catalog) render(); });
$('#prev').onclick = () => { page--; render(); }; $('#next').onclick = () => { page++; render(); };
$('#stop').onclick = stop;
$('#loop').onchange = () => { player.loop = $('#loop').checked; };
$('#monitor').oninput = () => { $('#monitor-value').textContent = `${$('#monitor').value}%`; syncGain(); };
player.onended = stop;
player.onerror = () => { if (active) { const name = active.name; stop(); message(`Không tải được preview: ${name}. Thử tải lại trang.`); } };
const time = n => `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}`;
player.ontimeupdate = () => { if (active) $('#play-time').textContent = `${time(player.currentTime)} / ${time(Number.isFinite(player.duration) ? player.duration : active.duration)}`; };
$('#theme-toggle').onclick = () => { const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = theme; try { localStorage.setItem('whosnext.theme', theme); } catch {} };
$('#export').onclick = () => {
  const blob = new Blob([JSON.stringify(makeExport(catalog, gains), null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = `project-k-audio-${new Date().toISOString().slice(0,10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$('#import').onchange = async event => {
  const file = event.target.files[0]; if (!file) return;
  try { if (file.size > 5e6) throw Error('File quá lớn.'); const next = readImport(catalog, JSON.parse(await file.text())); gains = next; remembered.clear(); syncGain(); save(); render(); message('Đã nhập bản chỉnh âm lượng.'); }
  catch (err) { message(`Không nhập được: ${err.message}`); } finally { event.target.value = ''; }
};
$('#reset-all').onclick = () => { if (confirm('Khôi phục gain gốc của tất cả SFX?')) { gains = baseline(catalog); remembered.clear(); syncGain(); save(); render(); } };
async function init() {
  try {
    const response = await fetch('audio-data.json'); if (!response.ok) throw Error(`HTTP ${response.status}`);
    catalog = await response.json(); gains = baseline(catalog); key = `project-k.audio.${catalog.fingerprint}`;
    try { const stored = localStorage.getItem(key); if (stored) gains = readImport(catalog, JSON.parse(stored)); } catch { message('Không đọc được bản nháp; đang hiển thị gain gốc.'); }
    $('#category').insertAdjacentHTML('beforeend', [...new Set(catalog.clips.map(c => c.category))].map(c => `<option value="${escape(c)}">${escape(labels[c] || c)}</option>`).join(''));
    $('#source-date').textContent = `Dữ liệu ${new Date(catalog.generatedAt).toLocaleDateString('vi-VN')}`;
    for (const s of ['#export','#import','#reset-all']) $(s).disabled = false;
    totals(); render();
  } catch (err) { message(`Không tải được catalog SFX: ${err.message}`); $('#totals').textContent = 'Không tải được dữ liệu'; }
}
init();
