// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { Markdown, MARKDOWN_REMARK_PLUGINS } from './markdown'
import { useSessionsFilterStore } from '@/stores/sessions-filter-store'

describe('Markdown plugin pipeline', () => {
  it('wires remark-gfm into the markdown parser pipeline', () => {
    expect(
      MARKDOWN_REMARK_PLUGINS.some((plugin) => plugin.name === 'remarkGfm'),
    ).toBe(true)
  })

  it('wires remark-breaks into the markdown parser pipeline', () => {
    expect(
      MARKDOWN_REMARK_PLUGINS.some((plugin) => plugin.name === 'remarkBreaks'),
    ).toBe(true)
  })
})

describe('GFM Alert Callouts', () => {
  it('renders [!NOTE] callout card with neutral styling and badge', () => {
    const md = `> [!NOTE]\n> This is an important note.`
    const { container } = render(<Markdown>{md}</Markdown>)

    const callout = container.querySelector('[data-callout-type="NOTE"]')
    expect(callout).not.toBeNull()
    expect(callout?.textContent).toContain('NOTE')
    expect(callout?.textContent).toContain('This is an important note.')
    expect(callout?.className).toContain('bg-[var(--theme-card2)]')
  })

  it('renders [!WARNING] callout with warning styling and badge', () => {
    const md = `> [!WARNING]\n> High voltage area.`
    const { container } = render(<Markdown>{md}</Markdown>)

    const callout = container.querySelector('[data-callout-type="WARNING"]')
    expect(callout).not.toBeNull()
    expect(callout?.textContent).toContain('WARNING')
    expect(callout?.textContent).toContain('High voltage area.')
    expect(callout?.className).toContain('border-[var(--theme-warning,#d97706)]')
  })

  it('renders [!DECISION] callout with accent styling and badge', () => {
    const md = `> [!DECISION]\n> Adopted SQLite architecture.`
    const { container } = render(<Markdown>{md}</Markdown>)

    const callout = container.querySelector('[data-callout-type="DECISION"]')
    expect(callout).not.toBeNull()
    expect(callout?.textContent).toContain('DECISION')
    expect(callout?.textContent).toContain('Adopted SQLite architecture.')
    expect(callout?.className).toContain('border-[var(--theme-accent)]')
  })

  it('renders [!RECOMMENDATION] callout with accent styling and badge', () => {
    const md = `> [!RECOMMENDATION]\n> Use pnpm over npm.`
    const { container } = render(<Markdown>{md}</Markdown>)

    const callout = container.querySelector('[data-callout-type="RECOMMENDATION"]')
    expect(callout).not.toBeNull()
    expect(callout?.textContent).toContain('RECOMMENDATION')
    expect(callout?.textContent).toContain('Use pnpm over npm.')
    expect(callout?.className).toContain('border-[var(--theme-accent)]')
  })

  it('renders [!TIP] callout with tip styling and badge', () => {
    const md = `> [!TIP]\n> Use Cmd+K to search.`
    const { container } = render(<Markdown>{md}</Markdown>)

    const callout = container.querySelector('[data-callout-type="TIP"]')
    expect(callout).not.toBeNull()
    expect(callout?.textContent).toContain('TIP')
    expect(callout?.textContent).toContain('Use Cmd+K to search.')
  })

  it('renders [!CAUTION] callout with danger styling and badge', () => {
    const md = `> [!CAUTION]\n> Action cannot be undone.`
    const { container } = render(<Markdown>{md}</Markdown>)

    const callout = container.querySelector('[data-callout-type="CAUTION"]')
    expect(callout).not.toBeNull()
    expect(callout?.textContent).toContain('CAUTION')
    expect(callout?.textContent).toContain('Action cannot be undone.')
    expect(callout?.className).toContain('border-[var(--theme-danger,#ef4444)]')
  })

  it('renders standard blockquotes normally when no alert tag is present', () => {
    const md = `> This is a traditional quotation.`
    const { container } = render(<Markdown>{md}</Markdown>)

    expect(container.querySelector('[data-callout-type]')).toBeNull()
    const blockquote = container.querySelector('blockquote')
    expect(blockquote).not.toBeNull()
    expect(blockquote?.textContent).toContain('This is a traditional quotation.')
  })
})

describe('Clickable File Chips', () => {
  it('renders a clickable file chip for paths with common code extensions', () => {
    const md = 'Check out `src/components/prompt-kit/markdown.tsx` for details.'
    const { container } = render(<Markdown>{md}</Markdown>)

    const chip = container.querySelector('[data-testid="file-chip"]')
    expect(chip).not.toBeNull()
    expect(chip?.getAttribute('data-path')).toBe('src/components/prompt-kit/markdown.tsx')
    expect(chip?.getAttribute('href')).toBe('/files?path=src%2Fcomponents%2Fprompt-kit%2Fmarkdown.tsx')
    expect(chip?.querySelector('svg')).not.toBeNull()
  })

  it('renders a file chip for paths starting with ~/ or ./', () => {
    const md = 'Run `./scripts/build.sh` or inspect `~/.hermes/config.yaml`.'
    const { container } = render(<Markdown>{md}</Markdown>)

    const chips = container.querySelectorAll('[data-testid="file-chip"]')
    expect(chips.length).toBe(2)
    expect(chips[0].getAttribute('data-path')).toBe('./scripts/build.sh')
    expect(chips[1].getAttribute('data-path')).toBe('.hermes/config.yaml')
  })

  it('renders FileText icon for document and markdown extensions', () => {
    const md = 'Read `README.md` first.'
    const { container } = render(<Markdown>{md}</Markdown>)

    const chip = container.querySelector('[data-testid="file-chip"]')
    expect(chip).not.toBeNull()
    expect(chip?.getAttribute('data-path')).toBe('README.md')
  })

  it('keeps ordinary inline code unchipped', () => {
    const md = 'Use `const answer = 42;` in your code.'
    const { container } = render(<Markdown>{md}</Markdown>)

    expect(container.querySelector('[data-testid="file-chip"]')).toBeNull()
    const code = container.querySelector('code')
    expect(code).not.toBeNull()
    expect(code?.textContent).toBe('const answer = 42;')
  })

  it('dispatches hermes:open-file and switches sidebar to files on chip click', () => {
    const setCollapsedSpy = vi.spyOn(useSessionsFilterStore.getState(), 'setCollapsed')
    const setLeftPanelSpy = vi.spyOn(useSessionsFilterStore.getState(), 'setLeftPanel')
    const eventHandler = vi.fn()
    window.addEventListener('hermes:open-file', eventHandler)

    const md = 'Open `src/index.ts` now.'
    const { container } = render(<Markdown>{md}</Markdown>)

    const chip = container.querySelector('[data-testid="file-chip"]')
    expect(chip).not.toBeNull()
    fireEvent.click(chip!)

    expect(setCollapsedSpy).toHaveBeenCalledWith(false)
    expect(setLeftPanelSpy).toHaveBeenCalledWith('files')
    expect(eventHandler).toHaveBeenCalled()
    expect(eventHandler.mock.calls[0][0].detail).toEqual({ path: 'src/index.ts' })

    window.removeEventListener('hermes:open-file', eventHandler)
  })
})

describe('Zebra Comparison Tables', () => {
  it('renders tables with mono headers, zebra striping, numeric alignment, and verdict badges', () => {
    const md = `
| Option | Latency | Verdict |
|---|---|---|
| Engine A | 12ms | PICK |
| Engine B | 120ms | NO |
| Engine C | 45ms | YES |
`
    const { container } = render(<Markdown>{md}</Markdown>)

    // Headers with mono styling
    const ths = container.querySelectorAll('th')
    expect(ths.length).toBe(3)
    ths.forEach((th) => {
      expect(th.className).toContain('font-mono')
    })

    // Zebra striping classes on rows
    const trs = container.querySelectorAll('tbody tr')
    expect(trs.length).toBe(3)
    expect(trs[0].className).toContain('odd:bg-[var(--theme-card)]')
    expect(trs[0].className).toContain('even:bg-[var(--theme-card2)]')

    // Numeric alignment on 12ms, 120ms, 45ms
    const numericCells = Array.from(container.querySelectorAll('td')).filter((td) =>
      /^\d+ms$/.test(td.textContent?.trim() || ''),
    )
    expect(numericCells.length).toBe(3)
    numericCells.forEach((td) => {
      expect(td.className).toContain('text-right')
      expect(td.className).toContain('font-mono')
      expect(td.className).toContain('tabular-nums')
    })

    // Verdict badges for PICK, NO, YES
    const pickBadge = container.querySelector('[data-verdict="PICK"]')
    expect(pickBadge).not.toBeNull()
    expect(pickBadge?.className).toContain('border-[var(--theme-accent)]')

    const noBadge = container.querySelector('[data-verdict="NO"]')
    expect(noBadge).not.toBeNull()
    expect(noBadge?.className).toContain('border-[color-mix(in_srgb,var(--theme-danger,#ef4444)')

    const yesBadge = container.querySelector('[data-verdict="YES"]')
    expect(yesBadge).not.toBeNull()
    expect(yesBadge?.className).toContain('border-[color-mix(in_srgb,var(--theme-success,#22c55e)')
  })
})
