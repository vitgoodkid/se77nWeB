import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {baseline, makeExport, readImport, validate} from '../public/games/project-k/audio-model.js';

const data = JSON.parse(fs.readFileSync(new URL('../public/games/project-k/audio-data.json', import.meta.url)));
test('catalog covers all owned SFX and referenced effects with playable preview assets', () => {
  assert.equal(data.clips.length, 140);
  assert.equal(new Set(data.clips.map(c => c.id)).size, data.clips.length);
  const counts = {};
  for (const c of data.clips) {
    counts[c.category] = (counts[c.category] || 0) + 1;
    assert.ok(fs.statSync(new URL(`../public/games/project-k/${c.preview}`, import.meta.url)).size > 0);
    assert.ok(c.duration > 0);
    assert.ok(c.path.startsWith('Assets/'));
    assert.ok(!c.path.includes('/Music/'));
  }
  assert.deepEqual(counts, {Boss:12, Player:40, Skills:58, Loot:6, UI:1, World:3, Effects:19, Fallback:1});
  validate(data, baseline(data));
});
test('untouched roundtrip preserves original fractional gains and all entries', () => {
  const gains = baseline(data), file = makeExport(data, gains);
  assert.ok(file.clips.every(c => !c.changed));
  assert.deepEqual(readImport(data, JSON.parse(JSON.stringify(file))), gains);
});
test('mute and amplification replace gain and survive export/import', () => {
  const gains = baseline(data);
  gains[data.clips[0].id] = 0;
  gains[data.clips[1].id] = 12.345;
  const file = makeExport(data, gains);
  assert.equal(file.clips.filter(c => c.changed).length, 2);
  assert.equal(file.clips[0].requestedGain, 0);
  assert.equal(file.clips[1].requestedGain, 12.345);
  assert.deepEqual(readImport(data, file), gains);
  assert.equal(file.monitor, undefined);
});
test('reject stale, incomplete, duplicate and forged source imports atomically', () => {
  for (const mutate of [f => f.sourceFingerprint = 'old', f => f.clips.pop(),
    f => f.clips[1] = f.clips[0], f => f.clips[0].originalGain++, f => f.clips[0].name = 'renamed',
    f => f.clips[0].sha256 = 'bad', f => f.clips[0].requestedGain = '0',
    f => f.clips[0].requestedGain = -1, f => f.clips[0].requestedGain = 17]) {
    const file = makeExport(data, baseline(data)); mutate(file);
    assert.throws(() => readImport(data, file));
  }
});
test('duplicate clip names cannot diverge from Unity name-based gain semantics', () => {
  const duplicate = {...data, clips:[data.clips[0], {...data.clips[0], id:'other-guid'}]};
  const gains = baseline(duplicate); gains['other-guid'] = .123;
  assert.throws(() => validate(duplicate, gains));
});
