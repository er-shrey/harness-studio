import { create } from 'zustand'
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react'
import type { Attachment, Connector, FlowEdge, Project, SkillData, SkillNode } from './types'
import { layout } from './importer'

export const uid = () => crypto.randomUUID().slice(0, 8)

export type Selection = { kind: 'node' | 'edge'; id: string } | null

export type SimStatus = 'idle' | 'running' | 'done'

export type SimState = {
  status: SimStatus
  mode: 'auto' | 'ask'
  activeNodeId: string | null
  activeEdgeId: string | null
  visitedNodes: string[]
  takenEdges: string[]
  skippedEdges: string[]
  /** Edge waiting on a yes/no answer in "ask" mode. */
  askingEdgeId: string | null
  log: string[]
}

const idleSim: SimState = {
  status: 'idle',
  mode: 'ask',
  activeNodeId: null,
  activeEdgeId: null,
  visitedNodes: [],
  takenEdges: [],
  skippedEdges: [],
  askingEdgeId: null,
  log: [],
}

type State = Omit<Project, 'version'> & {
  selection: Selection
  sim: SimState

  onNodesChange: (changes: NodeChange<SkillNode>[]) => void
  onEdgesChange: (changes: EdgeChange<FlowEdge>[]) => void
  onConnect: (c: Connection) => void

  addSkill: (name: string, position?: { x: number; y: number }) => string
  updateSkill: (id: string, patch: Partial<SkillData>) => void
  addAttachments: (id: string, files: Omit<Attachment, 'id'>[]) => void
  updateAttachment: (id: string, attachmentId: string, patch: Partial<Attachment>) => void
  removeAttachment: (id: string, attachmentId: string) => void
  attachConnector: (nodeId: string, connector: Connector) => void
  detachConnector: (nodeId: string, connectorId: string) => void
  upsertConnector: (connector: Connector, previousId?: string) => void
  removeConnector: (id: string) => void
  updateEdge: (id: string, condition: string) => void
  deleteSelection: () => void
  select: (s: Selection) => void
  setMeta: (patch: { name?: string; description?: string }) => void
  tidyLayout: () => void

  loadProject: (p: Project) => void
  toProject: () => Project

  setSim: (patch: Partial<SimState>) => void
  resetSim: () => void
}

export const emptyProject = (): Project => ({
  version: 1,
  name: 'Untitled harness',
  description: '',
  nodes: [],
  edges: [],
  connectors: {},
})

const mapNode = (nodes: SkillNode[], id: string, fn: (d: SkillData) => SkillData) =>
  nodes.map((n) => (n.id === id ? { ...n, data: fn(n.data) } : n))

export const useStore = create<State>()((set, get) => ({
  ...emptyProject(),
  selection: null,
  sim: idleSim,

  onNodesChange: (changes) => set({ nodes: applyNodeChanges(changes, get().nodes) }),
  onEdgesChange: (changes) => set({ edges: applyEdgeChanges(changes, get().edges) }),
  onConnect: (c) => {
    if (c.source === c.target) return
    const edge: FlowEdge = { ...c, id: `e-${uid()}`, type: 'condition', data: { condition: '' } } as FlowEdge
    set({ edges: addEdge(edge, get().edges), selection: { kind: 'edge', id: edge.id } })
  },

  addSkill: (name, position) => {
    const id = `s-${uid()}`
    const n = get().nodes.length
    const node: SkillNode = {
      id,
      type: 'skill',
      position: position ?? { x: 80 + (n % 4) * 260, y: 80 + Math.floor(n / 4) * 180 },
      data: { name, description: '', instructions: '', attachments: [], connectorIds: [] },
    }
    set({ nodes: [...get().nodes, node], selection: { kind: 'node', id } })
    return id
  },
  updateSkill: (id, patch) => set({ nodes: mapNode(get().nodes, id, (d) => ({ ...d, ...patch })) }),
  addAttachments: (id, files) =>
    set({
      nodes: mapNode(get().nodes, id, (d) => ({
        ...d,
        attachments: [...d.attachments, ...files.map((f) => ({ ...f, id: `a-${uid()}` }))],
      })),
    }),
  updateAttachment: (id, attachmentId, patch) =>
    set({
      nodes: mapNode(get().nodes, id, (d) => ({
        ...d,
        attachments: d.attachments.map((a) => (a.id === attachmentId ? { ...a, ...patch } : a)),
      })),
    }),
  removeAttachment: (id, attachmentId) =>
    set({
      nodes: mapNode(get().nodes, id, (d) => ({
        ...d,
        attachments: d.attachments.filter((a) => a.id !== attachmentId),
      })),
    }),
  attachConnector: (nodeId, connector) => {
    const connectors = get().connectors[connector.id]
      ? get().connectors
      : { ...get().connectors, [connector.id]: connector }
    set({
      connectors,
      nodes: mapNode(get().nodes, nodeId, (d) =>
        d.connectorIds.includes(connector.id) ? d : { ...d, connectorIds: [...d.connectorIds, connector.id] },
      ),
    })
  },
  detachConnector: (nodeId, connectorId) =>
    set({
      nodes: mapNode(get().nodes, nodeId, (d) => ({
        ...d,
        connectorIds: d.connectorIds.filter((c) => c !== connectorId),
      })),
    }),
  upsertConnector: (connector, previousId) => {
    const connectors = { ...get().connectors }
    let nodes = get().nodes
    if (previousId && previousId !== connector.id) {
      delete connectors[previousId]
      nodes = nodes.map((n) => ({
        ...n,
        data: { ...n.data, connectorIds: n.data.connectorIds.map((c) => (c === previousId ? connector.id : c)) },
      }))
    }
    connectors[connector.id] = connector
    set({ connectors, nodes })
  },
  removeConnector: (id) => {
    const connectors = { ...get().connectors }
    delete connectors[id]
    set({
      connectors,
      nodes: get().nodes.map((n) => ({
        ...n,
        data: { ...n.data, connectorIds: n.data.connectorIds.filter((c) => c !== id) },
      })),
    })
  },
  updateEdge: (id, condition) =>
    // Writing a condition turns an imported "uses" link into a real routing link.
    set({ edges: get().edges.map((e) => (e.id === id ? { ...e, data: { ...e.data, condition, kind: undefined } } : e)) }),
  deleteSelection: () => {
    const s = get().selection
    if (!s) return
    if (s.kind === 'node') {
      set({
        nodes: get().nodes.filter((n) => n.id !== s.id),
        edges: get().edges.filter((e) => e.source !== s.id && e.target !== s.id),
        selection: null,
      })
    } else {
      set({ edges: get().edges.filter((e) => e.id !== s.id), selection: null })
    }
  },
  select: (selection) => set({ selection }),
  setMeta: (patch) => set(patch),
  tidyLayout: () => set({ nodes: layout(get().nodes, get().edges) }),

  loadProject: (p) =>
    set({
      name: p.name,
      description: p.description,
      nodes: p.nodes,
      edges: p.edges,
      connectors: p.connectors,
      selection: null,
      sim: idleSim,
    }),
  toProject: () => {
    const { name, description, nodes, edges, connectors } = get()
    return {
      version: 1,
      name,
      description,
      // Strip React Flow's runtime fields so harness.json stays clean.
      nodes: nodes.map(({ id, type, position, data }) => ({ id, type, position, data })) as SkillNode[],
      edges: edges.map(({ id, source, target, type, data }) => ({ id, source, target, type, data })) as FlowEdge[],
      connectors,
    }
  },

  setSim: (patch) => set({ sim: { ...get().sim, ...patch } }),
  resetSim: () => set({ sim: { ...idleSim, mode: get().sim.mode } }),
}))

/** Delete the selected skill or link, asking first when a skill has content that would be lost. */
export function confirmDelete() {
  const { selection, nodes, edges, deleteSelection } = useStore.getState()
  if (!selection) return
  if (selection.kind === 'node') {
    const n = nodes.find((x) => x.id === selection.id)
    if (!n) return
    const links = edges.filter((e) => e.source === n.id || e.target === n.id).length
    const hasContent = n.data.instructions.trim() || n.data.attachments.length || links
    const detail = [
      n.data.attachments.length && `${n.data.attachments.length} attached file(s)`,
      links && `${links} link(s)`,
    ]
      .filter(Boolean)
      .join(' and ')
    if (hasContent && !confirm(`Delete “${n.data.name}”${detail ? ` with its ${detail}` : ''}?`)) return
  }
  deleteSelection()
}

