export const SCHEMA = 'whosnext.weapon-review';
export const VERSION = 1;
export const RARITIES = ['Normal', 'Magic', 'Rare', 'Unique'];
export const rarityOf = grade => grade >= 4 ? 'Unique' : grade >= 2 ? 'Rare' : grade === 1 ? 'Magic' : 'Normal';
export const copy = value => JSON.parse(JSON.stringify(value));
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function baseline(weapon, catalog) {
  const original = weapon.original;
  const lines = copy(original.uniqueLines);
  // Old authored elemental lines are converted by WeaponCrafting.UniqueRoll at spawn time.
  for (const line of lines) {
    if (line.id === 'holy_add') line.id = 'shadow_add';
    if (['fire_add', 'frost_add', 'lightning_add', 'poison_add', 'shadow_add'].includes(line.id) && line.value < 1) {
      line.value *= original.attack * (1 + .035 * (Math.max(1, original.uniqueLevel) - 1));
    }
  }
  return { included: true, name: original.name, rarity: rarityOf(original.grade),
    attack: original.attack, attackSpeed: original.attackSpeed, critChance: original.critChance,
    guard: original.guard, weight: original.weight, element: catalog.elements[original.element],
    uniqueLevel: original.uniqueLevel, uniqueLines: lines, lore: original.lore, notes: '' };
}

export function validate(edit, catalog) {
  const errors = [];
  if (!edit || typeof edit !== 'object') return ['Thiếu dữ liệu vũ khí.'];
  if (typeof edit.included !== 'boolean') errors.push('Trạng thái chọn/bỏ không hợp lệ.');
  if (typeof edit.name !== 'string' || !edit.name.trim() || edit.name.length > 120) errors.push('Tên cần 1–120 ký tự.');
  if (!RARITIES.includes(edit.rarity)) errors.push('Độ hiếm không hợp lệ.');
  for (const key of ['attack', 'guard', 'weight']) {
    if (!Number.isFinite(edit[key]) || edit[key] < 0 || edit[key] > 1000000) errors.push(`${key}: cần số từ 0 đến 1.000.000.`);
  }
  if (!Number.isFinite(edit.attackSpeed) || edit.attackSpeed <= -1 || edit.attackSpeed > 10) errors.push('Tốc độ đánh cần lớn hơn −100% và không quá +1.000%.');
  if (!Number.isFinite(edit.critChance) || edit.critChance < 0 || edit.critChance > 1) errors.push('Chí mạng cần từ 0% đến 100%.');
  if (!catalog.elements.includes(edit.element)) errors.push('Nguyên tố không hợp lệ.');
  if (!Number.isInteger(edit.uniqueLevel) || edit.uniqueLevel < 1 || edit.uniqueLevel > 100) errors.push('Cấp Unique cần số nguyên 1–100.');
  for (const key of ['lore', 'notes']) {
    if (typeof edit[key] !== 'string' || edit[key].length > 8000) errors.push(`${key}: tối đa 8.000 ký tự.`);
  }
  if (!Array.isArray(edit.uniqueLines) || edit.uniqueLines.length > 32) errors.push('Tối đa 32 dòng Unique.');
  else for (const line of edit.uniqueLines) {
    if (!line || !catalog.modifiers.some(d => d.id === line.id)) errors.push('ID chỉ số Unique không có trong catalog.');
    if (!line || !Number.isFinite(line.value) || Math.abs(line.value) > 1000000) errors.push('Giá trị chỉ số Unique không hợp lệ.');
  }
  return errors;
}

export function makeExport(catalog, edits) {
  const weapons = catalog.weapons.map(weapon => {
    const initial = baseline(weapon, catalog);
    const after = copy(edits[weapon.id] || initial);
    const errors = validate(after, catalog);
    if (errors.length) throw new Error(`${weapon.id}: ${errors.join(' ')}`);
    const changedFields = Object.keys(initial).filter(key => !same(initial[key], after[key]));
    return { id: weapon.id, type: weapon.type, canWield: weapon.canWield,
      originalCatalog: copy(weapon.original), baseline: initial, requested: after,
      changedFields, action: !after.included ? 'exclude' : changedFields.length ? 'update' : 'keep' };
  });
  return { schema: SCHEMA, schemaVersion: VERSION, exportedAt: new Date().toISOString(),
    source: copy(catalog.source),
    instructions: [
      'This is a design review, not an executed game patch. Match weapons by stable id, never by display name.',
      'Check source.sha256 against the current catalog; report conflicts against originalCatalog before applying changes.',
      'Apply only changedFields. Unchanged rows and unsupported weapon types must not be removed implicitly.',
      'included=false means exclude from available/drop catalogs; preserve assets, IDs and old-save compatibility. Do not delete models.',
      'Persist edits in builder-owned data or overrides read by WeaponCatalogBuilder. Never hand-edit the generated catalog asset.',
      'rarity is the requested gameplay rarity. Existing grade 0/1/2/3/4/5 maps to Normal/Magic/Rare/Rare/Unique/Unique.',
      'Non-unique catalog grade currently describes base quality; WeaponCrafting spawns these as Normal. A rarity change must consider crafting/drop code, not only grade.',
      'attackSpeed, critChance and percent modifier values use fractions: 0.15 means 15%. Other modifiers use raw values.',
      'baseline normalizes legacy elemental flat lines exactly as UniqueRoll does. originalCatalog retains serialized values. Do not convert twice.',
      'uniqueLines are authored central values, before the existing 80-120% Unique drop roll. Preserve line metadata.',
      'For a non-Unique weapon, uniqueLines remain draft-only and must not become fixed affixes on normal loot.',
      'notes describe requested behavior for an AI to implement; they are not existing executable modifiers.',
      'Keep English proper names, add localization for new UI, migrate changed saves via SaveFix, and run relevant Unity checks.'
    ],
    summary: { total: weapons.length, included: weapons.filter(w => w.requested.included).length,
      excluded: weapons.filter(w => !w.requested.included).length,
      changed: weapons.filter(w => w.changedFields.length).length },
    modifierDefinitions: copy(catalog.modifiers), weapons };
}

export function readImport(data, catalog) {
  if (!data || data.schema !== SCHEMA || data.schemaVersion !== VERSION) throw new Error('Không đúng định dạng Weapon Review v1.');
  if (data.source?.sha256 !== catalog.source.sha256) throw new Error('File dùng bản catalog khác. Cần đối chiếu bản gốc trước khi nhập để tránh mất thay đổi.');
  if (!Array.isArray(data.weapons) || data.weapons.length !== catalog.weapons.length) throw new Error('File phải chứa toàn bộ catalog, kể cả món đã bỏ.');
  const known = new Map(catalog.weapons.map(w => [w.id, w]));
  const seen = new Set(), edits = {};
  for (const row of data.weapons) {
    const weapon = known.get(row?.id);
    if (!weapon || seen.has(row.id)) throw new Error('File chứa ID lạ hoặc trùng.');
    seen.add(row.id);
    const errors = validate(row.requested, catalog);
    if (errors.length) throw new Error(`${row.id}: ${errors.join(' ')}`);
    const initial = baseline(weapon, catalog);
    const edit = Object.fromEntries(Object.keys(initial).map(key => [key, copy(row.requested[key])]));
    if (!same(initial, edit)) edits[row.id] = edit;
  }
  return edits;
}
