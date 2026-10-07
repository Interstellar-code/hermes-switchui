/**
 * QA1 F3-2 / F1-4 / F4-1 / F4-4 / F4-2 — canvas CSS structure contract.
 *
 * conductor-flow.css used to scope every React Flow rule under
 * [data-screen='conductor'], which only exists on /conductor (and the editor
 * wrapper), so read-only graphs, card previews and cold editor loads
 * rendered unstyled. The styles now live on the canvas root (.flow-host) and
 * load with the canvas module. Handles stay decorative except on the
 * editable canvas. graph-editor.css used dead selectors
 * ([data-screen='conductor'] .wge-canvas-wrap — both classes on the SAME
 * element, so the descendant combinator never matched), which is why handles
 * had computed pointer-events: none in the editor (F4-1) and .dn-errmsg
 * overlapped nodes (F4-6).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8')

/** Strip CSS block comments so prose about dead selectors can't trip checks. */
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

const flowCss = read('src/styles/conductor-flow.css')
const matrixConductorCss = read('src/styles/matrix-conductor.css')
const graphEditorCss = stripComments(read('src/styles/graph-editor.css'))

describe('conductor-flow.css — canvas-root scoping (QA1 F3-2/F1-4/F4-4)', () => {
  it('scopes canvas styles to the .flow-host root so they apply wherever FlowCanvas renders', () => {
    expect(flowCss).toMatch(/^\.flow-host\s*\{/m)
    // The main block is no longer [data-screen]-scoped…
    expect(flowCss).not.toMatch(
      /^\[data-screen='conductor'\]\s*\{\s*\.flow-host/m,
    )
    // …but the header extras (rendered OUTSIDE the canvas) stay conductor-scoped.
    const headerExtras = flowCss.match(/\[data-screen='conductor'\]\s*\{[^]*\}/)
    expect(headerExtras?.[0]).toMatch(/\.flow-legend/)
    expect(headerExtras?.[0]).toMatch(/\.flow-reset/)
  })

  it('carries the node-card base (.dn) inside the canvas scope', () => {
    expect(flowCss).toMatch(/\.flow-host\s*\{[^]*?\n\s+\.dn\s*\{/)

    // …and matrix-conductor.css no longer defines it (it moved).
    expect(matrixConductorCss).not.toMatch(/\.dn\s*\{/)
  })

  it('keeps the light-theme node-ink override reachable from the canvas root', () => {
    expect(flowCss).toMatch(
      /\[data-theme\$='-light'\]\s+\.flow-host\s*\{[^]*?--node-ink/s,
    )
  })
})

describe('editable handles (QA1 F4-1)', () => {
  it('keeps handles decorative by default and connectable only on the editable canvas root', () => {
    // decorative: pointer-events none, nested inside .flow-host
    expect(flowCss).toMatch(
      /\.react-flow__handle\s*\{[^}]*pointer-events:\s*none/s,
    )
    // opt-in: the .editable canvas root re-enables them
    expect(flowCss).toMatch(
      /&\.editable\s+\.react-flow__handle\s*\{[^}]*pointer-events:\s*all/s,
    )
  })

  it('graph-editor.css styles handles via selectors that actually match', () => {
    // The old selectors ([data-screen='conductor'] .wge-canvas-wrap …) could
    // never match — both classes sit on the same element.
    expect(graphEditorCss).not.toContain(
      "[data-screen='conductor'] .wge-canvas-wrap",
    )
    expect(graphEditorCss).toMatch(
      /\.wge-canvas-wrap\s+\.flow-host\.editable\s+\.react-flow__handle\s*\{[^}]*pointer-events:\s*all/s,
    )
  })
})

describe('editor layout (QA1 F4-2)', () => {
  it('wraps the toolbar so SAVE/DISCARD are never covered', () => {
    expect(graphEditorCss).toMatch(/\.wge-etb\s*\{[^}]*flex-wrap:\s*wrap/s)
  })

  it('gives the canvas a usable minimum width and overlays the node panel at ≤1280', () => {
    expect(graphEditorCss).toMatch(
      /\.wge-canvas-wrap\s*\{[^}]*min-width:\s*320px/s,
    )
    expect(graphEditorCss).toMatch(/@media\s*\(max-width:\s*1280px\)/)
    expect(graphEditorCss).toMatch(/\.wge-cfg\s*\{[^}]*position:\s*absolute/s)
  })
})
