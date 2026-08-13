// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { GoalProgressCard, GoalProgressList } from './goal-progress-card'
import type { GoalProgressEntry } from '@/stores/goal-progress-store'
import { useGoalProgressStore } from '@/stores/goal-progress-store'

afterEach(() => {
  cleanup()
  useGoalProgressStore.setState({ bySession: {} })
})

function entry(overrides: Partial<GoalProgressEntry> = {}): GoalProgressEntry {
  return {
    id: 'g1',
    message: '↻ Continuing toward goal (1/3): the count has not started.',
    status: 'active',
    verdict: 'continue',
    shouldContinue: true,
    capped: false,
    turnsUsed: 1,
    maxTurns: 3,
    createdAt: 1,
    ...overrides,
  }
}

describe('GoalProgressCard', () => {
  it('shows the whole verdict trail, oldest first', () => {
    // The sequence is the information: which turn the judge let through, and
    // what it said each time. One line would lose "why are we on turn 3".
    render(
      <GoalProgressCard
        entries={[
          entry(),
          entry({ id: 'g2', message: '↻ Continuing toward goal (2/3): 2 sent.', turnsUsed: 2 }),
        ]}
      />,
    )
    const lines = screen.getAllByTestId('goal-progress-line')
    expect(lines).toHaveLength(2)
    expect(lines[0].textContent).toMatch(/\(1\/3\)/)
    expect(lines[1].textContent).toMatch(/\(2\/3\)/)
  })

  it('headlines the turn counter, because that is the budget decision', () => {
    render(<GoalProgressCard entries={[entry({ turnsUsed: 2, maxTurns: 20 })]} />)
    const card = screen.getByTestId('goal-progress-card')
    expect(card.getAttribute('data-goal-turns')).toBe('2/20')
    expect(card.textContent).toContain('2/20 turns')
  })

  it('separates achieved from merely stopped', () => {
    const { rerender } = render(
      <GoalProgressCard
        entries={[
          entry({ status: 'done', shouldContinue: false, message: '✓ Goal achieved.' }),
        ]}
      />,
    )
    expect(screen.getByTestId('goal-progress-card').textContent).toContain(
      'Goal achieved',
    )
    // A budget-exhausted run is neither success nor failure, and the goal is
    // still set — the card has to say what to do next.
    rerender(
      <GoalProgressCard
        entries={[
          entry({
            status: 'paused',
            shouldContinue: false,
            turnsUsed: 3,
            message: '⏸ Goal paused — 3/3 turns used.',
          }),
        ]}
      />,
    )
    const card = screen.getByTestId('goal-progress-card')
    expect(card.textContent).toContain('Goal stopped')
    expect(card.textContent).toMatch(/\/goal resume/)
    expect(card.textContent).toMatch(/\/goal clear/)
  })

  it('names the per-request cap as its own outcome', () => {
    // MAX_GOAL_CONTINUATIONS_PER_REQUEST stopping the run looks identical to a
    // judge verdict unless the card says otherwise, and the remedy differs:
    // send another turn rather than resume.
    render(
      <GoalProgressCard
        entries={[
          entry({
            shouldContinue: false,
            capped: true,
            message: '⏹ Goal continuation stopped after 10 turns on this request.',
          }),
        ]}
      />,
    )
    expect(screen.getByTestId('goal-progress-card').textContent).toContain(
      'request limit',
    )
  })
})

describe('GoalProgressList', () => {
  it('renders nothing for a session with no goal running', () => {
    // Which is every session by default — the events never fire without a goal.
    const { container } = render(<GoalProgressList sessionKey="sess-a" />)
    expect(container.firstChild).toBeNull()
  })

  it('is per session, and dismissable', () => {
    useGoalProgressStore.getState().addGoalStatus('sess-a', {
      message: '↻ Continuing toward goal (1/20): still going.',
      status: 'active',
      shouldContinue: true,
      capped: false,
      turnsUsed: 1,
      maxTurns: 20,
    })
    const other = render(<GoalProgressList sessionKey="sess-b" />)
    expect(other.container.firstChild).toBeNull()
    other.unmount()

    render(<GoalProgressList sessionKey="sess-a" />)
    expect(screen.getByTestId('goal-progress-card')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Dismiss goal progress'))
    expect(screen.queryByTestId('goal-progress-card')).toBeNull()
  })

  it('collapses a re-delivered verdict instead of showing it as a second turn', () => {
    const add = useGoalProgressStore.getState().addGoalStatus
    const line = {
      message: '↻ Continuing toward goal (1/20): still going.',
      status: 'active',
      shouldContinue: true,
      capped: false,
      turnsUsed: 1,
      maxTurns: 20,
      runId: 'run_1',
    }
    add('sess-a', line)
    add('sess-a', line)
    expect(useGoalProgressStore.getState().bySession['sess-a']).toHaveLength(1)
  })
})
