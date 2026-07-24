import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('router route generation invalidation', () => {
  it('does not tell Vite to ignore the generated TanStack route tree', () => {
    const viteConfig = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8')

    expect(viteConfig).not.toContain("'**/routeTree.gen.ts'")
    expect(viteConfig).not.toContain('"**/routeTree.gen.ts"')
  })

  it('forwards POST requests after the legacy workspace-daemon cleanup', () => {
    const viteConfig = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8')
    const middleware = viteConfig.match(
      /server\.middlewares\.use\(async \(req, res, next\) => \{([\s\S]*?)\n          \}\)/,
    )?.[1]

    expect(middleware).toContain('next()')
    expect(middleware).not.toContain("req.method !== 'POST'")
  })
})
