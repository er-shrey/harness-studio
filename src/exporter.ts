import JSZip from 'jszip'
import yaml from 'js-yaml'
import type { Connector, FlowEdge, Project, SkillNode } from './types'
import { missingConnectors } from './connectors'

export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'untitled'

/**
 * Order steps for the document: Kahn's topological sort, with nodes that sit in a
 * cycle appended afterwards in canvas order (left to right), so loops still export.
 */
export function orderNodes(nodes: SkillNode[], edges: FlowEdge[]): SkillNode[] {
  const byX = [...nodes].sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y)
  const indeg = new Map(nodes.map((n) => [n.id, 0]))
  for (const e of edges) indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1)
  const queue = byX.filter((n) => indeg.get(n.id) === 0)
  const out: SkillNode[] = []
  const seen = new Set<string>()
  while (queue.length) {
    const n = queue.shift()!
    if (seen.has(n.id)) continue
    seen.add(n.id)
    out.push(n)
    for (const e of edges.filter((e) => e.source === n.id)) {
      indeg.set(e.target, (indeg.get(e.target) ?? 1) - 1)
      if (indeg.get(e.target) === 0) {
        const t = nodes.find((x) => x.id === e.target)
        if (t) queue.push(t)
      }
    }
  }
  return [...out, ...byX.filter((n) => !seen.has(n.id))]
}

const refPath = (node: SkillNode, fileName: string) => `references/${slug(node.data.name)}/${fileName}`

const mermaidLabel = (s: string) => s.replace(/"/g, '#quot;')

function mermaid(nodes: SkillNode[], edges: FlowEdge[]): string {
  const key = new Map(nodes.map((n, i) => [n.id, `n${i + 1}`]))
  const lines = ['flowchart LR']
  for (const n of nodes) lines.push(`  ${key.get(n.id)}["${mermaidLabel(n.data.name)}"]`)
  for (const e of edges) {
    const c = e.data?.condition?.trim()
    const arrow = e.data?.kind === 'ref' ? '-.->' : '-->'
    lines.push(`  ${key.get(e.source)} ${arrow}${c ? `|"${mermaidLabel(c)}"|` : ''} ${key.get(e.target)}`)
  }
  return lines.join('\n')
}

/** Connectors actually used by at least one skill. */
export function usedConnectors(p: Project): Connector[] {
  const ids = new Set(p.nodes.flatMap((n) => n.data.connectorIds))
  return [...ids].map((id) => p.connectors[id]).filter(Boolean)
}

export function buildSkillMd(p: Project): string {
  const nodes = orderNodes(p.nodes, p.edges)
  const step = new Map(nodes.map((n, i) => [n.id, i + 1]))
  const name = slug(p.name)
  const description = (p.description || `Workflow: ${nodes.map((n) => n.data.name).join(' → ')}`).replace(/\n/g, ' ')
  const connectors = usedConnectors(p)

  const out: string[] = []
  out.push('---', `name: ${name}`, `description: ${JSON.stringify(description)}`, '---', '')
  out.push(`# ${p.name}`, '')
  if (p.description) out.push(p.description, '')

  if (connectors.length) {
    out.push('## Before you start: required MCP connectors', '')
    out.push('This workflow calls tools from these MCP servers. They are defined in `.mcp.json` next to this file.', '')
    for (const c of connectors) {
      const users = nodes.filter((n) => n.data.connectorIds.includes(c.id)).map((n) => `Step ${step.get(n.id)}`)
      out.push(`- **${c.label}** (\`${c.id}\`), used by ${users.join(', ')}`)
    }
    out.push('', 'If one of these is not connected, stop and tell the user which one is missing before doing anything else.', '')
  }

  out.push('## Flow', '', '```mermaid', mermaid(nodes, p.edges), '```', '')

  out.push('## How to run this workflow', '')
  const starts = nodes.filter((n) => !p.edges.some((e) => e.target === n.id))
  out.push(
    `Start at ${starts.length ? starts.map((n) => `Step ${step.get(n.id)} (${n.data.name})`).join(' and ') : 'Step 1'}.`,
    'After each step, read its **Next** list and check every condition against what you found in that step.',
    'Continue to every step whose condition holds; a step marked *always* runs unconditionally.',
    'If no condition holds, the flow ends there. Say which conditions you checked and why none matched.',
    'Load a step\'s reference files only when you reach that step.',
    '',
  )

  out.push('## Steps', '')
  for (const n of nodes) {
    const d = n.data
    out.push(`### Step ${step.get(n.id)}: ${d.name}`, '')
    if (d.description) out.push(`*${d.description}*`, '')
    out.push(d.instructions.trim() || '_No instructions written yet._', '')
    if (d.attachments.length) {
      out.push('**References for this step:**', '')
      for (const a of d.attachments) out.push(`- [\`${a.name}\`](${refPath(n, a.name)})`)
      out.push('')
    }
    if (d.connectorIds.length) {
      out.push(`**Connectors:** ${d.connectorIds.map((c) => p.connectors[c]?.label ?? c).join(', ')}`, '')
    }
    const refs = p.edges.filter((e) => e.source === n.id && e.data?.kind === 'ref')
    if (refs.length) {
      out.push('**Uses:**', '')
      for (const e of refs) {
        const t = nodes.find((x) => x.id === e.target)
        if (t) out.push(`- Step ${step.get(t.id)} (${t.data.name})`)
      }
      out.push('')
    }
    const outs = p.edges.filter((e) => e.source === n.id && e.data?.kind !== 'ref')
    out.push('**Next:**', '')
    if (!outs.length) out.push('- This is a final step. Summarise what the workflow did.')
    for (const e of outs) {
      const t = nodes.find((x) => x.id === e.target)
      if (!t) continue
      const c = e.data?.condition?.trim()
      out.push(`- ${c ? `If ${c}` : '*Always*'} → Step ${step.get(t.id)} (${t.data.name})`)
    }
    if (outs.length && outs.every((e) => e.data?.condition?.trim())) out.push('- Otherwise → stop here.')
    out.push('')
  }

  return out.join('\n')
}

export function buildMcpJson(connectors: Connector[]): string {
  const servers: Record<string, unknown> = {}
  for (const c of connectors) {
    if (c.transport === 'stdio') {
      servers[c.id] = {
        command: c.command ?? '',
        ...(c.args?.length ? { args: c.args } : {}),
        ...(c.env && Object.keys(c.env).length ? { env: c.env } : {}),
      }
    } else {
      servers[c.id] = {
        type: c.transport,
        url: c.url ?? '',
        ...(c.headers && Object.keys(c.headers).length ? { headers: c.headers } : {}),
      }
    }
  }
  return JSON.stringify({ mcpServers: servers }, null, 2) + '\n'
}

/** The editable YAML form of a connector (id is the map key, so it's left out). */
export function connectorToYaml(c: Connector): string {
  const rest: Partial<Connector> = { ...c }
  delete rest.id
  return yaml.dump(rest, { lineWidth: 100 })
}

export function connectorFromYaml(id: string, text: string): Connector {
  const parsed = yaml.load(text)
  if (!parsed || typeof parsed !== 'object') throw new Error('Expected a YAML mapping')
  const c = { ...(parsed as Partial<Connector>), id } as Connector
  if (!c.label) c.label = id
  if (!['stdio', 'http', 'sse'].includes(c.transport)) throw new Error('transport must be stdio, http or sse')
  if (c.transport === 'stdio' && !c.command) throw new Error('stdio connectors need a command')
  if (c.transport !== 'stdio' && !c.url) throw new Error(`${c.transport} connectors need a url`)
  return c
}

export function buildConnectorsYaml(connectors: Connector[]): string {
  return yaml.dump(
    { connectors: Object.fromEntries(connectors.map(({ id, ...rest }) => [id, rest])) },
    { lineWidth: 100 },
  )
}

/** Warnings worth showing before an export. */
export function exportWarnings(p: Project): string[] {
  const w: string[] = []
  if (!p.nodes.length) w.push('The canvas is empty.')
  for (const n of p.nodes) {
    const missing = missingConnectors(n.data, p.connectors)
    if (missing.length)
      w.push(`“${n.data.name}” looks like it needs ${missing.map((m) => m.connector.label).join(', ')} but none is attached.`)
    if (!n.data.instructions.trim()) w.push(`“${n.data.name}” has no instructions.`)
  }
  const connected = new Set(p.edges.flatMap((e) => [e.source, e.target]))
  if (p.nodes.length > 1)
    for (const n of p.nodes) if (!connected.has(n.id)) w.push(`“${n.data.name}” is not linked to anything.`)
  for (const c of usedConnectors(p))
    if (Object.values({ ...c.env, ...c.headers }).some((v) => /^<.*>$/.test(v)) || /^<.*>$/.test(c.command ?? ''))
      w.push(`Connector “${c.label}” still has placeholder values.`)
  return w
}

export async function buildBundle(p: Project): Promise<Blob> {
  const zip = new JSZip()
  const root = zip.folder(slug(p.name))!
  root.file('SKILL.md', buildSkillMd(p))
  for (const n of p.nodes) for (const a of n.data.attachments) root.file(refPath(n, a.name), a.content)
  const connectors = usedConnectors(p)
  if (connectors.length) {
    root.file('.mcp.json', buildMcpJson(connectors))
    root.file('connectors.yaml', buildConnectorsYaml(connectors))
  }
  root.file('harness.json', JSON.stringify(p, null, 2))
  return zip.generateAsync({ type: 'blob' })
}

export function download(name: string, data: Blob | string, type = 'text/plain') {
  const blob = typeof data === 'string' ? new Blob([data], { type }) : data
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
