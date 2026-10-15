import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react'
import type { FlowEdge } from '../types'
import { confirmDelete, useStore } from '../store'

export default function ConditionEdge(props: EdgeProps<FlowEdge>) {
  const { id, data, selected, markerEnd } = props
  const [path, labelX, labelY] = getBezierPath(props)
  const sim = useStore((s) => s.sim)
  const select = useStore((s) => s.select)
  const isSelected = useStore((s) => s.selection?.kind === 'edge' && s.selection.id === id)

  const active = sim.activeEdgeId === id
  const asking = sim.askingEdgeId === id
  const state = active || asking ? 'active' : sim.takenEdges.includes(id) ? 'taken' : sim.skippedEdges.includes(id) ? 'skipped' : ''
  const condition = data?.condition?.trim()
  const isRef = data?.kind === 'ref' && !condition
  // "when …", "only …" and friends already read as conditions; don't prefix them with "if".
  const label = condition
    ? /^(when|whenever|only|unless|once|after|before)\b/i.test(condition)
      ? condition
      : `if ${condition}`
    : isRef
      ? 'uses'
      : 'always'

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} className={`flow-edge ${isRef ? 'flow-edge--ref' : ''} ${state} ${selected || isSelected ? 'selected' : ''}`} />
      {active && (
        <circle r={7} className="flow-edge__pulse">
          <animateMotion dur="1s" repeatCount="indefinite" path={path} />
        </circle>
      )}
      <EdgeLabelRenderer>
        <div
          className="edge-label-wrap nodrag nopan"
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
        >
          <button
            className={`edge-label ${condition ? '' : 'edge-label--always'} ${isRef ? 'edge-label--ref' : ''} ${state} ${selected || isSelected ? 'selected' : ''}`}
            onClick={() => select({ kind: 'edge', id })}
            title={data?.note ?? (condition ? label : 'Edit condition')}
          >
            {label}
          </button>
          {isSelected && (
            <button className="canvas-delete" onClick={confirmDelete} title="Delete link" aria-label="Delete link">
              ✕
            </button>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
