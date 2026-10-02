/**
 * memory-junk — display-only noise rules for the mnemosyne Memory Map and
 * Browse (entity stopwords, fragment facts). A leaf module so both
 * memory-graph and mnemosyne-browser can share one word list.
 */

// Junk entity strings (function words + chat filler) that otherwise become
// the graph's top hubs. Compared lowercased; anything shorter than 3 chars
// is dropped too.
export const ENTITY_STOPWORDS = new Set(
  (
    'the and but for nor not yet are was were has had have its his her she him ' +
    'you your our they them their this that these those with from into onto ' +
    'over then than when what which who whom why how where there here also ' +
    'just some any all each can could will would should may might must shall ' +
    'been being does did done yes yeah yep nope okay sure thanks thank thx ' +
    'please hello hey users none null true false one two now new get got let ' +
    'use see only good both current category ' +
    'jan feb mar apr jun jul aug sep sept oct nov dec'
  ).split(' '),
)

// Discourse words that open a sentence fragment mis-extracted as a fact
// subject ("If there | is | genuinely", "So this | is | …").
const FILLER_SUBJECT_STARTS = new Set(
  (
    'if so how below above here what when then but and also now well just ' +
    'why okay ok noted whether'
  ).split(' '),
)
// Single-word objects that carry no meaning on their own; "lready"/"ctually"/
// "lso" are extractor-clipped already/actually/also.
const JUNK_OBJECTS = new Set(
  (
    'still lready ctually lso already actually really very too temporarily ' +
    'multi self'
  ).split(' '),
)
// Objects that look junk by the rules below but carry meaning: "done" is a
// stopword yet "Task is done" is a fact; the rest are -ly nouns, not adverbs.
const OBJECT_ALLOW = new Set(
  'done family july italy rally reply supply apply assembly anomaly ally'.split(
    ' ',
  ),
)

/**
 * Display-only heuristic: a fact that is a sentence fragment, not knowledge.
 * Junk when the subject opens with a discourse filler, or the object is one
 * stopword / adverb (-ly, <=12 chars). Facts are hidden, never deleted.
 */
export function isJunkFact(
  subject: string | null,
  _predicate: string | null,
  object: string | null,
): boolean {
  const first = String(subject ?? '')
    .trim()
    .split(/\s+/)[0]
    .toLowerCase()
  if (FILLER_SUBJECT_STARTS.has(first)) return true
  const obj = String(object ?? '')
    .trim()
    .toLowerCase()
  if (!obj || /\s/.test(obj) || OBJECT_ALLOW.has(obj)) return false
  return (
    ENTITY_STOPWORDS.has(obj) ||
    JUNK_OBJECTS.has(obj) ||
    // ponytail: -ly is a guess at "adverb"; nouns it wrongly hides go in
    // OBJECT_ALLOW (a POS tagger is the real fix, not worth it for display).
    (obj.length <= 12 && /^[a-z]+ly$/.test(obj))
  )
}

// isJunkFact as SQL over `facts f` (ASCII lower/trim, like the JS for the
// data mnemosyne extracts). Bind junkFactSqlParams(); the word lists travel
// as JSON params, so the SQL and the TS share one source of truth.
const sqlNorm = (col: string) =>
  `lower(trim(replace(replace(replace(${col}, char(9), ' '), char(10), ' '), char(13), ' ')))`
const SQL_S = sqlNorm('f.subject')
const SQL_O = sqlNorm('f.object')
export const JUNK_FACT_SQL = `(
  (CASE WHEN instr(${SQL_S}, ' ') > 0 THEN substr(${SQL_S}, 1, instr(${SQL_S}, ' ') - 1) ELSE ${SQL_S} END)
    IN (SELECT value FROM json_each(@junkFillers))
  OR (${SQL_O} <> '' AND instr(${SQL_O}, ' ') = 0
    AND ${SQL_O} NOT IN (SELECT value FROM json_each(@junkAllow))
    AND (${SQL_O} IN (SELECT value FROM json_each(@junkObjects))
      OR (length(${SQL_O}) <= 12 AND ${SQL_O} GLOB '?*ly' AND NOT ${SQL_O} GLOB '*[^a-z]*')))
)`
export const junkFactSqlParams = () => ({
  junkFillers: JSON.stringify([...FILLER_SUBJECT_STARTS]),
  junkObjects: JSON.stringify([...ENTITY_STOPWORDS, ...JUNK_OBJECTS]),
  junkAllow: JSON.stringify([...OBJECT_ALLOW]),
})
