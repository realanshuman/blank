import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Vercel validates vercel.json against a strict schema and rejects unknown
 * properties outright — the deploy fails before it starts. JSON has no comment
 * syntax, so a `"//"` key looks harmless and parses fine, then breaks the
 * import. These tests encode the allowed shape so that cannot happen twice.
 */
// A plain path, not import.meta.url: under the happy-dom test environment that
// is not a file: URL and readFileSync rejects it.
const config = JSON.parse(
  readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8'),
) as Record<string, unknown>

const TOP_LEVEL = new Set([
  '$schema', 'buildCommand', 'cleanUrls', 'crons', 'devCommand', 'framework',
  'functions', 'git', 'headers', 'images', 'installCommand', 'outputDirectory',
  'public', 'redirects', 'regions', 'rewrites', 'trailingSlash',
])
const REWRITE_KEYS = new Set(['source', 'destination', 'has', 'missing'])
const HEADER_RULE_KEYS = new Set(['source', 'headers', 'has', 'missing'])
const HEADER_KEYS = new Set(['key', 'value'])

describe('vercel.json', () => {
  it('uses only recognised top-level keys', () => {
    for (const key of Object.keys(config)) {
      expect(TOP_LEVEL.has(key), `unexpected top-level key "${key}"`).toBe(true)
    }
  })

  it('has no comment keys anywhere — Vercel rejects them', () => {
    const walk = (node: unknown, path: string): void => {
      if (Array.isArray(node)) {
        node.forEach((item, i) => walk(item, `${path}[${i}]`))
      } else if (node && typeof node === 'object') {
        for (const [key, value] of Object.entries(node)) {
          expect(key.startsWith('//'), `comment key at ${path}.${key}`).toBe(false)
          walk(value, `${path}.${key}`)
        }
      }
    }
    walk(config, 'root')
  })

  it('rewrites carry only source/destination', () => {
    const rewrites = config['rewrites'] as Array<Record<string, unknown>>
    expect(Array.isArray(rewrites)).toBe(true)
    for (const [i, rule] of rewrites.entries()) {
      for (const key of Object.keys(rule)) {
        expect(REWRITE_KEYS.has(key), `rewrites[${i}] has unexpected "${key}"`).toBe(true)
      }
      expect(typeof rule['source']).toBe('string')
      expect(typeof rule['destination']).toBe('string')
    }
  })

  it('header rules are well formed', () => {
    const rules = config['headers'] as Array<Record<string, unknown>>
    for (const [i, rule] of rules.entries()) {
      for (const key of Object.keys(rule)) {
        expect(HEADER_RULE_KEYS.has(key), `headers[${i}] has unexpected "${key}"`).toBe(true)
      }
      for (const header of rule['headers'] as Array<Record<string, unknown>>) {
        for (const key of Object.keys(header)) {
          expect(HEADER_KEYS.has(key), `header entry has unexpected "${key}"`).toBe(true)
        }
      }
    }
  })

  it('routes /app to the app page so the landing page does not swallow it', () => {
    const rewrites = config['rewrites'] as Array<Record<string, string>>
    const appRule = rewrites.find((rule) => rule['source'] === '/app')
    expect(appRule?.['destination']).toBe('/app.html')
  })

  it('builds the same way the repo does', () => {
    expect(config['buildCommand']).toBe('npm run build')
    expect(config['outputDirectory']).toBe('dist')
  })
})
