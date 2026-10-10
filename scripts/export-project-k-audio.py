"""Read game SFX + transitive serialized dependencies; encode unnormalized web previews.

python scripts/export-project-k-audio.py --project <Unity project>
Requires PyYAML and ffmpeg. Never writes to the Unity project.
"""
import argparse
import hashlib
import json
import math
import re
import struct
import subprocess
import tempfile
import wave
from datetime import datetime, timezone
from pathlib import Path

import yaml

AUDIO = {'.wav', '.ogg', '.mp3', '.aiff', '.aif'}
SERIAL = {'.asset', '.prefab', '.unity', '.controller', '.overrideController', '.anim', '.mat'}


def unity_yaml(path):
    return yaml.safe_load(re.sub(r'^%.*\n|^--- !u!.*\n', '', path.read_text(encoding='utf-8-sig'), flags=re.M))['MonoBehaviour']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', type=Path, required=True)
    project = parser.parse_args().project.resolve()
    target = Path(__file__).resolve().parents[1] / 'public/games/project-k'
    previews = target / 'audio-previews'
    previews.mkdir(exist_ok=True)
    paths, ids = {}, {}
    for meta in (project / 'Assets').rglob('*.meta'):
        path = Path(str(meta)[:-5])
        if path.suffix not in AUDIO | SERIAL:
            continue
        match = re.search(r'^guid: (\w+)', meta.read_text(encoding='utf-8-sig'), re.M)
        if match:
            paths[match[1]] = path
            ids[path] = match[1]
    sources = ['Assets/_Game/Resources/SoundLevels.asset', 'Assets/_Game/Resources/CombatSoundLibrary.asset',
               'Assets/_Game/Scripts/Runtime/Combat/DefenseFeedback.cs']
    levels = {e['clip']: e for e in unity_yaml(project / sources[0])['entries']}
    queue = [p for p in ids if p.suffix in SERIAL and p.is_relative_to(project / 'Assets/_Game')]
    visited, references = set(), {}
    while queue:
        path = queue.pop()
        if path in visited:
            continue
        visited.add(path)
        text = path.read_text(encoding='utf-8-sig', errors='ignore')
        for guid in set(re.findall(r'guid: ([a-f0-9]{32})', text)):
            dep = paths.get(guid)
            if dep is None:
                continue
            if dep.suffix in AUDIO:
                references.setdefault(dep, set()).add(path.relative_to(project).as_posix())
            elif dep not in visited:
                queue.append(dep)
    clips = sorted(p for p in ids if p.suffix in AUDIO and 'Music' not in p.parts and
                   (p in references or p.is_relative_to(project / 'Assets/_Game') or
                    (p.stem in levels and not levels[p.stem]['note'].startswith('music:'))))
    cues = {}
    def walk(value, label):
        if isinstance(value, dict):
            if 'clips' in value and 'volume' in value:
                for clip in value['clips']:
                    cues.setdefault(clip.get('guid'), []).append({'cue': label, 'volume': value['volume']})
            else:
                for key, child in value.items():
                    walk(child, label + '.' + key)
        elif isinstance(value, list):
            for i, child in enumerate(value):
                walk(child, label + '.' + str(i))
    walk(unity_yaml(project / sources[1]), 'CombatSoundLibrary')
    entries = []
    def encode(path, identity):
        out = previews / (identity + '.mp3')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(path), '-map_metadata', '-1',
                        '-codec:a', 'libmp3lame', '-q:a', '4', str(out)], check=True)
        duration = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                                                '-of', 'default=nw=1:nk=1', str(out)], text=True))
        return round(duration, 3)
    for path in clips:
        guid = ids[path]
        rel = path.relative_to(project).as_posix()
        category = ('Loot' if '/LootSounds/' in rel else 'World' if '/WorldSounds/' in rel else
                    'UI' if '/UiSounds/' in rel else path.parent.name if '/Audio/SFX/' in rel else 'Effects')
        level = levels.get(path.stem, {})
        uses = sorted(references.get(path, []))
        if category in ('Loot', 'World', 'UI'):
            uses.append('Resources.Load: ' + rel.split('/Resources/')[1].rsplit('.', 1)[0])
        entries.append(dict(id=guid, name=path.stem, path=rel, category=category, usages=uses,
                            status='referenced' if uses else 'unreferenced',
                            originalGain=level.get('gain', 1), balanceNote=level.get('note', ''),
                            cues=cues.get(guid, []), duration=encode(path, guid),
                            preview='audio-previews/' + guid + '.mp3', sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                            applyMode='SoundLevels.clip-name'))
    # The only procedural AudioClip.Create in runtime: fallback when the sound library is absent.
    with tempfile.TemporaryDirectory() as tmp:
        pulse = Path(tmp) / 'pulse.wav'
        with wave.open(str(pulse), 'wb') as wav:
            wav.setparams((1, 2, 22050, 2205, 'NONE', 'not compressed'))
            wav.writeframes(b''.join(struct.pack('<h', round(math.sin(i * 2 * math.pi * 800 / 22050) *
                                                         (1 - i / 2205) * .2 * 32767)) for i in range(2205)))
        entries.append(dict(id='procedural-guard-pulse', name='Guard pulse', path=sources[2], category='Fallback',
                            usages=['DefenseFeedback.OnResolved: only when CombatAudio.Active is false'], status='fallback',
                            originalGain=1, balanceNote='Procedural fallback; playback pitch varies by hit result.', cues=[],
                            duration=encode(pulse, 'procedural-guard-pulse'), preview='audio-previews/procedural-guard-pulse.mp3',
                            sha256=hashlib.sha256((project / sources[2]).read_bytes()).hexdigest(),
                            applyMode='requires-runtime-gain-hook'))
    snapshot = {'schema': 'project-k-audio-catalog/v1', 'sources': [
        {'path': p, 'sha256': hashlib.sha256((project / p).read_bytes()).hexdigest()} for p in sources], 'clips': entries}
    snapshot['fingerprint'] = hashlib.sha256(json.dumps(snapshot, sort_keys=True).encode()).hexdigest()
    snapshot['generatedAt'] = datetime.now(timezone.utc).isoformat()
    snapshot['coverage'] = {'gameSfxAndReferencedEffects': len(entries), 'serializedAssetsScanned': len(visited),
                            'scope': 'All non-music audio owned by _Game, audio in transitive serialized dependencies, '
                                     'SFX named in SoundLevels, plus procedural Guard pulse. Unused third-party pack files excluded.'}
    (target / 'audio-data.json').write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'clips': len(entries), 'categories': {c: sum(e['category'] == c for e in entries)
                     for c in sorted({e['category'] for e in entries})}, 'previewBytes': sum(p.stat().st_size for p in previews.glob('*.mp3'))}))


if __name__ == '__main__':
    main()
