# Project K weapon review format (v1)

The weapon editor produces `project-k-weapons-*.json`. This file is a requested
design change, not a patch already applied to the game. User drafts live only in
their browser; exporting backs them up. Import replaces a draft after confirmation.

## Identification and conflicts

- `schema`: `whosnext.weapon-review`; `schemaVersion`: `1`.
- `source.asset`: project-relative Unity catalog path.
- `source.sha256`: SHA-256 of the source catalog bytes at export time.
- Every row has the stable catalog `id`, `type`, and `canWield`.
- `originalCatalog` preserves the serialized editable fields, including old grades.
- `baseline` is the normalized initial editor state.
- `requested` is the requested final state; `changedFields` identifies edited fields.
- `action` is `keep`, `update`, or `exclude`. The complete catalog is exported,
  including excluded, untouched and not-yet-wieldable weapons. Filters never limit export.
- Compare current game values with `originalCatalog`. A changed source hash requires
  conflict review; do not overwrite concurrent game changes. The browser rejects
  imports from a different source hash rather than silently dropping decisions.

## Selection and rarity

`included=false` asks to remove a weapon from available/drop catalogs, not to delete
its model, metadata or instances in existing saves. Preserve stable IDs and decide
how old saves migrate using `SaveFix`.

Game grades: White=0, Blue=1, Purple=2, Gold=3, Orange=4, Red=5.
Current display rarities: Normal (0), Magic (1), Rare (2/3), Unique (4/5).
The editor requests these four gameplay rarities. Preserve original enum values
when rarity was not edited. For a requested rarity change, examine `WeaponCrafting`,
drop generation and builder data: non-unique catalog grade currently represents
base quality and `WeaponCrafting.Make` produces Normal items independently of it.
Do not claim a changed grade alone changes actual drop rarity.

## Numeric units and unique effects

- `attack`, `guard`, `weight`: raw authored base values.
- `attackSpeed`, `critChance`: fractions, so 15% is `0.15`.
- `uniqueLines`: modifier IDs and values; use `modifierDefinitions` for units and
  existing English descriptions. `percent=true` uses fractions; other values are raw.
- Line metadata, where present, remains intact. Do not treat every positive number
  as a percentage. Definitions describe existing authored behavior, not a new balance spec.
- Legacy elemental lines below 1 were stored as fractions of level-scaled attack.
  The retired `holy_add` ID becomes `shadow_add`, as in `UniqueRoll` and `SaveFix`.
  `baseline` normalizes these using `value * attack * (1 + .035 * (uniqueLevel - 1))`,
  matching `WeaponCrafting.UniqueRoll`. `originalCatalog` retains the raw value.
  Apply only changed fields and avoid converting normalized values a second time.
- Unique values precede the existing 80-120% per-drop roll. The editor does not
  change that roll range. Unique lines on non-unique drafts remain inactive.
  Some existing unique rows contain non-weapon affixes from old builder output.
  They are preserved and flagged; verify runtime support before retaining them.
- `element` uses the existing Element enum names, including visual/legacy names;
  this is not a new damage type taxonomy.
- `notes` can request a new custom effect. It is plain text for the implementing AI,
  not executable code or an existing modifier ID. `lore` and weapon names are English.

## Applying a review in Unity

1. Read current AGENTS.md, the source catalog, builder, weapon stats and save code.
2. Review source conflicts and only apply the fields the user changed.
3. Implement persistent overrides consumed by `WeaponCatalogBuilder` or update its
   authored input. Do not hand-edit the generated `WeaponCatalog.asset`.
4. Handle loot selection, requested gameplay rarity, unique modifier runtime logic,
   tooltips/localization and old saves as required by the actual changes.
5. Run the relevant compile/game probes, then regenerate the website snapshot.

## Refreshing the website catalog

In the website repository, run:

```text
python scripts/export-project-k-weapons.py --project <Unity project root>
```

Requires PyYAML and Pillow. The script reads Unity YAML and modifier definitions,
checks IDs, and exports JSON plus WebP previews from the existing game icons. It
does not modify Unity or launch the editor. Public files contain no machine paths.
