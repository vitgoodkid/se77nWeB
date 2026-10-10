"""Read Unity's authored catalog without launching or modifying Unity.

Usage: python scripts/export-project-k-weapons.py --project <Unity project>
Requires PyYAML and Pillow. Output contains only project-relative source paths.
"""
import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path

import yaml
from PIL import Image


def arguments(text):
    return re.split(r',(?=(?:[^"\\]*(?:\\.[^"\\]*)*"[^"\\]*(?:\\.[^"\\]*)*")*[^"\\]*$)', text)


def string(value):
    return json.loads(value.strip())


def definitions(project):
    root = project / 'Assets/_Game/Scripts/Runtime/Items'
    result = []
    for filename, passive in [('WeaponAffixes.cs', False), ('WeaponPassives.cs', True)]:
        for line in (root / filename).read_text(encoding='utf-8-sig').splitlines():
            match = re.match(r'\s*([DG])\((.*)\),?\s*$', line)
            if not match:
                continue
            args = [s.strip() for s in arguments(match[2])]
            if passive:
                label, text, percent = args[1], args[5], len(args) < 7 or args[6] != 'false'
                default = float(args[3].rstrip('f'))
                kind = 'passive'
                weapon_compatible = True
            else:
                offset = 1 if match[1] == 'G' else 0
                label, text = args[2 + offset], args[3 + offset]
                percent = len(args) <= 8 + offset or args[8 + offset] != 'false'
                default = float(args[4 + offset].rstrip('f'))
                kind = 'affix'
                weapon_compatible = match[1] == 'D' or 'AffixSlots.Weapon' in args[2]
            result.append(dict(id=string(args[0]), name=string(label), text=string(text),
                               percent=percent, defaultValue=default, kind=kind, weaponCompatible=weapon_compatible))
    assert len({d['id'] for d in result}) == len(result), 'Duplicate modifier IDs'
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', required=True, type=Path)
    args = parser.parse_args()
    project = args.project.resolve()
    source = Path('Assets/_Game/Resources/WeaponCatalog.asset')
    raw = (project / source).read_bytes()
    text = re.sub(r'^%.*\n|^--- !u!.*\n', '', raw.decode('utf-8-sig'), flags=re.M)
    weapons = yaml.safe_load(text)['MonoBehaviour']['weapons']
    types = 'Dagger Sword Axe Mace Hammer Spear Halberd Poleaxe Greataxe Glaive Greatsword Longblade Bow Shield'.split()
    elements = 'Steel Fire Frost Lightning Poison Holy Shadow Blood Arcane Wind'.split()
    modifiers = definitions(project)
    known = {d['id'] for d in modifiers}
    target = Path(__file__).resolve().parents[1] / 'public/games/project-k'
    images = target / 'weapon-icons'
    images.mkdir(exist_ok=True)
    entries = []
    for weapon in weapons:
        wid = weapon['id']
        assert re.fullmatch(r'[a-zA-Z0-9_-]+', wid), wid
        icon = project / f'Assets/_Game/Resources/WeaponIcons/{wid}.png'
        assert icon.exists(), f'Missing icon: {wid}'
        with Image.open(icon) as img:
            img.thumbnail((256, 256))
            img.save(images / f'{wid}.webp', 'WEBP', quality=90, method=6)
        original = {key: weapon[key] for key in (
            'name', 'grade', 'attack', 'attackSpeed', 'critChance', 'guard', 'weight',
            'element', 'uniqueLevel', 'uniqueLines', 'lore')}
        original['lore'] = original['lore'] or ''
        original['retired'] = bool(weapon.get('retired', False))
        assert all(('shadow_add' if v['id'] == 'holy_add' else v['id']) in known for v in original['uniqueLines']), wid
        entries.append(dict(id=wid, type=types[weapon['type']], family=weapon['family'],
                            canWield=types[weapon['type']] in ['Sword', 'Greatsword', 'Longblade', 'Bow', 'Spear', 'Halberd', 'Glaive'],
                            icon=f'weapon-icons/{wid}.webp', original=original))
    assert len({w['id'] for w in entries}) == len(entries)
    data = dict(schemaVersion=1, generatedAt=datetime.now(timezone.utc).isoformat(),
                source=dict(asset=source.as_posix(), sha256=hashlib.sha256(raw).hexdigest(),
                            builder='Assets/_Game/Scripts/Editor/WeaponCatalogBuilder.cs', count=len(entries)),
                types=types, elements=elements, modifiers=modifiers, weapons=entries)
    (target / 'weapons-data.json').write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Exported {len(entries)} weapons, {len(modifiers)} modifier definitions and {len(entries)} icons.')


if __name__ == '__main__':
    main()
