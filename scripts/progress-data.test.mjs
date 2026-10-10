import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../public/games/project-k/', import.meta.url);
const read = file => fs.readFileSync(new URL(file, root), 'utf8');
const context = { window: {} };
vm.runInNewContext(read('data.js'), context);
const data = context.window.WN;
const snapshot = JSON.parse(read('status-data.json'));
const skills = JSON.parse(read('skills.html').match(/const DATA = (.*);\r?\nconst FORM/)[1]);
const weapons = JSON.parse(read('weapons-data.json'));

test('public counters agree with the exported source snapshots', () => {
  const c = snapshot.counts;
  assert.equal(weapons.weapons.length, c.weapons);
  assert.equal(weapons.weapons.filter(w => !w.original.retired).length, c.activeWeapons);
  assert.equal(skills.skills.length, c.skills);
  assert.equal(skills.supports.length, c.supports);
  assert.deepEqual(Array.from(data.stats, s => s.n),
    [c.activeWeapons, c.gear, c.skills, c.supports, c.monsterPrefabs, c.quests, c.riftWorlds, snapshot.scenes.length]);
});

test('every public status is explicit and implemented systems cite relative sources', () => {
  assert.equal(new Set(data.systems.map(s => s.id)).size, data.systems.length);
  for (const item of [...data.systems, ...data.roadmap]) {
    assert.ok(['implemented', 'partial', 'planned'].includes(item.implementation));
    assert.ok(data.categories.some(c => c.id === item.cat));
  }
  for (const s of data.systems) {
    assert.ok(s.evidence.length > 0, s.id);
    for (const source of s.evidence) assert.match(source, /^(Assets|Documentation|ProjectSettings)\//);
  }
  for (const r of data.roadmap) assert.equal(r.lane === 'implemented', r.implementation === 'implemented');
});

test('support compatibility references current skills and excludes unsupported summons', () => {
  const names = new Set(skills.skills.map(s => s.name));
  assert.deepEqual([...names].sort(), snapshot.skills.map(s => s.displayName).sort());
  for (const s of skills.supports) {
    assert.ok(s.tier >= 1 && s.tier <= 6);
    for (const name of s.fits.split(', ')) {
      assert.ok(names.has(name), name);
      assert.ok(!['Shadow Double', 'Restless Spirits', 'Soul Bind'].includes(name));
    }
  }
});

test('conditional and passive mechanics do not show repeated-cast DPS or zero flat summon cost', () => {
  for (const s of skills.skills.filter(s => ['Passive', 'Ghosts', 'Mimic', 'Bind', 'WeaponInfusion', 'Blink'].includes(s.shape))) {
    assert.equal(s.dps, null, s.name);
    assert.equal(s.perMana, null, s.name);
    if (['Mimic', 'Bind'].includes(s.shape)) assert.equal(s.mana, null);
  }
});
