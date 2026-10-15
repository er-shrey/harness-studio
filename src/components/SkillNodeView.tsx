import { Handle, Position, type NodeProps } from '@xyflow/react'
import { memo } from 'react'
import type { SkillNode } from '../types'
import { confirmDelete, useStore } from '../store'
import { missingConnectors } from '../connectors'

const ICONS = { skill: '◆', agent: '●', command: '/', step: '▸' } as const

function SkillNodeView({ id, data, selected }: NodeProps<SkillNode>) {
  const sim = useStore((s) => s.sim)
  const connectors = useStore((s) => s.connectors)
  const isSelected = useStore((s) => s.selection?.kind === 'node' && s.selection.id === id) || selected
  const missing = missingConnectors(data, connectors)

  const state =
    sim.activeNodeId === id ? 'active' : sim.visitedNodes.includes(id) ? 'visited' : sim.status !== 'idle' ? 'dim' : ''

  return (
    <div className={`skill-node ${isSelected ? 'selected' : ''} ${state}`}>
      <Handle type="target" position={Position.Left} />
      {isSelected && (
        <button className="canvas-delete canvas-delete--node nodrag" onClick={confirmDelete} title="Delete skill" aria-label="Delete skill">
          ✕
        </button>
      )}
      <div className="skill-node__head">
        <span className="skill-node__icon" aria-hidden title={data.origin}>
          {ICONS[data.origin ?? 'skill']}
        </span>
        <span className="skill-node__name">{data.name || 'Untitled skill'}</span>
      </div>
      {data.origin && data.origin !== 'skill' && <div className="skill-node__kind">{data.origin}</div>}
      {data.description && <div className="skill-node__desc">{data.description}</div>}
      <div className="skill-node__meta">
        <span title="Attached files">📄 {data.attachments.length}</span>
        {data.connectorIds.map((c) => (
          <span key={c} className="chip">
            {connectors[c]?.label ?? c}
          </span>
        ))}
        {missing.length > 0 && (
          <span className="chip chip--warn" title={missing.map((m) => `${m.connector.label}: ${m.reason}`).join('\n')}>
            ⚠ needs {missing[0].connector.label}
            {missing.length > 1 ? ` +${missing.length - 1}` : ''}
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

export default memo(SkillNodeView)
