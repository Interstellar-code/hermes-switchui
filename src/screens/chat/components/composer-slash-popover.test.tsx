// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  ComposerSlashPopover,
  filterSlashCommands,
} from './composer-slash-popover'

describe('filterSlashCommands', () => {
  const commands = [
    { command: '/reasoning', description: 'Set reasoning effort' },
    { command: '/reload-skills', description: 'Reload available skills' },
    { command: '/research-stack', description: 'Analyze library dependencies' },
    { command: '/redraw', description: 'Redraw Matrix UI canvas' },
    { command: '/new', description: 'Start a new conversation session' },
  ]

  it('ranks prefix matches before substring matches', () => {
    const results = filterSlashCommands(commands, 're')
    // prefix matches: reasoning, reload-skills, research-stack, redraw
    expect(results[0].command).toBe('/reasoning')
    expect(results[1].command).toBe('/reload-skills')
    expect(results[2].command).toBe('/research-stack')
    expect(results[3].command).toBe('/redraw')
  })

  it('filters based on description substring when command name does not match', () => {
    const results = filterSlashCommands(commands, 'conversation')
    expect(results).toHaveLength(1)
    expect(results[0].command).toBe('/new')
  })

  it('limits results to maxResults', () => {
    const results = filterSlashCommands(commands, '', 3)
    expect(results).toHaveLength(3)
  })
})

describe('ComposerSlashPopover', () => {
  const sampleCommands = [
    { command: '/reasoning', description: 'Set reasoning effort' },
    { command: '/redraw', description: 'Redraw Matrix UI canvas' },
  ]

  it('renders listbox with highlighted active item and keyboard hints in footer', () => {
    const onSelect = vi.fn()
    const onHover = vi.fn()

    render(
      <ComposerSlashPopover
        query="re"
        commands={sampleCommands}
        activeIndex={0}
        onSelect={onSelect}
        onHover={onHover}
      />,
    )

    expect(screen.getByRole('listbox')).toBeDefined()
    expect(screen.getByText('↑↓ navigate · Tab select · Esc close')).toBeDefined()

    const item0 = screen.getByTestId('slash-command-item-0')
    expect(item0.getAttribute('aria-selected')).toBe('true')

    fireEvent.click(item0)
    expect(onSelect).toHaveBeenCalledWith(sampleCommands[0])
  })

  it('renders nothing when commands array is empty', () => {
    const { container } = render(
      <ComposerSlashPopover
        query="xyz"
        commands={[]}
        activeIndex={0}
        onSelect={vi.fn()}
      />,
    )
    expect(container.firstChild).toBeNull()
  })
})
