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
  'Trả lời mặc định bằng TIẾNG VIỆT, trừ khi user chat bằng ngôn ngữ khác — match theo ngôn ngữ user.',
  'KHÔNG prefix "Bot:", "Narrator:", "<character>:" hay tương tự — chỉ deliver prose trực tiếp.',
  "KHÔNG tự ý hành động thay main character. Đợi player viết next move của họ.",
  'Giữ giọng kể + pacing rules ở trên.',
  '',
  'SAU khi viết xong scene, BẮT BUỘC thêm 1 dòng đúng dạng `<<SUGGESTIONS>>` rồi 4 dòng tiếp theo là 4 lựa chọn cho player ở ngôi thứ nhất, mỗi dòng đánh số 1. 2. 3. 4. Mỗi gợi ý ≤80 ký tự, là 1 hành động/câu nói cụ thể player CÓ THỂ làm tiếp theo. Đa dạng hướng (ví dụ: hành động táo bạo / dò hỏi / phòng thủ / bất ngờ). Không lặp ý.',
  'Định dạng PHẢI chính xác:',
  '<<SUGGESTIONS>>',
  '1. ...',
  '2. ...',
  '3. ...',
  '4. ...',
].join('\n');

const DEFAULT_IMAGE_PROMPT_TEMPLATE = '{character_base}, {keywords}, {style}';
const DEFAULT_IMAGE_NEGATIVE_PROMPT = '';

// Model + tuning defaults — must mirror packages/tavern-engine/src/promptDefaults.ts.
const DEFAULT_CHAT_MODEL = 'gemini-3.1-pro-preview';
const DEFAULT_LORE_MODEL = 'grok-4-fast';
const DEFAULT_WORLDGEN_MODEL = 'grok-4-fast';
const DEFAULT_SUBJECT_MODEL = 'grok-4-fast';
const DEFAULT_SCENE_IMAGE_MODELS = ['fal-ai/nano-banana-pro', 'fal-ai/flux/schnell'];
const DEFAULT_COVER_IMAGE_MODELS = ['fal-ai/nano-banana-pro', 'fal-ai/flux/schnell'];
const DEFAULT_TURN_TEMPERATURE = 0.85;
// The default storyteller model (gemini-3.1-pro-preview) is a reasoning model:
// on the OpenAI-compatible API the token budget is shared with hidden thinking
// tokens. At 1200 the reasoning ate most of the budget, leaving a tiny, cut-off
// reply (and no <<SUGGESTIONS>> block). 4000 leaves room for thinking + a full
// scene. Owners can tune this per-world or globally (override range 1..32000).
const DEFAULT_TURN_MAX_TOKENS = 4000;
const DEFAULT_MEMORY_WINDOW_SIZE = 50;

// ── Layered config resolution ─────────────────────────────────

function pickOverlay(...layers) {
  for (const v of layers) {
    if (typeof v === 'string' && v.trim()) return v;
  }
  return undefined;
}

function pickArrOverlay(...layers) {
  for (const v of layers) {
    if (Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === 'string' && s.trim())) {
      return v.map((s) => s.trim());
    }
  }
  return undefined;
}

function pickNumOverlay(...layers) {
  for (const v of layers) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
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
    chatModel: pickOverlay(w.chatModel, g.chatModel) ?? DEFAULT_CHAT_MODEL,
    loreModel: pickOverlay(w.loreModel, g.loreModel) ?? DEFAULT_LORE_MODEL,
    worldGenModel: pickOverlay(w.worldGenModel, g.worldGenModel) ?? DEFAULT_WORLDGEN_MODEL,
    subjectModel: pickOverlay(w.subjectModel, g.subjectModel) ?? DEFAULT_SUBJECT_MODEL,
    sceneImageModels:
      pickArrOverlay(w.sceneImageModels, g.sceneImageModels) ?? DEFAULT_SCENE_IMAGE_MODELS.slice(),
    coverImageModels:
      pickArrOverlay(w.coverImageModels, g.coverImageModels) ?? DEFAULT_COVER_IMAGE_MODELS.slice(),
    turnTemperature:
      pickNumOverlay(w.turnTemperature, g.turnTemperature) ?? DEFAULT_TURN_TEMPERATURE,
    turnMaxTokens:
      pickNumOverlay(w.turnMaxTokens, g.turnMaxTokens) ?? DEFAULT_TURN_MAX_TOKENS,
    memoryWindowSize:
      pickNumOverlay(w.memoryWindowSize, g.memoryWindowSize) ?? DEFAULT_MEMORY_WINDOW_SIZE,
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

// ── Storyteller reply parser ──────────────────────────────────
//
// Splits the LLM raw output into prose + 4 suggestions per the OUTPUT
// contract (`<<SUGGESTIONS>>` marker line, then numbered list).

const REPLY_MARKER_RE = /\n*<<\s*SUGGESTIONS\s*>>\n+([\s\S]*)$/i;
const NUMBERED_LINE_RE = /^\s*\d+[).\s-]+\s*(.+?)\s*$/;
const BULLET_LINE_RE = /^\s*[•\-*–—]\s*(.+?)\s*$/;
const MAX_SUGGESTION_LEN = 200;
const MAX_SUGGESTIONS = 4;

function parseStorytellerReply(raw) {
  if (!raw) return { prose: '', suggestions: [], hadMarker: false };
  const m = REPLY_MARKER_RE.exec(raw);
  if (!m) return { prose: raw.trim(), suggestions: [], hadMarker: false };
  const prose = raw.slice(0, m.index).trim();
  const tail = m[1] ?? '';
  const lines = tail.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const suggestions = [];
  for (const line of lines) {
    if (suggestions.length >= MAX_SUGGESTIONS) break;
    const num = NUMBERED_LINE_RE.exec(line);
    const bul = !num ? BULLET_LINE_RE.exec(line) : null;
    const body = ((num && num[1]) || (bul && bul[1]) || '').trim();
    if (!body) continue;
    suggestions.push(body.slice(0, MAX_SUGGESTION_LEN));
  }
  return { prose, suggestions, hadMarker: true };
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
  DEFAULT_CHAT_MODEL,
  DEFAULT_LORE_MODEL,
  DEFAULT_WORLDGEN_MODEL,
  DEFAULT_SUBJECT_MODEL,
  DEFAULT_SCENE_IMAGE_MODELS,
  DEFAULT_COVER_IMAGE_MODELS,
  DEFAULT_TURN_TEMPERATURE,
  DEFAULT_TURN_MAX_TOKENS,
  DEFAULT_MEMORY_WINDOW_SIZE,
  // helpers
  resolvePromptConfig,
  buildSystemPrompt,
  parseOOC,
  applyOOC,
  parseStorytellerReply,
  trimVerbatimWindow,
  ensureNoMinorSexualization,
  MAX_DIRECTOR_NOTES,
  MEMORY_VERBATIM_WINDOW,
};
