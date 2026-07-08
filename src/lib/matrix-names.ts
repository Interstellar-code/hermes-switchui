export const MATRIX_NAMES: Array<string> = [
  'neo',
  'trinity',
  'morpheus',
  'cypher',
  'tank',
  'dozer',
  'switch',
  'apoc',
  'mouse',
  'niobe',
  'ghost',
  'link',
  'seraph',
  'oracle',
  'smith',
  'sentinel',
  'keymaker',
  'merovingian',
  'persephone',
  'trainman',
  'sati',
  'zee',
  'kid',
  'lock',
  'roland',
  'ballard',
  'soren',
  'bane',
  'rama',
  'sparks',
  'axel',
  'colt',
  'vector',
  'maggie',
  'cas',
  'ice',
  'kali',
]

export function randomMatrixName(exclude: Array<string> = []): string {
  const lower = exclude.map((n) => n.toLowerCase())
  const available = MATRIX_NAMES.filter((n) => !lower.includes(n))

  if (available.length > 0) {
    return available[Math.floor(Math.random() * available.length)]
  }

  // All base names are taken — append a numeric suffix
  const base = MATRIX_NAMES[Math.floor(Math.random() * MATRIX_NAMES.length)]
  let suffix = 2
  while (lower.includes(`${base}-${suffix}`) && suffix < 1000) {
    suffix++
  }
  return `${base}-${suffix}`
}
