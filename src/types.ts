import type { Edge, Node } from '@xyflow/react'

/** A file attached to a skill: a reference doc, a sub-skill, a YAML config. */
export type Attachment = {
  id: string
  name: string
  content: string
}

export type SkillData = {
  name: string
  description: string
  /** What Claude should do at this step. Becomes the step body in SKILL.md. */
  instructions: string
  attachments: Attachment[]
  /** Keys into Project.connectors. */
  connectorIds: string[]
  /** What an imported node was made from. Missing for skills drawn by hand. */
  origin?: 'skill' | 'agent' | 'command' | 'step'
  /** File the node was imported from, relative to the imported folder. */
  sourcePath?: string
}

export type SkillNode = Node<SkillData, 'skill'>

export type FlowEdgeData = {
  /** Natural-language condition. Empty means "always continue". */
  condition: string
  /**
   * "ref" marks a link found by import: the source mentions or calls the target, but no
   * routing condition was written down. Missing means an ordinary flow link.
   */
  kind?: 'ref'
  /** The line the link was found on, kept as a tooltip. */
  note?: string
}

export type FlowEdge = Edge<FlowEdgeData, 'condition'>

export type Connector = {
  /** Server key, used as the key in .mcp.json's mcpServers. */
  id: string
  label: string
  transport: 'stdio' | 'http' | 'sse'
  command?: string
  args?: string[]
  url?: string
  env?: Record<string, string>
  headers?: Record<string, string>
  notes?: string
}

/** The serialisable project, also written to harness.json for round-tripping. */
export type Project = {
  version: 1
  name: string
  description: string
  nodes: SkillNode[]
  edges: FlowEdge[]
  connectors: Record<string, Connector>
}
