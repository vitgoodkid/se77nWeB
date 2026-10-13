export const SCHEMA = 'whosnext.drop-review';
export const VERSION = 1;
export const copy = value => JSON.parse(JSON.stringify(value));
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Whether a value fits its entry's kind: chance 0..1, int and range whole numbers, number finite, color #rrggbb. */
export function valid(entry, value) {
  switch (entry.kind) {
    case 'chance': return Number.isFinite(value) && value >= 0 && value <= 1;
    case 'int': return Number.isInteger(value) && value >= 0 && value <= 1000;
    case 'number': return Number.isFinite(value) && value >= 0 && value <= 1000000;
    case 'range': return Array.isArray(value) && value.length === 2 && value.every(v => Number.isInteger(v) && v >= 0 && v <= 1000) && value[0] <= value[1];
    case 'color': return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
    default: return false;
  }
}

/** Rules across entries that the game relies on: shares that must add up. */
export function warnings(get) {
  const out = [];
  const sum = ids => ids.reduce((s, id) => s + get(id), 0);
  const split = sum(['stones_split.g1.value', 'stones_split.g2.value', 'stones_split.g3.value']);
  if (Math.abs(split - 1) > 1e-6) out.push(`Đá rèn: ba bậc đá thấp cộng lại ${pct(split)}, phải 100%.`);
  const grades = sum(['rift.grade_normal.value', 'rift.grade_magic.value', 'rift.grade_rare.value']);
  if (Math.abs(grades - 1) > 1e-6) out.push(`Rift Stone: ba hạng đá cộng lại ${pct(grades)}, phải 100%.`);
  const rune = sum(['runes_rarity.rare.value', 'runes_rarity.magic.value']);
  if (rune > 1 + 1e-6) out.push(`Rune: Rare + Magic gốc ${pct(rune)}, vượt 100%.`);
  for (const [rank, label] of [['boss', 'Boss'], ['elite', 'Elite']]) {
    const luck = get(`runes.${rank}.luck`);
    if (rune * luck > 1 + 1e-6) out.push(`Rune ${label}: may mắn ×${luck} đẩy Rare + Magic quá 100%; phần Normal sẽ về 0.`);
  }
  return out;
}

const pct = v => `${Number((v * 100).toFixed(2))}%`;
const mid = r => (r[0] + r[1]) / 2;

/** What one common monster (level 10, no mods, outside a Rift) leaves on average, from the values in hand. */
export function expected(get) {
  const gear = ['normal', 'magic', 'rare', 'unique'].reduce((s, g) => s + get(`gear.normal.${g}`), 0)
    + ['normal', 'magic', 'rare'].reduce((s, g) => s + Math.max(0, get(`gear.normal.${g}`) - get('gear_extra.jewellery_less.value')), 0);
  const luck = get('gems_luck.normal.value');
  const crafting = ['gem_transmute', 'gem_prism', 'gem_regal', 'gem_exalt', 'gem_chaos', 'gem_voidpearl', 'gem_starforge', 'gem_suntear']
    .reduce((s, id) => s + Math.min(1, get(`gems.${id}.value`) * luck), 0);
  return [
    ['Vàng', mid(get('gold.base.value')) * (1 + 10 * get('gold.per_level.value')) * get('gold.normal.value'), true],
    ['Đá rèn', get('stones.normal_low.chance') * mid(get('stones.normal_low.stacks')) * mid(get('stones.normal_low.count'))],
    ['Gem chế tạo', crafting],
    ['Trang bị', gear],
    ['Flux', get('flux.normal.chance') * mid(get('flux.normal.count'))],
    ['Bình', get('flasks.normal.value')],
    ['Lustre', Math.min(1, get('gems.gem_polish.value') * luck)],
    ['Chisel', Math.min(1, get('gems.gem_chisel.value') * luck)],
    ['Skill Forge', get('uncut.normal.forge')],
    ['Rune', get('runes.normal.chance')],
    ['Support Seed', get('uncut.normal.seed')],
  ];
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
      'kind chance is a fraction (0.04 = 4%). range is inclusive [min, max] of whole numbers: C# rng.Next(min, max + 1). number is a plain factor. color is #rrggbb (Unity Color 0..1 per channel).',
      'code names the file and symbol that holds each value. Change the constant there; where the code has no constant for a value (an inline literal), name one.',
      'Drop rates live in code (LootDrops, SkillLoot, GearRunes, Flasks, RiftStones, MonsterMods, LootFx); quest drops live in Assets/_Game/Resources/Story/*.txt (drop N = percent).',
      'Where a review asks for something the code cannot do yet (a chance on a roll that is certain today, a new item), implement it and say so; do not silently drop it.',
      'Keep shares that must add up consistent: the low forge-stone tiers and the Rift Stone grades sum to 100% (warnings lists any that do not).',
      'Afterwards update Documentation/GDD/DoRoi.md and AGENTS.md, regenerate public/games/project-k/drops-data.json in se77nWeB from the new code values, compile, and check one drop path in Play.'
    ],
    summary: { total: entries.length, changed: entries.filter(e => e.changed).length, notes: Object.keys(groupNotes).length + (notes.general?.trim() ? 1 : 0) },
    warnings: warnings(get),
    notes: { general: notes.general || '', groups: groupNotes },
    groups: data.groups.map(g => ({ id: g.id, title: g.title, code: g.code })),
    entries };
}

export function readImport(json, data) {
  if (!json || json.schema !== SCHEMA || json.schemaVersion !== VERSION) throw new Error('Không đúng định dạng Drop Review v1.');
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
