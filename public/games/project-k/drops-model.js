export const SCHEMA = 'whosnext.drop-review';
export const VERSION = 2;
export const SOURCES = ['Normal', 'Magic', 'Elite', 'Boss'];
export const TIERS = ['Common', 'Uncommon', 'Rare', 'Precious', 'Exceptional', 'Mythic'];
export const copy = value => JSON.parse(JSON.stringify(value));
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Whether a value fits its entry's kind: chance 0..1, int and range whole numbers, number finite, color #rrggbb, choice one of its options. */
export function valid(entry, value) {
  switch (entry.kind) {
    case 'chance': return Number.isFinite(value) && value >= 0 && value <= 1;
    case 'int': return Number.isInteger(value) && value >= 0 && value <= 1000;
    case 'number': return Number.isFinite(value) && value >= 0 && value <= 1000000;
    case 'range': return Array.isArray(value) && value.length === 2 && value.every(v => Number.isInteger(v) && v >= 0 && v <= 1000) && value[0] <= value[1];
    case 'color': return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
    case 'choice': return (entry.options || []).some(o => o.value === value);
    default: return false;
  }
}

const pct = v => `${Number((v * 100).toFixed(2))}%`;
const mid = r => (r[0] + r[1]) / 2;

/** The table's items (keys) as data lists them. */
export const itemKeys = data => data.entries.filter(e => e.group === 'items' && e.col === 'tier').map(e => e.row);

/**
 * What one kill of a source leaves on average outside a Rift, no mods (the game's LootTable.Roll): rolls × the tier's chance × the
 * item's share of its tier × its average count. Returns per tier and per item, as items a kill.
 */
export function odds(data, get, source) {
  const s = SOURCES.indexOf(source);
  const rolls = get(`rolls.${source.toLowerCase()}.value`), rarity = get(`rank_rarity.${source.toLowerCase()}.value`);
  const open = itemKeys(data).map(key => ({
    key, tier: TIERS.indexOf(get(`items.${key}.tier`)) + 1, weight: get(`items.${key}.weight`),
    from: SOURCES.indexOf(get(`items.${key}.from`)), count: data.entries.some(e => e.id === `items.${key}.count`) ? mid(get(`items.${key}.count`)) : 1,
    rift: data.entries.find(e => e.id === `items.${key}.tier`).riftOnly,
  })).filter(i => i.weight > 0 && s >= i.from && !i.rift);
  const present = [...new Set(open.map(i => i.tier))];
  const tw = t => get(`tiers.t${t}.value`) * (t >= 3 ? 1 + rarity : 1);
  const total = present.reduce((sum, t) => sum + tw(t), 0);
  const tiers = Object.fromEntries(TIERS.map((_, i) => [i + 1, 0])), items = {};
  for (const t of present) {
    const pTier = total > 0 ? tw(t) / total : 0, inTier = open.filter(i => i.tier === t), w = inTier.reduce((sum, i) => sum + i.weight, 0);
    tiers[t] = rolls * pTier;
    for (const i of inTier) items[i.key] = { picks: rolls * pTier * i.weight / w, count: rolls * pTier * i.weight / w * i.count };
  }
  return { rolls, tiers, items };
}

/** Rules across entries the game relies on. */
export function warnings(data, get) {
  const out = [];
  const grades = ['rift.grade_normal.value', 'rift.grade_magic.value', 'rift.grade_rare.value'].reduce((s, id) => s + get(id), 0);
  if (Math.abs(grades - 1) > 1e-6) out.push(`Rift Stone: ba hạng đá cộng lại ${pct(grades)}, phải 100%.`);
  for (const t of [1, 2, 3, 4, 5, 6]) {
    const any = itemKeys(data).some(k => TIERS.indexOf(get(`items.${k}.tier`)) + 1 === t && get(`items.${k}.weight`) > 0);
    if (get(`tiers.t${t}.value`) > 0 && !any) out.push(`Bậc ${TIERS[t - 1]} có trọng số nhưng không còn món nào: lượt rơi sẽ rơi vào bậc khác.`);
  }
  if (SOURCES.every(s => get(`rolls.${s.toLowerCase()}.value`) === 0)) out.push('Mọi loại quái đều 0 lượt rơi: chỉ còn vàng.');
  return out;
}

export function makeExport(data, edits, notes) {
  const entries = data.entries.map(entry => {
    const requested = entry.id in edits ? copy(edits[entry.id]) : copy(entry.value);
    if (!valid(entry, requested)) throw new Error(`${entry.id}: giá trị không hợp lệ.`);
    const group = data.groups.find(g => g.id === entry.group);
    const column = group.columns.find(c => c.id === entry.col);
    return { id: entry.id, group: entry.group, label: `${group.title} / ${entry.rowLabel}${group.columns.length > 1 ? ` / ${column.label}` : ''}`,
      kind: entry.kind, code: entry.code, baseline: copy(entry.value), requested, changed: !same(entry.value, requested) };
  });
  const get = id => entries.find(e => e.id === id).requested;
  const groupNotes = Object.fromEntries(Object.entries(notes.groups || {}).filter(([, text]) => text && text.trim()));
  return { schema: SCHEMA, schemaVersion: VERSION, exportedAt: new Date().toISOString(), source: copy(data.source),
    instructions: [
      'This is a design review of Whosnext drop rates, not a game patch already applied. Match entries by id; label is for reading only.',
      'Check source.sha256 against drops-data.json; if the game code changed since, compare each changed entry with the code before applying.',
      'Apply only entries with changed=true (and the notes). Every other value stays as it is in code.',
      'kind chance is a fraction (0.04 = 4%). range is inclusive [min, max] of whole numbers: C# rng.Next(min, max + 1). number is a plain factor or weight. choice is an enum name (LootTier, LootTable.Source). color is #rrggbb.',
      'The loot table (rolls, rank rarity, tier weights, every item: tier, weight, minSource, countMin/countMax) lives in Assets/_Game/Scripts/Runtime/Items/LootTable.cs; code names the field of each value.',
      'An item\'s tier sets both how rarely it drops and its floor look (LootFx.KindOf(LootTier)); LootTable.TierOf maps item ids to tiers - keep it in step with the entry\'s tier.',
      'Quest drops live in Assets/_Game/Resources/Story/*.txt (drop N = percent). Gold, Rift Stones and flasks are in the files named by code.',
      'Where a review asks for something the code cannot do yet (a new item, a new rule), implement it and say so; do not silently drop it.',
      'Afterwards run Whosnext.EditorTools.DropsDataExport.Run (it rewrites drops-data.json in se77nWeB from the code), Whosnext.EditorTools.LootSimProbe.Run (20,000 kills a source), update Documentation/GDD/DoRoi.md and AGENTS.md, compile, check one kill in Play, and push se77nWeB.'
    ],
    summary: { total: entries.length, changed: entries.filter(e => e.changed).length, notes: Object.keys(groupNotes).length + (notes.general?.trim() ? 1 : 0) },
    warnings: warnings(data, get),
    notes: { general: notes.general || '', groups: groupNotes },
    groups: data.groups.map(g => ({ id: g.id, title: g.title, code: g.code })),
    entries };
}

export function readImport(json, data) {
  if (!json || json.schema !== SCHEMA || json.schemaVersion !== VERSION) throw new Error('Không đúng định dạng Drop Review v2.');
  if (json.source?.sha256 !== data.source.sha256) throw new Error('File dùng bản dữ liệu khác (game đã đổi tỉ lệ từ lúc xuất). Cần đối chiếu trước khi nhập.');
  if (!Array.isArray(json.entries)) throw new Error('File thiếu danh sách mục.');
  const known = new Map(data.entries.map(e => [e.id, e])), edits = {};
  for (const row of json.entries) {
    const entry = known.get(row?.id);
    if (!entry) throw new Error(`Mục lạ: ${row?.id}`);
    if (!valid(entry, row.requested)) throw new Error(`${row.id}: giá trị không hợp lệ.`);
    if (!same(entry.value, row.requested)) edits[row.id] = copy(row.requested);
  }
  const notes = { general: typeof json.notes?.general === 'string' ? json.notes.general.slice(0, 8000) : '', groups: {} };
  for (const [id, text] of Object.entries(json.notes?.groups || {}))
    if (data.groups.some(g => g.id === id) && typeof text === 'string') notes.groups[id] = text.slice(0, 8000);
  return { edits, notes };
}
