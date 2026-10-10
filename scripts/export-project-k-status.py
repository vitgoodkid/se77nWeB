"""Snapshot serialized game content and code declarations without running Unity."""
import argparse
import hashlib
import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
import yaml

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--project', required=True, type=Path)
project = parser.parse_args().project.resolve()
sources = {}

def read(path):
    raw = (project / path).read_bytes()
    sources[path] = hashlib.sha256(raw).hexdigest()
    return raw.decode('utf-8-sig')

def asset(path):
    return yaml.safe_load(re.sub(r'^%.*\n|^--- !u!.*\n', '', read(path), flags=re.M))

root = 'Assets/_Game/'
weapons = asset(root + 'Resources/WeaponCatalog.asset')['MonoBehaviour']['weapons']
gear = asset(root + 'Resources/ModularGear.asset')['MonoBehaviour']['pieces']
skills = []
shapes = 'Projectile FrontWave GroundBurst SelfWard RainArea WeaponInfusion Wall Nova Curse Twister Arc Aura Blink Vortex Passive Mimic Ghosts Bind'.split()
for path in sorted((project / (root + 'Resources/Skills')).glob('*.asset')):
    s = asset(path.relative_to(project).as_posix())['MonoBehaviour']
    if 'id' not in s or 'shape' not in s:
        continue
    skills.append({k: s.get(k) for k in ('id', 'displayName', 'description', 'manaCost', 'cooldown', 'castDuration', 'damage', 'radius', 'school')}
                  | {'shape': shapes[s['shape']]})
support_text = read(root + 'Scripts/Runtime/Combat/SupportRune.cs')
supports = []
for block in re.findall(r'new\(\) \{ id = "rune_.*?description = ".*?" \}', support_text, re.S):
    values = dict(re.findall(r'\b(id|title|description|needs) = "((?:\\.|[^"\\])*)"', block))
    tier = re.search(r'\btier = (\d+)', block)
    supports.append(values | {'tier': int(tier[1]) if tier else 1})
quests = []
for p in sorted((project / (root + 'Resources/Story')).glob('*.txt')):
    quests += re.findall(r'^quest\s+(\S+)', read(p.relative_to(project).as_posix()), re.M)
build = asset('ProjectSettings/EditorBuildSettings.asset')['EditorBuildSettings']['m_Scenes']
tree = read(root + 'Scripts/Runtime/Player/PassiveTree.cs')
worlds = read(root + 'Scripts/Runtime/World/Rift/RiftWorlds.cs')
for path in ['Player/CharacterStats.cs', 'Combat/PlayerDefense.cs', 'Items/Flasks.cs', 'Items/GearStats.cs',
             'Camera/LockOnController.cs', 'World/AreaLevel.cs', 'Story/QuestLog.cs', 'Story/Dialogue.cs',
             'Hub/HubWorld.cs', 'Player/SidekickLook.cs', 'UI/SettingsWindow.Character.cs']:
    read(root + 'Scripts/Runtime/' + path)
data = dict(auditedAt=datetime.now(timezone.utc).isoformat(), method='Read-only source and serialized asset audit; no new Unity playtest.',
            counts=dict(weapons=len(weapons), activeWeapons=sum(not w.get('retired', False) for w in weapons),
                        gear=len(gear), skills=len(skills), supports=len(supports), quests=len(quests),
                        monsterPrefabs=len(list((project / (root + 'Prefabs/Monsters')).glob('*.prefab'))),
                        riftWorlds=len(re.findall(r'new\(\) \{ id =', worlds)),
                        keystoneDefinitions=len(re.findall(r'new Keystone \{', tree))),
            scenes=[Path(s['path']).stem for s in build if s['enabled']],
            gearByKind=dict(Counter(g['kind'] for g in gear)), skills=skills, supports=supports, quests=quests,
            sources=[dict(path=p, sha256=h) for p, h in sorted(sources.items())])
target = Path(__file__).resolve().parents[1] / 'public/games/project-k/status-data.json'
target.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({k:v for k,v in data.items() if k in ('counts','scenes','gearByKind')}, indent=2))
