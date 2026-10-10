import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { baseline, makeExport, readImport, validate } from '../public/games/project-k/weapons-model.js';

const data = JSON.parse(fs.readFileSync(new URL('../public/games/project-k/weapons-data.json', import.meta.url)));
const first = data.weapons[0];

test('all source weapons, modifiers and icons are present', () => {
  assert.equal(data.weapons.length, 347);
  assert.equal(new Set(data.weapons.map(w => w.id)).size, data.source.count);
  for (const w of data.weapons) {
    assert.ok(fs.existsSync(new URL(`../public/games/project-k/${w.icon}`, import.meta.url)));
    assert.deepEqual(validate(baseline(w, data), data), [], w.id);
  }
});
test('untouched export preserves active and retired selections and serialized originals', () => {
  const out = makeExport(data, {});
  assert.equal(out.summary.changed, 0);
  assert.equal(out.summary.included, 73);
  assert.equal(out.summary.excluded, 274);
  assert.ok(out.weapons.every(w => w.action === (w.originalCatalog.retired ? 'exclude' : 'keep') && w.changedFields.length === 0));
  assert.deepEqual(out.weapons[0].originalCatalog, first.original);
  assert.deepEqual(readImport(out, data), {});
});
test('rename, exclusion, rarity and unique values survive JSON round trip', () => {
  const active = data.weapons.find(w => !w.original.retired);
  const edit = baseline(active, data);
  Object.assign(edit, { name: 'Test Blade', included: false, rarity: 'Unique', notes: 'Add a frost wave.' });
  edit.uniqueLines = [{ id: 'attack_pct', value: .15 }, { id: 'echo', value: .25 }];
  const edits = { [active.id]: edit };
  const out = makeExport(data, edits);
  assert.equal(out.summary.excluded, 275);
  assert.equal(out.summary.changed, 1);
  const changed = out.weapons.find(w => w.id === active.id);
  assert.equal(changed.action, 'exclude');
  assert.deepEqual(changed.requested.uniqueLines, edit.uniqueLines);
  assert.deepEqual(readImport(JSON.parse(JSON.stringify(out)), data), edits);
});
test('legacy elemental values are normalized once; originals and unchanged diff survive', () => {
  const w = data.weapons.find(w => w.original.uniqueLines.some(l => l.id === 'holy_add'));
  assert.ok(w);
  const line = w.original.uniqueLines.find(l => l.id === 'holy_add');
  const normalized = baseline(w, data).uniqueLines.find(l => l.id === 'shadow_add');
  assert.equal(normalized.value, line.value * w.original.attack * (1 + .035 * (w.original.uniqueLevel - 1)));
  const out = makeExport(data, {});
  assert.deepEqual(readImport(out, data), {});
  assert.ok(w.original.uniqueLines.some(l => l.id === 'holy_add'));
});
test('invalid edits never export or import', () => {
  for (const invalid of [{ name: ' ' }, { attack: null }, { critChance: 1.1 }, { attackSpeed: -1 },
    { uniqueLevel: 1.5 }, { uniqueLines: [{ id: 'missing', value: 1 }] }, { uniqueLines: [{ id: 'echo', value: Infinity }] }]) {
    const edit = { ...baseline(first, data), ...invalid };
    assert.throws(() => makeExport(data, { [first.id]: edit }));
    const file = makeExport(data, {}); file.weapons[0].requested = edit;
    assert.throws(() => readImport(file, data));
  }
});
test('import rejects stale catalogs, unknown IDs, duplicate IDs and partial files atomically', () => {
  for (const mutate of [o => { o.source.sha256 = 'stale'; }, o => { o.weapons[0].id = 'unknown'; },
    o => { o.weapons[0].id = o.weapons[1].id; }, o => { o.weapons.pop(); }, o => { o.schemaVersion = 2; }]) {
    const out = makeExport(data, {}); mutate(out);
    assert.throws(() => readImport(out, data));
  }
});
