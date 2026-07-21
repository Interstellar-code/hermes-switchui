// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProposeConfirmDialog } from './propose-confirm-dialog'

afterEach(cleanup)

describe('ProposeConfirmDialog', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <ProposeConfirmDialog
        open={false}
        profile="soul"
        targetRelpath="SOUL.md"
        proposerModel="auto"
        judgeModel="gpt-5.4"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(container.firstChild).toBeNull()
  })

  it('shows profile, target, and model names when open', () => {
    render(
      <ProposeConfirmDialog
        open
        profile="soul"
        targetRelpath="SOUL.md"
        proposerModel="auto"
        judgeModel="gpt-5.4"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText('Propose a change to soul?')).toBeTruthy()
    expect(screen.getByText('SOUL.md')).toBeTruthy()
    expect(screen.getByText('auto')).toBeTruthy()
    expect(screen.getByText('gpt-5.4')).toBeTruthy()
  })

  it('calls onConfirm when Propose is clicked', () => {
    const onConfirm = vi.fn()

    render(
      <ProposeConfirmDialog
        open
        profile="soul"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Propose' }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('calls onCancel when Cancel is clicked', () => {
    const onCancel = vi.fn()

    render(
      <ProposeConfirmDialog
        open
        profile="soul"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('disables confirm and shows pending label while proposing', () => {
    render(
      <ProposeConfirmDialog
        open
        profile="soul"
        pending
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    const proposeButton = screen.getByRole('button', { name: 'Proposing…' })
    expect(proposeButton.hasAttribute('disabled')).toBe(true)
    expect(proposeButton.getAttribute('aria-busy')).toBe('true')
    expect(
      screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled'),
    ).toBe(true)
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
  })

  it('falls back to defaults when model props are null', () => {
    render(
      <ProposeConfirmDialog
        open
        profile="soul"
        targetRelpath={null}
        proposerModel={null}
        judgeModel={null}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByText('the profile target file')).toBeTruthy()
    expect(screen.getByText('auto')).toBeTruthy()
    expect(screen.getByText('the configured judge')).toBeTruthy()
  })
})
