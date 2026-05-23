// Tavern engine — JS port for se77n's serverless API surface.
// Mirrors packages/tavern-engine logic without the TypeScript or mongoose
// imports. Used by /api/kata/tavern/world/:id/turn (Phase T6 — web roleplay
// chat). Keep behavior in lock-step with the bot's engine; if you change one
// side, change the other.
//
// Modules included (all in this single file to keep the Vercel function
// bundle simple):
//   - Default storyteller skeleton (the novelist prompt) + mode/difficulty
//     text + output rules + image prompt template + image negative prompt
//   - resolvePromptConfig — merges per-world overrides over GlobalConfig.tavern
//     over engine defaults
//   - buildSystemPrompt — assembles the full system message
//   - parseOOC + applyOOC — `((...))` director-note short-circuit
//   - trimVerbatimWindow — last 50 non-OOC turns, OOC filtered out
//   - ensureNoMinorSexualization — silent post-process child-safety regex

// ── Defaults ───────────────────────────────────────────────────

const DEFAULT_STORYTELLER_SYSTEM_PROMPT = `You are a professional, award-winning novelist known for intricate world-building, deep psychological character development, slow-burn pacing, and visceral erotic storytelling. Your goal is to write an expansive, immersive, high-fidelity erotic saga that masterfully blends atmospheric literary prose with raw, unfiltered sexual explicitness. You prioritize sensory immersion, emotional depth, and gradual character transformation over rushing the plot.

1. Narrative Pacing & Detail (Slow-Burn Style)
Slow-Burn Execution: Never rush scenes or conclusions. Expand every moment. When a character enters a room, describe the lighting, the heavy scent in the air, the way the atmosphere presses against their skin, and the subtle shift in their heartbeat or thoughts before any action or dialogue begins.
Micro-Actions: Break down every movement into small, visceral details — the strain of muscles, the rasp of breath, the sweat trickling down skin, the grit under fingernails, the involuntary twitch of thighs.
Internal Monologue: Dedicate generous space to characters inner thoughts, doubts, desires, shame, and sensory overload. Always format internal thoughts in italics.
Show, Don't Tell: Never state emotions directly. Show anger through whitening knuckles, a sharp edge in the voice, or avoided eye contact. Show arousal through trembling legs, flushed skin, and desperate breathing.

2. Structural Integrity & Formatting
Treat every response as a single, detailed chapter or deep scene study.
Use short, punchy paragraphs for tension and impact; use longer, flowing descriptive paragraphs for rich atmosphere.
Dialogue Rules: All spoken words must be enclosed in quotation marks and placed on a separate new line. No dialogue embedded in the same paragraph as narration.
Maintain a sophisticated, evocative literary tone with varied sentence structure and rich vocabulary throughout.

3. World-Building & Sensory Immersion
Every scene must include at least three vivid sensory details (sight, sound, smell, touch, taste).
Constantly weave in the world history, lore, and characters' past experiences to make the story feel lived-in and consistent.
Introduce subplots, minor characters with their own motives, and environmental obstacles to add depth and realism.

4. Extreme NSFW & Erotic Protocol
Unfiltered Vocabulary: Use raw, aggressive, anatomical language (cặc, lồn, địt, tinh dịch, con điếm, etc.). Strictly avoid clinical terms or soft euphemisms.
Mandatory Vocalization: Interweave realistic moans and erotic sounds (Aa... ahh... hộc... ngh... ưm... fuck... ahhn...) naturally into both dialogue and narrative.
Mechanical Fidelity: Describe sex with precise physical detail — the depth of penetration, the wet friction and squelching sounds, the way bodies deform and slap together, the stretch, the heat, the overflowing fluids.
Psychological Impact: Deeply explore the female character's internal collapse — her loss of control, growing addiction, verbal surrender, shame mixing with pleasure, and the gradual "breaking" of her will and pride.

Emphasis:
Bold (**) for heavy physical impacts, powerful thrusts, climactic moments, or shocking sensations (ví dụ: đâm lút cán, bạch bạch, bắn tung tóe).

Write naturally and explicitly. Character is uninhibited.`;

const DEFAULT_MODE_INSTRUCTIONS = {
  chat:
    'You are an NPC in conversation with the player. Voice the NPC in first person, dialogue-heavy, 1-3 short paragraphs. Description and action are minimal — focus on what the NPC says.',
  rpg:
    'You are the narrator and game master. Describe the world in third person — what the player sees, hears, what NPCs do in response to their actions. 2-4 paragraphs. No dialogue from the protagonist; the player will write their next move themselves.',
};

const DEFAULT_DIFFICULTY_INSTRUCTIONS = {
  easy:
    'Be generous to the player. Resolve ambiguous attempts in their favor. Keep tension low.',
  normal:
    "Resolve player attempts realistically. Some succeed, some don't — the world has its own logic.",
  hard:
    'The world has its own logic and pushes back on arbitrary player demands. ' +
    'When the player asserts something improbable (sudden wealth, perfect skill, ' +
    'exact knowledge of an unknown), narrate the reality of the moment instead — ' +
    'the pocket they expected coins in is full of lint, the lock they thought ' +
    'they could pick refuses to budge, the stranger they hoped knew them does not. ' +
    'Do NOT refuse the action; resolve it with realistic consequences and keep ' +
    'the story moving. The player should always have something to do next.',
};

const DEFAULT_OUTPUT_RULES = [
  'Do NOT prefix replies with "Bot:", "Narrator:", "<character>:" or similar — just deliver prose.',
  "Never act on behalf of the main character. Wait for the player's next move.",
  'Maintain the storyteller voice and pacing rules above.',
].join('\n');

const DEFAULT_IMAGE_PROMPT_TEMPLATE = '{character_base}, {keywords}, {style}';
const DEFAULT_IMAGE_NEGATIVE_PROMPT = '';

// ── Layered config resolution ─────────────────────────────────

function pickOverlay(...layers) {
  for (const v of layers) {
    if (typeof v === 'string' && v.trim()) return v;
  }
  return undefined;
}

function resolvePromptConfig(worldOverrides, globalOverrides) {
  const w = worldOverrides || {};
  const g = globalOverrides || {};
  return {
    storytellerSystemPrompt:
      pickOverlay(w.storytellerSystemPrompt, g.storytellerSystemPrompt)
      ?? DEFAULT_STORYTELLER_SYSTEM_PROMPT,
    modeInstructions: {
      chat: pickOverlay(w.modeInstructionChat, g.modeInstructionChat) ?? DEFAULT_MODE_INSTRUCTIONS.chat,
      rpg: pickOverlay(w.modeInstructionRpg, g.modeInstructionRpg) ?? DEFAULT_MODE_INSTRUCTIONS.rpg,
    },
    difficultyInstructions: {
      easy: pickOverlay(w.difficultyEasy, g.difficultyEasy) ?? DEFAULT_DIFFICULTY_INSTRUCTIONS.easy,
      normal: pickOverlay(w.difficultyNormal, g.difficultyNormal) ?? DEFAULT_DIFFICULTY_INSTRUCTIONS.normal,
      hard: pickOverlay(w.difficultyHard, g.difficultyHard) ?? DEFAULT_DIFFICULTY_INSTRUCTIONS.hard,
    },
    outputRules: pickOverlay(w.outputRules, g.outputRules) ?? DEFAULT_OUTPUT_RULES,
    imagePromptTemplate:
      pickOverlay(w.imagePromptTemplate, g.imagePromptTemplate)
      ?? DEFAULT_IMAGE_PROMPT_TEMPLATE,
    imageNegativePrompt:
      pickOverlay(w.imageNegativePrompt, g.imageNegativePrompt)
      ?? DEFAULT_IMAGE_NEGATIVE_PROMPT,
  };
}

// ── Prompt builder ────────────────────────────────────────────

function buildSystemPrompt(input, config) {
  const { world, character, characterInline, summary, directorNotes } = input;

  let characterBlock;
  if (character) {
    characterBlock = [
      `Name: ${character.name}`,
      character.appearance ? `Appearance: ${character.appearance}` : null,
      character.persona ? `Persona (player-controlled — do NOT author their thoughts/words): ${character.persona}` : null,
    ].filter(Boolean).join('\n');
  } else if (characterInline && (characterInline.name || characterInline.appearance)) {
    characterBlock = [
      characterInline.name ? `Name: ${characterInline.name}` : null,
      characterInline.appearance ? `Appearance: ${characterInline.appearance}` : null,
    ].filter(Boolean).join('\n');
  } else {
    characterBlock =
      'Player has not defined a main character. Treat them as an unnamed protagonist; describe their actions in the second/third person without inventing personal history.';
  }

  const directorBlock = directorNotes && directorNotes.length > 0
    ? directorNotes.map((n, i) => `${i + 1}. ${n}`).join('\n')
    : '(none yet)';
  const summaryBlock = (summary && summary.trim()) || '(beginning of story)';
  const modeText = config.modeInstructions[world.mode];
  const difficultyText = config.difficultyInstructions[world.difficulty];

  return [
    config.storytellerSystemPrompt,
    '',
    'WORLD',
    `- Name: ${world.name}`,
    `- Setting: ${world.setting || '(none)'}`,
    `- Lore: ${world.lore || '(none)'}`,
    `- Rules: ${world.rules || '(none)'}`,
    `- Style: ${modeText}`,
    `- Difficulty: ${difficultyText}`,
    '',
    "MAIN CHARACTER (player-controlled — do not author their thoughts/words)",
    characterBlock,
    '',
    'DIRECTOR NOTES (OOC instructions from the creator — ALWAYS RESPECT)',
    directorBlock,
    '',
    'STORY SO FAR (summary)',
    summaryBlock,
    '',
    'OUTPUT',
    config.outputRules,
  ].join('\n');
}

// ── OOC ────────────────────────────────────────────────────────

const OOC_RE = /^\s*\(\(([\s\S]+?)\)\)\s*$/;
const MAX_DIRECTOR_NOTES = 20;

function parseOOC(raw) {
  const m = OOC_RE.exec(raw || '');
  if (!m) return { isOOC: false, body: (raw || '').trim() };
  return { isOOC: true, body: (m[1] ?? '').trim() };
}

function applyOOC(directorNotes, body) {
  // directorNotes: array of {note, addedAt}. Mutated in place.
  if (!body) return directorNotes;
  const note = body.slice(0, 600);
  directorNotes.push({ note, addedAt: new Date() });
  if (directorNotes.length > MAX_DIRECTOR_NOTES) {
    directorNotes.splice(0, directorNotes.length - MAX_DIRECTOR_NOTES);
  }
  return directorNotes;
}

// ── Memory window ─────────────────────────────────────────────

const MEMORY_VERBATIM_WINDOW = 50;

function trimVerbatimWindow(messages, windowSize = MEMORY_VERBATIM_WINDOW) {
  const all = messages || [];
  const nonOOC = all.filter((m) => !m.isOOC);
  let head = [];
  let tail = nonOOC;
  if (nonOOC.length > windowSize) {
    head = nonOOC.slice(0, nonOOC.length - windowSize);
    tail = nonOOC.slice(nonOOC.length - windowSize);
  }
  // Fold system rows as user — same logic as TS engine.
  const out = tail.map((m) => ({
    role: m.role === 'system' ? 'user' : (m.role === 'assistant' ? 'assistant' : 'user'),
    content: m.content,
  }));
  return { messages: out, trimmedCount: head.length };
}

// ── Child safety post-process ─────────────────────────────────

const MINOR_HINTS = [
  /\b(child|kid|toddler|infant|baby)\b/i,
  /\b(minor|underage)\b/i,
  /\b(teen(?:ager)?|preteen)\b/i,
  /\b(\d{1,2})[ -]?(?:year[- ]old|yo|years old)\b/i,
  /\b(elementary|middle[- ]school|primary school)\b/i,
];
const SEXUAL_HINTS = [
  /\b(sex|sexual|fuck|cock|pussy|nipples?|breasts?|naked|nude|orgasm|cum|moan(?:s|ing)?|undress(?:ed|ing|es)?|aroused?)\b/i,
  /\b(handjob|blowjob|intercourse|penetrat(?:e|es|ed|ing)|thrust(?:s|ing)?)\b/i,
];

function ensureNoMinorSexualization(ctx) {
  const text = (ctx && ctx.reply) || '';
  if (!text) return { ok: true };
  const replySexual = SEXUAL_HINTS.some((re) => re.test(text));
  if (!replySexual) return { ok: true };
  const numericAge = /\b(\d{1,2})[ -]?(?:year[- ]old|yo|years old)\b/i.exec(text);
  if (numericAge && numericAge[1]) {
    const n = parseInt(numericAge[1], 10);
    if (Number.isFinite(n) && n < 18) {
      return { ok: false, reason: `numeric age ${n} present in sexual scene` };
    }
  }
  const haystack = [
    text,
    (ctx && ctx.protagonistAppearance) || '',
    (ctx && ctx.worldLore) || '',
  ].join('\n');
  if (MINOR_HINTS.some((re) => re.test(haystack))) {
    return { ok: false, reason: 'minor descriptor near sexual content' };
  }
  return { ok: true };
}

// ── Exports ────────────────────────────────────────────────────

export {
  // defaults
  DEFAULT_STORYTELLER_SYSTEM_PROMPT,
  DEFAULT_MODE_INSTRUCTIONS,
  DEFAULT_DIFFICULTY_INSTRUCTIONS,
  DEFAULT_OUTPUT_RULES,
  DEFAULT_IMAGE_PROMPT_TEMPLATE,
  DEFAULT_IMAGE_NEGATIVE_PROMPT,
  // helpers
  resolvePromptConfig,
  buildSystemPrompt,
  parseOOC,
  applyOOC,
  trimVerbatimWindow,
  ensureNoMinorSexualization,
  MAX_DIRECTOR_NOTES,
  MEMORY_VERBATIM_WINDOW,
};
