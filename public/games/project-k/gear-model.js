export const SCHEMA = 'whosnext.gear-review';
export const VERSION = 1;
export const DEFENCES = ['Armour', 'Agility', 'Spellguard'];
export const copy = value => JSON.parse(JSON.stringify(value));
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** The first state of a gear piece: what the game's builder made. */
export const pieceBaseline = piece => ({
  included: true, name: piece.original.name, defence: [...piece.original.defence], tier: piece.original.tier,
  hidesHair: piece.original.hidesHair, special: piece.original.special, notes: ''
});
/** The first state of a creator option (a face, hair, beard, brows, eyes, ears, nose or teeth). */
export const optionBaseline = () => ({ included: true, notes: '' });

export function validatePiece(edit) {
  const errors = [];
  if (!edit || typeof edit !== 'object') return ['Thiếu dữ liệu trang bị.'];
  if (typeof edit.included !== 'boolean') errors.push('Trạng thái chọn/bỏ không hợp lệ.');
  if (typeof edit.name !== 'string' || !edit.name.trim() || edit.name.length > 120) errors.push('Tên cần 1–120 ký tự.');
  if (!Array.isArray(edit.defence) || !edit.defence.length || edit.defence.some(d => !DEFENCES.includes(d))) errors.push('Cần ít nhất một loại phòng thủ.');
  if (!Number.isInteger(edit.tier) || edit.tier < 1 || edit.tier > 4) errors.push('Bậc cần số nguyên 1–4.');
  if (typeof edit.hidesHair !== 'boolean' || typeof edit.special !== 'boolean') errors.push('Cờ che tóc / đặc biệt không hợp lệ.');
  if (typeof edit.notes !== 'string' || edit.notes.length > 8000) errors.push('Ghi chú tối đa 8.000 ký tự.');
  return errors;
}

export function validateOption(edit) {
  if (!edit || typeof edit.included !== 'boolean') return ['Trạng thái chọn/bỏ không hợp lệ.'];
  if (typeof edit.notes !== 'string' || edit.notes.length > 8000) return ['Ghi chú tối đa 8.000 ký tự.'];
  return [];
}

function rows(items, baseline, validate, edits, extra) {
  return items.map(item => {
    const initial = baseline(item);
    const after = copy(edits[item.id] || initial);
    const errors = validate(after);
    if (errors.length) throw new Error(`${item.id}: ${errors.join(' ')}`);
    const changedFields = Object.keys(initial).filter(key => !same(initial[key], after[key]));
    return { id: item.id, ...extra(item), original: copy(item.original), baseline: initial, requested: after, changedFields,
      action: !after.included ? 'exclude' : changedFields.length ? 'update' : 'keep' };
  });
}

export function makeExport(data, edits) {
  const pieces = rows(data.pieces, pieceBaseline, validatePiece, edits, p => ({ kind: p.kind, side: p.side, pack: p.pack, set: p.set }));
  const creator = rows(data.creator, optionBaseline, validateOption, edits, o => ({ group: o.group, species: o.species, pack: o.pack, set: o.set }));
  const count = list => ({ total: list.length, included: list.filter(r => r.requested.included).length, excluded: list.filter(r => !r.requested.included).length,
    changed: list.filter(r => r.changedFields.length).length });
  return { schema: SCHEMA, schemaVersion: VERSION, exportedAt: new Date().toISOString(), source: copy(data.source),
    instructions: [
      'This is a design review, not an executed game patch. Match rows by stable id, never by display name.',
      'Check source.sha256 against the current Resources/ModularGear.asset; report conflicts against each row.original before applying.',
      'Apply only changedFields. included=false removes a piece from drops, shops and the stash; keep its part meshes and the item ids so old saves load (migrate via SaveFix).',
      'Persist edits in builder-owned data: copy requested into Assets/_Game/Data/Sidekick/gear_review.json for SidekickGearBuilder to read. Never hand-edit the generated asset.',
      'pieces: a Body piece is torso + hips of one pack set, Gloves = both upper arms, lower arms and hands, Boots = both legs + both feet, Helmet = the head attachment, Side = one other attachment (side names which).',
      'defence is any of Armour, Agility, Spellguard; two or three means a hybrid piece (60% of each value). tier 1-4 sets the item level it first drops at and its numbers.',
      'hidesHair (helmets): the hair part is not worn under it. special: a boss-trophy base that never drops.',
      'creator rows are the character creator options (faces, hair, beards, eyebrows, eyes, ears, noses, teeth); included=false hides an option in the creator but keeps the part.',
      'notes describe requested behavior for an AI to implement; they are not existing executable data.',
      'Keep English proper names, add localization for new UI, and run the relevant Unity checks.'
    ],
    summary: { pieces: count(pieces), creator: count(creator) }, pieces, creator };
}

export function readImport(data, source) {
  if (!data || data.schema !== SCHEMA || data.schemaVersion !== VERSION) throw new Error('Không đúng định dạng Gear Review v1.');
  if (data.source?.sha256 !== source.sha256) throw new Error('File dùng bản dữ liệu khác. Cần đối chiếu trước khi nhập để tránh mất thay đổi.');
  const edits = {};
  const known = new Map([...data.pieces, ...data.creator].map(r => [r.id, r]));
  for (const row of known.values()) {
    const errors = row.baseline && 'tier' in row.baseline ? validatePiece(row.requested) : validateOption(row.requested);
    if (errors.length) throw new Error(`${row.id}: ${errors.join(' ')}`);
    if (!same(row.baseline, row.requested)) edits[row.id] = copy(row.requested);
  }
  return edits;
}
