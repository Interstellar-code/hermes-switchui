import type { KeyMeta } from '../lib/key-meta-types'

/**
 * Which control kind a setting key should render as, derived from its
 * `KeyMeta`. Pure mapping — no React — so sections (P4B) and any future
 * consumer (search results, health fixes) agree on one answer.
 *
 *  - bool    → toggle
 *  - int/float → slider when `range.min` AND `range.max` both exist (the
 *    bounds a slider needs), otherwise a plain number input. A range whose
 *    upper bound is the `unlimited` sentinel (null/0) still counts as
 *    bounded here — the ∞ escape hatch is a separate toggle (P2B), not a
 *    reason to lose the slider.
 *  - enum    → select
 *  - string  → text
 *  - secret  → password
 *  - list/map → raw (JSON textarea etc.; no typed control yet)
 */
export type ControlKind =
  | 'toggle'
  | 'number'
  | 'slider'
  | 'select'
  | 'text'
  | 'password'
  | 'raw'

export function controlFor(meta: KeyMeta): ControlKind {
  switch (meta.type) {
    case 'bool':
      return 'toggle'
    case 'int':
    case 'float': {
      const { range } = meta
      if (range && range.min != null && range.max != null) return 'slider'
      return 'number'
    }
    case 'enum':
      return 'select'
    case 'string':
      return 'text'
    case 'secret':
      return 'password'
    case 'list':
    case 'map':
      return 'raw'
  }
}
