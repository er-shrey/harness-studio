import yaml from 'js-yaml'
import { CATALOG } from './connectors'
import type { Attachment, Connector, FlowEdge, Project, SkillData, SkillNode } from './types'

/** A text file from the picked folder, with a '/'-separated path relative to that folder. */
export type InFile = { path: string; content: string }

export type ImportResult = { project: Project; notes: string[] }

// ---------- small helpers ----------

const dirname = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1)
const stripExt = (p: string) => p.replace(/\.[^./]+$/, '')
const join = (...parts: string[]) => parts.filter(Boolean).join('/')
const depth = (p: string) => p.split('/').length
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const titleCase = (s: string) => s.replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

/** Normalise "a/./b/../c" style paths so links resolve against the file set. */
function normalise(p: string): string {
  const out: string[] = []
  for (const part of p.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out.join('/')
}

type Frontmatter = Record<string, unknown>

export function parseFrontmatter(text: string): { meta: Frontmatter; body: string } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!m) return { meta: {}, body: text }
  const body = text.slice(m[0].length)
  try {
    const meta = yaml.load(m[1])
    if (meta && typeof meta === 'object') return { meta: meta as Frontmatter, body }
  } catch {
    /* fall through to the line parser: hand-written frontmatter is often not strict YAML */
  }
  const meta: Frontmatter = {}
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z_-]+):\s*(.*)$/)
    if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, '')
  }
  return { meta, body }
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : Array.isArray(v) ? v.join(', ') : '')
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()

/** Strip markdown noise from a line so it reads as a sentence. */
const plain = (line: string) =>
  oneLine(
    line
      .replace(/^\s*(?:[-*>]|\d+[.)])\s+/, '')
      .replace(/[*_`]/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'),
  )

// ---------- connectors ----------

const UUIDISH = /^[0-9a-f]{8}-[0-9a-f]{4}-/i

/** Read mcpServers from .mcp.json text into Connector records. */
function connectorsFromMcpJson(text: string): Connector[] {
  try {
    const json = JSON.parse(text) as { mcpServers?: Record<string, Record<string, unknown>> }
    return Object.entries(json.mcpServers ?? {}).map(([id, cfg]) => {
      const known = CATALOG.find((c) => c.template.id === id)?.template
      const type = cfg.type as string | undefined
      if (cfg.command || type === 'stdio')
        return {
          id,
          label: known?.label ?? titleCase(id),
          transport: 'stdio',
          command: String(cfg.command ?? ''),
          args: (cfg.args as string[] | undefined) ?? undefined,
          env: (cfg.env as Record<string, string> | undefined) ?? undefined,
        } satisfies Connector
      return {
        id,
        label: known?.label ?? titleCase(id),
        transport: type === 'sse' ? 'sse' : 'http',
        url: String(cfg.url ?? ''),
        headers: (cfg.headers as Record<string, string> | undefined) ?? undefined,
      } satisfies Connector
    })
  } catch {
    return []
  }
}

function connectorsFromYaml(text: string): Connector[] {
  try {
    const doc = yaml.load(text) as { connectors?: Record<string, Omit<Connector, 'id'>> }
    return Object.entries(doc?.connectors ?? {}).map(([id, c]) => ({ ...c, id, label: c.label ?? id }))
  } catch {
    return []
  }
}

/** All mcp__server__tool references in a text, grouped by server key. */
function mcpToolRefs(text: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const m of text.matchAll(/mcp__([A-Za-z0-9-]+(?:_[A-Za-z0-9-]+)*?)__([A-Za-z0-9_-]+)/g)) {
    if (!out.has(m[1])) out.set(m[1], new Set())
    out.get(m[1])!.add(m[2])
  }
  return out
}

/**
 * A connector referenced by tool name but not defined in the folder. Servers added through
 * claude.ai have opaque ids, so the label is guessed from the tool names it exposes.
 */
function guessConnector(id: string, tools: Set<string>): Connector {
  const known = CATALOG.find((c) => c.template.id === id.toLowerCase())?.template
  if (known) return { ...known, id }
  const toolText = [...tools].join(' ').toLowerCase()
  const match = CATALOG.find((c) => c.keywords.some((k) => toolText.includes(k.replace(/\s+/g, ''))))
  const short = UUIDISH.test(id) ? id.slice(0, 8) : ''
  const label = match ? `${match.template.label}${short ? ` (${short})` : ''}` : short ? `MCP ${short}` : titleCase(id)
  return {
    id,
    label,
    transport: 'stdio',
    command: `<${match?.template.id ?? 'mcp'}-server-command>`,
    notes: `Found from tool references (${[...tools].slice(0, 4).join(', ')}${tools.size > 4 ? '…' : ''}); not defined in the imported folder.${
      short ? ' An id like this usually means a connector added in claude.ai, which needs no local config.' : ''
    }`,
  }
}

// ---------- units: the things that become nodes ----------

type Unit = {
  id: string
  origin: NonNullable<SkillData['origin']>
  name: string
  description: string
  body: string
  /** Extra text searched for mcp tool references (e.g. an agent's tools: line). */
  toolsText: string
  path: string
  /** Folder whose other files belong to this unit (skills only). */
  ownDir?: string
}

const MAX_ATTACHMENT = 200_000

/** Files a unit links to: markdown links, $CLAUDE_PLUGIN_ROOT/… paths and backticked relative paths. */
function linkedFiles(unit: Unit, root: string, byPath: Map<string, InFile>): string[] {
  const found = new Set<string>()
  const here = dirname(unit.path)
  const tryAdd = (raw: string, base: string) => {
    const clean = raw.replace(/[#?].*$/, '').replace(/[),.;:]+$/, '')
    if (!clean || /^[a-z]+:\/\//i.test(clean)) return
    const p = normalise(join(base, clean))
    if (byPath.has(p) && p !== unit.path) found.add(p)
  }
  for (const m of unit.body.matchAll(/\]\(([^)\s]+)\)/g)) tryAdd(m[1], here)
  for (const m of unit.body.matchAll(/\$\{?CLAUDE_PLUGIN_ROOT\}?\/([^\s`'")\]]+)/g)) tryAdd(m[1], root)
  for (const m of unit.body.matchAll(/`([\w./-]+\.[a-z]{1,8})`/gi)) {
    tryAdd(m[1], here)
    tryAdd(m[1], root)
  }
  return [...found]
}

/** Every name a unit might be called by in another file's text. */
function aliases(u: Unit, plugin: string): RegExp[] {
  const n = escapeRe(u.name)
  const b = `(?<![\\w-])`
  const e = `(?![\\w-])`
  const scoped = plugin ? `(?:${escapeRe(plugin)}:)?` : ''
  const list = [
    new RegExp(`${b}/${scoped}${n}${e}`), // slash command: /plugin:name or /name
    new RegExp(`subagent_type["'\\s:=]+${scoped}${n}${e}`),
    new RegExp(`(?:skills|agents|commands)/${n}(?:/SKILL)?(?:\\.md)?${e}`),
  ]
  if (plugin) list.push(new RegExp(`${b}${escapeRe(plugin)}:${n}${e}`))
  // Bare `name` in backticks or "name agent/skill" only when the name is distinctive enough.
  if (/[-_]/.test(u.name) || u.name.length > 12) {
    list.push(new RegExp('`' + n + '`'))
    list.push(new RegExp(`${b}${n}\\s+(?:agent|skill|subagent|command)`, 'i'))
  }
  return list
}

const CONDITIONAL = /^(if|when|whenever|only|unless|once|after|before|on)\b/i

function findLinks(units: Unit[], plugin: string): FlowEdge[] {
  const edges: FlowEdge[] = []
  const patterns = new Map(units.map((u) => [u.id, aliases(u, plugin)]))
  for (const src of units) {
    const lines = src.body.split('\n')
    for (const dst of units) {
      if (dst.id === src.id) continue
      const res = patterns.get(dst.id)!
      const line = lines.find((l) => res.some((r) => r.test(l)))
      if (!line) continue
      const sentence = plain(line).slice(0, 160)
      const conditional = CONDITIONAL.test(sentence)
      edges.push({
        id: `e-${src.id}-${dst.id}`,
        source: src.id,
        target: dst.id,
        type: 'condition',
        // Conditions are shown as "if …", so drop a leading "If" rather than doubling it.
        data: conditional
          ? { condition: sentence.replace(/^if\s+/i, ''), note: sentence }
          : { condition: '', kind: 'ref', note: sentence },
      })
    }
  }
  return edges
}

// ---------- layout ----------

const COL = 340
const ROW = 150
/** Columns per band: longer flows wrap onto a new band below, like lines of text. */
const MAX_COLS = 5

/**
 * Left-to-right layered layout: each node sits one column after its deepest predecessor
 * (back edges in cycles are ignored), rows are ordered by the average row of their
 * predecessors to cut crossings, and unlinked nodes go in a grid underneath.
 */
export function layout(nodes: SkillNode[], edges: FlowEdge[]): SkillNode[] {
  const ids = nodes.map((n) => n.id)
  const out = new Map(ids.map((id) => [id, [] as string[]]))
  const inc = new Map(ids.map((id) => [id, [] as string[]]))
  for (const e of edges) {
    if (!out.has(e.source) || !out.has(e.target)) continue
    out.get(e.source)!.push(e.target)
    inc.get(e.target)!.push(e.source)
  }

  // DFS to find back edges so cycles don't push layers forever.
  const back = new Set<string>()
  const state = new Map<string, 1 | 2>()
  const visit = (id: string) => {
    state.set(id, 1)
    for (const t of out.get(id)!) {
      if (state.get(t) === 1) back.add(`${id}>${t}`)
      else if (!state.has(t)) visit(t)
    }
    state.set(id, 2)
  }
  for (const id of ids) if (!inc.get(id)!.length && !state.has(id)) visit(id)
  for (const id of ids) if (!state.has(id)) visit(id)

  const layer = new Map<string, number>()
  const layerOf = (id: string, seen = new Set<string>()): number => {
    if (layer.has(id)) return layer.get(id)!
    if (seen.has(id)) return 0
    seen.add(id)
    const preds = inc.get(id)!.filter((p) => !back.has(`${p}>${id}`))
    const l = preds.length ? Math.max(...preds.map((p) => layerOf(p, seen))) + 1 : 0
    layer.set(id, l)
    return l
  }

  const linked = ids.filter((id) => out.get(id)!.length || inc.get(id)!.length)
  const lonely = ids.filter((id) => !linked.includes(id))
  for (const id of linked) layerOf(id)

  const columns: string[][] = []
  for (const id of linked) (columns[layer.get(id)!] ??= []).push(id)
  const row = new Map<string, number>()
  columns.forEach((col) => {
    const score = (id: string) => {
      const ps = inc.get(id)!.filter((p) => row.has(p))
      return ps.length ? ps.reduce((a, p) => a + row.get(p)!, 0) / ps.length : Infinity
    }
    col.sort((a, b) => score(a) - score(b))
    col.forEach((id, i) => row.set(id, i))
  })

  const pos = new Map<string, { x: number; y: number }>()
  const tallest = Math.max(0, ...columns.map((c) => c?.length ?? 0))
  const bandHeight = (tallest + 0.8) * ROW
  const bands = Math.ceil(columns.length / MAX_COLS)
  columns.forEach((col, x) =>
    col.forEach((id, y) =>
      pos.set(id, {
        x: (x % MAX_COLS) * COL,
        y: Math.floor(x / MAX_COLS) * bandHeight + (y + (tallest - col.length) / 2) * ROW,
      }),
    ),
  )
  const perRow = Math.max(4, Math.min(columns.length, MAX_COLS))
  const lonelyTop = bands ? bands * bandHeight - 0.2 * ROW : 0
  lonely.forEach((id, i) => pos.set(id, { x: (i % perRow) * COL, y: lonelyTop + Math.floor(i / perRow) * ROW }))

  return nodes.map((n) => ({ ...n, position: pos.get(n.id) ?? n.position }))
}

// ---------- the exported-SKILL.md format (round trip without harness.json) ----------

const STEP_HEAD = /^### Step (\d+): (.+)$/gm

function isExportedSkill(body: string) {
  return /^## Steps$/m.test(body) && /^### Step \d+: /m.test(body)
}

function fromExportedSkill(skillPath: string, text: string, byPath: Map<string, InFile>, connectors: Connector[]): Project {
  const { meta, body } = parseFrontmatter(text)
  const root = dirname(skillPath)
  const title = body.match(/^# (.+)$/m)?.[1]?.trim() ?? str(meta.name)
  const heads = [...body.matchAll(STEP_HEAD)]
  const byLabel = new Map(connectors.map((c) => [c.label, c.id]))
  const nodes: SkillNode[] = []
  const pending: { from: string; to: number; condition: string; ref?: boolean }[] = []

  heads.forEach((h, i) => {
    const start = h.index! + h[0].length
    const section = body.slice(start, heads[i + 1]?.index ?? body.length).trim()
    const id = `s-${h[1]}`
    let rest = section
    let description = ''
    const desc = rest.match(/^\*([^*\n][^\n]*)\*\s*\n/)
    if (desc) {
      description = desc[1].trim()
      rest = rest.slice(desc[0].length).trim()
    }
    const cut = rest.search(/^\*\*(References for this step|Connectors|Uses|Next):\*\*/m)
    const instructions = (cut >= 0 ? rest.slice(0, cut) : rest).trim().replace(/^_No instructions written yet\._$/, '')
    const tail = cut >= 0 ? rest.slice(cut) : ''

    const attachments: Attachment[] = []
    const refBlock = tail.match(/\*\*References for this step:\*\*([\s\S]*?)(?=\n\*\*|$)/)?.[1] ?? ''
    for (const m of refBlock.matchAll(/\]\(([^)]+)\)/g)) {
      const f = byPath.get(normalise(join(root, m[1])))
      if (f) attachments.push({ id: `a-${id}-${attachments.length}`, name: basename(f.path), content: f.content })
    }
    const connLine = tail.match(/^\*\*Connectors:\*\* (.+)$/m)?.[1] ?? ''
    const connectorIds = connLine
      .split(',')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => byLabel.get(l) ?? l)

    const uses = tail.match(/\*\*Uses:\*\*([\s\S]*?)(?=\n\*\*|$)/)?.[1] ?? ''
    for (const m of uses.matchAll(/^- Step (\d+)/gm)) pending.push({ from: id, to: Number(m[1]), condition: '', ref: true })
    const next = tail.match(/\*\*Next:\*\*([\s\S]*)$/)?.[1] ?? ''
    for (const m of next.matchAll(/^- (?:If (.+?)|\*Always\*) → Step (\d+)/gm))
      pending.push({ from: id, to: Number(m[2]), condition: m[1]?.trim() ?? '' })

    nodes.push({
      id,
      type: 'skill',
      position: { x: 0, y: 0 },
      data: { name: h[2].trim(), description, instructions, attachments, connectorIds, origin: 'step', sourcePath: skillPath },
    })
  })

  const edges: FlowEdge[] = pending
    .filter((p) => nodes.some((n) => n.id === `s-${p.to}`))
    .map((p, i) => ({
      id: `e-${i + 1}`,
      source: p.from,
      target: `s-${p.to}`,
      type: 'condition',
      data: p.ref ? { condition: '', kind: 'ref' } : { condition: p.condition },
    }))

  // Exported steps were never tagged by origin, so drop the tag to keep the round trip exact.
  for (const n of nodes) delete n.data.origin
  const usedIds = new Set(nodes.flatMap((n) => n.data.connectorIds))
  return {
    version: 1,
    name: title || 'Imported harness',
    description: str(meta.description),
    nodes: layout(nodes, edges),
    edges,
    connectors: Object.fromEntries(connectors.filter((c) => usedIds.has(c.id)).map((c) => [c.id, c])),
  }
}

// ---------- numbered sections in a single hand-written file ----------

const NUMBERED_H2 = /^##\s+(?:Step\s+|Stage\s+|Phase\s+)?(\d+)\s*(?:[.:)·—–-]\s*)?(.+)$/gim

function splitSteps(unit: Unit): Unit[] | null {
  const heads = [...unit.body.matchAll(NUMBERED_H2)]
  if (heads.length < 2) return null
  const intro = unit.body.slice(0, heads[0].index).trim()
  return heads.map((h, i) => ({
    ...unit,
    id: `${unit.id}-${i + 1}`,
    origin: 'step' as const,
    name: `${h[1]}. ${h[2].trim()}`,
    description: i === 0 ? unit.description : '',
    body: (i === 0 && intro ? intro + '\n\n' : '') + unit.body.slice(h.index! + h[0].length, heads[i + 1]?.index).trim(),
  }))
}

// ---------- entry point ----------

export function importFiles(all: InFile[], folderName: string): ImportResult {
  const notes: string[] = []
  const files = all.map((f) => ({ ...f, path: normalise(f.path) }))
  const byPath = new Map(files.map((f) => [f.path, f]))
  const shallowest = (pred: (p: string) => boolean) =>
    files.filter((f) => pred(f.path)).sort((a, b) => depth(a.path) - depth(b.path))[0]

  // 1. Our own bundle: harness.json is the lossless source.
  const harness = shallowest((p) => basename(p) === 'harness.json')
  if (harness) {
    try {
      const p = JSON.parse(harness.content) as Project
      if (p.version === 1 && Array.isArray(p.nodes) && Array.isArray(p.edges)) {
        notes.push(`Loaded ${harness.path}, the graph saved by Harness Studio.`)
        return { project: p, notes }
      }
    } catch {
      notes.push(`${harness.path} could not be read, so the graph was rebuilt from the Markdown files.`)
    }
  }

  // Connectors defined in the folder.
  const defined = new Map<string, Connector>()
  for (const f of files) {
    if (basename(f.path) === '.mcp.json') for (const c of connectorsFromMcpJson(f.content)) defined.set(c.id, c)
    if (basename(f.path) === 'connectors.yaml')
      for (const c of connectorsFromYaml(f.content)) defined.set(c.id, { ...defined.get(c.id), ...c })
  }

  // 2. A SKILL.md exported by Harness Studio, without its harness.json.
  const topSkill = shallowest((p) => basename(p) === 'SKILL.md')
  if (topSkill && isExportedSkill(parseFrontmatter(topSkill.content).body)) {
    notes.push(`Rebuilt the steps from ${topSkill.path}.`)
    return { project: fromExportedSkill(topSkill.path, topSkill.content, byPath, [...defined.values()]), notes }
  }

  // 3. Plugin, skills folder, agents folder or single skill.
  const pluginJson = shallowest((p) => p.endsWith('.claude-plugin/plugin.json'))
  let pluginName = ''
  let root = ''
  let projectName = folderName
  let description = ''
  if (pluginJson) {
    root = dirname(dirname(pluginJson.path))
    try {
      const pj = JSON.parse(pluginJson.content) as { name?: string; description?: string }
      pluginName = pj.name ?? ''
      projectName = pj.name ? `${pj.name} plugin` : folderName
      description = pj.description ?? ''
    } catch {
      notes.push(`${pluginJson.path} is not valid JSON.`)
    }
  }
  const under = (p: string) => !root || p.startsWith(root + '/')
  const rel = (p: string) => (root ? p.slice(root.length + 1) : p)

  const units: Unit[] = []
  for (const f of files) {
    if (!under(f.path)) continue
    const r = rel(f.path)
    const isSkill = basename(r) === 'SKILL.md'
    const agentDir = /(^|\/)agents\/[^/]+\.md$/.test(r)
    const commandDir = /(^|\/)commands\/[^/]+\.md$/.test(r)
    if (!isSkill && !agentDir && !commandDir) continue
    const { meta, body } = parseFrontmatter(f.content)
    const fallback = isSkill ? basename(dirname(f.path)) || folderName : stripExt(basename(r))
    units.push({
      id: `${isSkill ? 'skill' : agentDir ? 'agent' : 'cmd'}-${units.length + 1}`,
      origin: isSkill ? 'skill' : agentDir ? 'agent' : 'command',
      name: commandDir ? stripExt(basename(r)) : str(meta.name) || fallback,
      description: oneLine(str(meta.description)),
      body,
      toolsText: str(meta.tools) + ' ' + str(meta['allowed-tools']),
      path: f.path,
      ownDir: isSkill ? dirname(f.path) : undefined,
    })
  }

  // A folder of loose .md agents (like ~/.claude/agents) has no agents/ parent.
  if (!units.length) {
    for (const f of files.filter((f) => /\.md$/i.test(f.path) && depth(f.path) <= 2)) {
      const { meta, body } = parseFrontmatter(f.content)
      if (!meta.name && !meta.description) continue
      units.push({
        id: `agent-${units.length + 1}`,
        origin: meta.tools || meta.model ? 'agent' : 'skill',
        name: str(meta.name) || stripExt(basename(f.path)),
        description: oneLine(str(meta.description)),
        body,
        toolsText: str(meta.tools),
        path: f.path,
      })
    }
  }

  if (!units.length) {
    notes.push('No SKILL.md, agents/*.md, commands/*.md or harness.json was found in this folder.')
    return {
      project: { version: 1, name: folderName, description: '', nodes: [], edges: [], connectors: {} },
      notes,
    }
  }

  // One skill or command on its own: show its numbered sections as the flow.
  let expanded = units
  let chained = false
  if (units.length === 1) {
    const steps = splitSteps(units[0])
    if (steps) {
      expanded = steps
      chained = true
      projectName = units[0].name
      description = units[0].description
      notes.push(`Split ${units[0].path} into ${steps.length} steps from its numbered headings.`)
    } else if (!pluginJson) {
      projectName = units[0].name
      description = units[0].description
    }
  }

  // Attachments: everything else in a skill's own folder, plus files any unit links to.
  const claimed = new Set(units.map((u) => u.path))
  const attachmentsFor = (u: Unit): Attachment[] => {
    const paths = new Set<string>()
    if (u.ownDir !== undefined)
      for (const f of files) if (f.path.startsWith(u.ownDir ? u.ownDir + '/' : '') && !claimed.has(f.path)) paths.add(f.path)
    for (const p of linkedFiles(u, root, byPath)) if (!claimed.has(p)) paths.add(p)
    const skip = ['.mcp.json', 'connectors.yaml', 'harness.json', 'plugin.json']
    return [...paths]
      .filter((p) => !skip.includes(basename(p)))
      .map((p, i) => {
        const f = byPath.get(p)!
        const base = u.ownDir ? u.ownDir + '/' : ''
        const name = p.startsWith(base) ? p.slice(base.length) : rel(p)
        return {
          id: `a-${u.id}-${i}`,
          name,
          content: f.content.length > MAX_ATTACHMENT ? f.content.slice(0, MAX_ATTACHMENT) + '\n…(truncated on import)\n' : f.content,
        }
      })
  }
  // Folder files belong to the skill as a whole, so only the first step carries them.
  if (chained) expanded = expanded.map((u, i) => (i === 0 ? u : { ...u, ownDir: undefined }))

  // Connectors: explicit mcp__ tool references, resolved against the folder's own config.
  const connectors = new Map<string, Connector>()
  const nodeConnectors = new Map<string, string[]>()
  for (const u of expanded) {
    const refs = mcpToolRefs(u.body + '\n' + u.toolsText)
    nodeConnectors.set(u.id, [...refs.keys()])
    for (const [id, tools] of refs) if (!connectors.has(id)) connectors.set(id, defined.get(id) ?? guessConnector(id, tools))
  }
  for (const [id, c] of defined) if (!connectors.has(id)) connectors.set(id, c)

  const nodes: SkillNode[] = expanded.map((u) => ({
    id: u.id,
    type: 'skill',
    position: { x: 0, y: 0 },
    data: {
      name: u.name,
      description: u.description,
      instructions: u.body.trim(),
      attachments: attachmentsFor(u),
      connectorIds: nodeConnectors.get(u.id) ?? [],
      origin: u.origin,
      sourcePath: u.path,
    },
  }))

  const edges = chained
    ? expanded.slice(1).map<FlowEdge>((u, i) => ({
        id: `e-${i + 1}`,
        source: expanded[i].id,
        target: u.id,
        type: 'condition',
        data: { condition: '' },
      }))
    : findLinks(expanded, pluginName)

  const counts = (['skill', 'agent', 'command', 'step'] as const)
    .map((k) => [k, expanded.filter((u) => u.origin === k).length] as const)
    .filter(([, n]) => n)
    .map(([k, n]) => `${n} ${k}${n > 1 ? 's' : ''}`)
  notes.unshift(`Found ${counts.join(', ')} and ${edges.length} link${edges.length === 1 ? '' : 's'}.`)
  if (!chained && edges.some((e) => e.data?.kind === 'ref'))
    notes.push('Dotted “uses” links mean one file mentions another. Write a condition on a link to turn it into routing.')
  const guessed = [...connectors.values()].filter((c) => !defined.has(c.id))
  if (guessed.length)
    notes.push(`${guessed.length} connector${guessed.length > 1 ? 's were' : ' was'} found from tool names only: ${guessed.map((c) => c.label).join(', ')}.`)

  return {
    project: { version: 1, name: projectName, description, nodes: layout(nodes, edges), edges, connectors: Object.fromEntries(connectors) },
    notes,
  }
}
