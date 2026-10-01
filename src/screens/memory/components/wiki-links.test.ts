import { describe, expect, it } from 'vitest'
import {
  lookupWikilink,
  resolveRelativeWikiHref,
  wikilinkKey,
  wikilinkKeyFromHref,
  wikilinksToMarkdown,
} from './wiki-links'

describe('wikilinks', () => {
  it('derives the same key the server resolves', () => {
    expect(wikilinkKey('concepts/Alpha#Intro|the alpha')).toBe('concepts/Alpha')
    expect(wikilinkKey(' Beta ')).toBe('Beta')
  })

  it('rewrites [[target]] and [[target|label]] to #wiki links', () => {
    expect(
      wikilinksToMarkdown('see [[Alpha]] and [[concepts/beta|the beta]]'),
    ).toBe('see [Alpha](#wiki/Alpha) and [the beta](#wiki/concepts%2Fbeta)')
  })

  it('escapes brackets in labels and leaves code untouched', () => {
    expect(wikilinksToMarkdown('[[a|x[1]]')).toBe('[x\\[1](#wiki/a)')
    expect(wikilinksToMarkdown('`[[a]]` and\n```\n[[b]]\n```')).toBe(
      '`[[a]]` and\n```\n[[b]]\n```',
    )
  })

  it('round-trips keys through the href', () => {
    const md = wikilinksToMarkdown('[[Ünïcode page]]')
    const href = /\((#wiki\/[^)]+)\)/.exec(md)![1]
    expect(wikilinkKeyFromHref(href)).toBe('Ünïcode page')
    expect(wikilinkKeyFromHref('https://x.y')).toBeNull()
    expect(wikilinkKeyFromHref('#wiki/%E0')).toBeNull()
  })

  it('encodes parens and skips ~~~ fences', () => {
    expect(wikilinksToMarkdown('[[Foo (bar)]]')).toBe(
      '[Foo (bar)](#wiki/Foo%20%28bar%29)',
    )
    expect(wikilinkKeyFromHref('#wiki/Foo%20%28bar%29')).toBe('Foo (bar)')
    expect(wikilinksToMarkdown('~~~\n[[b]]\n~~~')).toBe('~~~\n[[b]]\n~~~')
  })

  it('resolves relative .md links against the current page dir', () => {
    expect(
      resolveRelativeWikiHref('../entities/x.md#sec', 'concepts/a.md'),
    ).toEqual({ path: 'entities/x.md', hash: 'sec' })
    expect(resolveRelativeWikiHref('y.md', 'concepts/a.md')).toEqual({
      path: 'concepts/y.md',
      hash: '',
    })
    expect(resolveRelativeWikiHref('../../../etc.md', 'a.md')).toEqual({
      path: 'etc.md',
      hash: '',
    })
    expect(resolveRelativeWikiHref('https://x.y/a.md', 'a.md')).toBeNull()
    expect(resolveRelativeWikiHref('#top', 'a.md')).toBeNull()
    expect(resolveRelativeWikiHref('img.png', 'a.md')).toBeNull()
  })

  it('looks up only own properties of the links map', () => {
    const links = { Alpha: 'concepts/alpha.md', Gone: null }
    expect(lookupWikilink(links, 'Alpha')).toBe('concepts/alpha.md')
    expect(lookupWikilink(links, 'Gone')).toBeNull()
    expect(lookupWikilink(links, 'constructor')).toBeNull()
    expect(lookupWikilink(links, '__proto__')).toBeNull()
    expect(lookupWikilink(links, 'toString')).toBeNull()
  })
})
