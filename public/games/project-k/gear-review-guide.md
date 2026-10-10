# Project K gear review format (v1)

The gear page (`gear.html`) produces `project-k-gear-*.json`. It is a requested design
change, not a patch already applied to the game. Drafts live only in the author's
browser; exporting backs them up and import replaces a draft after confirmation.

## What is in it

- `pieces`: every armour piece the game builds from the Synty Sidekick packs
  (Knights, Sorcerers, Samurai, Viking). `kind` is Body, Gloves, Boots, Helmet or Side.
  - Body = torso + hips of one pack set, with that set's shoulder and hip attachments (back pieces are always Side).
  - Gloves = both upper arms, lower arms and hands, with the elbow pads. Boots = both legs + both feet (LEG and FOT together), with the knee pads. Helmet = head attachment + face (mask).
  - Helmet = the head attachment. Side = one other attachment: `side` is Back, Face,
    Shoulders, Hips, Elbows or Knees. Side is the slot where the cape used to be.
  - `original.parts` lists the part meshes by file name (the first is the bag picture).
- `creator`: the character creator's options (Face, Hair, Facial hair, Eyebrows, Eyes,
  Ears, Nose, Teeth), per species. `id` is the part's file name; eyebrows, eyes and ears
  are listed by their left part and apply to both sides.
- Every row has the stable `id`, `original`, `baseline`, `requested`, `changedFields`, `action`.

## Applying it

1. Compare `source.sha256` with `Assets/_Game/Resources/ModularGear.asset`; a different hash
   needs conflict review against each row's `original`.
2. Copy `requested` into `Assets/_Game/Data/Sidekick/gear_review.json` (`pieces[].requested`
   with `included`, `name`, `defence`, `tier`, `hidesHair`, `special`; `creator[].requested.included`),
   run Tools/Whosnext/Sidekick/Build everything, then run the gear and creator probes.
3. `included=false` removes a piece from drops, the stash and shops, but keep its meshes and ids so
   old saves load; migrate through `SaveFix`.
4. `defence` is any of Armour, Agility, Spellguard. Several means a hybrid piece carrying 60% of each.
5. `tier` 1-4 is the item level band it first drops at and scales its numbers.
6. `notes` ask for behaviour that does not exist yet; implement them as separate work.
7. Keep English proper names, add localization (`Resources/Lang/vi_*.txt`) for new UI text.
