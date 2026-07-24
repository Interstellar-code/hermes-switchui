// Files v2 — fuzzy search + match highlighting.
// `fuzzy` and `Highlight` are ported verbatim from the design handoff:
// subsequence match with run/word-boundary bonuses, ranges for <mark> highlighting.

export type FuzzyResult = {
  score: number
  ranges: Array<[number, number]>
}

export function fuzzy(query: string, text: string): FuzzyResult | null {
  if (!query) return { score: 0, ranges: [] }
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let qi = 0
  let score = 0
  const ranges: Array<[number, number]> = []
  let runStart = -1
  let prev = -2
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      if (ti === prev + 1) {
        score += 5
      } else {
        score += 1
      }
      if (ti === 0 || /[/\-_. ]/.test(t[ti - 1])) score += 8 // word-boundary bonus
      if (runStart === -1) runStart = ti
      prev = ti
      qi++
    } else if (runStart !== -1) {
      ranges.push([runStart, prev + 1])
      runStart = -1
    }
  }
  if (runStart !== -1) ranges.push([runStart, prev + 1])
  if (qi < q.length) return null
  score -= (t.length - q.length) * 0.05 // prefer tighter matches
  return { score, ranges }
}

export function Highlight({
  text,
  ranges,
}: {
  text: string
  ranges?: Array<[number, number]> | null
}) {
  if (!ranges || !ranges.length) return <>{text}</>
  const out: Array<React.ReactNode> = []
  let i = 0
  for (const [s, e] of ranges) {
    if (s > i) out.push(<span key={i + 'p'}>{text.slice(i, s)}</span>)
    out.push(<mark key={s}>{text.slice(s, e)}</mark>)
    i = e
  }
  if (i < text.length) out.push(<span key="end">{text.slice(i)}</span>)
  return <>{out}</>
}
