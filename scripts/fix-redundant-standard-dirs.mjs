// Removes redundant "agents"/"skills"/"commands" arrays from plugin.json
// manifests when they only point at the standard auto-detected directories
// (./agents/, ./skills/, ./commands/). The loader registers those directories
// automatically; declaring them again adds nothing on current FreeCode
// builds and BREAKS the whole plugin on older builds whose manifest schema
// only accepted .md file paths ("agents.0: Invalid string: must end with
// .md" — the bug that made freecode-core's agents invisible).
//
// Usage: node scripts/fix-redundant-standard-dirs.mjs [--dry-run]

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const dryRun = process.argv.includes('--dry-run')
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const manifests = []
const pluginsDir = join(root, 'plugins')
for (const entry of readdirSync(pluginsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const m = join(pluginsDir, entry.name, '.FREECODE-plugin', 'plugin.json')
  if (existsSync(m)) manifests.push(m)
}
const rootManifest = join(root, '.FREECODE-plugin', 'plugin.json')
if (existsSync(rootManifest)) manifests.push(rootManifest)

const STANDARD = { agents: 'agents', skills: 'skills', commands: 'commands' }
const normalize = p =>
  String(p).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')

let changed = 0
for (const file of manifests) {
  const manifest = JSON.parse(readFileSync(file, 'utf8'))
  const removed = []
  for (const [key, dirName] of Object.entries(STANDARD)) {
    const value = manifest[key]
    if (value === undefined) continue
    const entries = Array.isArray(value) ? value : [value]
    if (entries.length > 0 && entries.every(e => normalize(e) === dirName)) {
      delete manifest[key]
      removed.push(key)
    }
  }
  if (removed.length) {
    changed++
    console.log(`${file}: removed redundant ${removed.join(', ')}`)
    if (!dryRun) {
      writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
    }
  }
}
console.log(`${dryRun ? '[dry-run] ' : ''}${changed} manifest(s) updated`)
