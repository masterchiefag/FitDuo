import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// The single highest-leverage guardrail: src/core is pure logic.
// It may import only from within src/core, plus zod (pure validation).
const ALLOWED_BARE_IMPORTS = new Set(['zod'])
const ALLOWED_IN_TESTS = new Set(['vitest', 'fast-check'])
const CORE_DIR = join(__dirname, '..', 'src', 'core')

function tsFilesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return tsFilesUnder(p)
    return p.endsWith('.ts') ? [p] : []
  })
}

describe('core purity', () => {
  it('src/core imports only from src/core (and zod)', () => {
    const violations: string[] = []
    for (const file of tsFilesUnder(CORE_DIR)) {
      const source = readFileSync(file, 'utf8')
      const specifiers = [
        ...source.matchAll(/(?:^|\n)\s*(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]/g),
      ].map((m) => m[1]!)
      const isTest = file.endsWith('.test.ts')
      for (const spec of specifiers) {
        const ok =
          spec.startsWith('.') ||
          ALLOWED_BARE_IMPORTS.has(spec) ||
          (isTest && ALLOWED_IN_TESTS.has(spec))
        if (!ok) violations.push(`${file}: imports '${spec}'`)
      }
    }
    expect(violations).toEqual([])
  })
})
