"""Refresh the skill page from Unity's balance report, checking it against assets.

Run the status exporter first. This never launches or modifies Unity.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--project', type=Path, required=True)
project = parser.parse_args().project.resolve()
target = Path(__file__).resolve().parents[1] / 'public/games/project-k'
status = json.loads((target / 'status-data.json').read_text(encoding='utf-8'))
report_path = 'Documentation/GDD/SkillBalance.md'
raw = (project / report_path).read_bytes()
rows = [[c.strip() for c in line.strip('|').split('|')]
        for line in raw.decode('utf-8-sig').splitlines() if line.startswith('|')]
keys = 'name shape type cast cd mana r area targets hits perHit perTarget pack perMana dps note'.split()
numbers = set('cast cd mana r area targets perTarget pack perMana dps'.split())
skills = []
assets = {s['displayName']: s for s in status['skills']}
for row in rows:
    if len(row) != 16 or row[0] not in assets:
        continue
    s = {k: (None if v == '-' else float(v)) if k in numbers else v for k, v in zip(keys, row)}
    a = assets[s['name']]
    assert s['shape'] == a['shape'], s['name']
    for field, asset_field in [('mana', 'manaCost'), ('cd', 'cooldown'), ('cast', 'castDuration'), ('r', 'radius')]:
        assert abs(s[field] - a[asset_field]) < .011, (s['name'], field, s[field], a[asset_field])
    # These mechanics do not follow the report's repeated-cast DPS model.
    if s['shape'] in ('Passive', 'Ghosts', 'Mimic', 'Bind', 'Blink', 'WeaponInfusion'):
        s['perMana'] = s['dps'] = None
        s['note'] = a['description']
        if s['shape'] != 'Passive':
            for field in ('perHit', 'perTarget', 'pack', 'hits'):
                s[field] = None
        if s['shape'] in ('Passive', 'Ghosts'):
            s['cast'] = s['cd'] = None
        if s['shape'] in ('Mimic', 'Bind'):
            s['mana'] = None
    if s['name'] == 'Ground Slash':
        s['hits'] = '1'
    skills.append(s)
assert len(skills) == len(assets) == len({s['name'] for s in skills})
supports = [dict(zip(('name', 'tier', 'needs', 'fits', 'excludes'), row))
            for row in rows if len(row) == 5 and row[0].endswith(' Support')]
assert {s['name'] for s in supports} == {s['title'] for s in status['supports']}
for s in supports:
    s['tier'] = int(s['tier'])
    assert s['tier'] == next(a['tier'] for a in status['supports'] if a['title'] == s['name'])
    assert set(s['fits'].split(', ')) <= assets.keys(), s['name']
    assert not set(s['fits'].split(', ')) & {'Shadow Double', 'Restless Spirits', 'Soul Bind'}
data = dict(source=dict(path=report_path, sha256=hashlib.sha256(raw).hexdigest()), skills=skills, supports=supports)
page = target / 'skills.html'
text = page.read_text(encoding='utf-8')
text, count = re.subn(r'const DATA = .*?;\n(?=const FORM)', lambda _: 'const DATA = ' + json.dumps(data, ensure_ascii=False) + ';\n', text, count=1, flags=re.S)
assert count == 1
page.write_text(text, encoding='utf-8')
print(f'Exported {len(skills)} skills and {len(supports)} supports; source values match the asset snapshot.')
