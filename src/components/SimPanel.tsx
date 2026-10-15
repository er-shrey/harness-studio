import { useEffect, useRef } from 'react'
import { useStore } from '../store'
import { answerCondition, runSimulation, stopSimulation } from '../simulate'

export default function SimPanel() {
  const sim = useStore((s) => s.sim)
  const edges = useStore((s) => s.edges)
  const nodes = useStore((s) => s.nodes)
  const selection = useStore((s) => s.selection)
  const setSim = useStore((s) => s.setSim)
  const logRef = useRef<HTMLOListElement>(null)

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [sim.log.length])

  const asking = sim.askingEdgeId ? edges.find((e) => e.id === sim.askingEdgeId) : undefined
  const name = (id: string) => nodes.find((n) => n.id === id)?.data.name ?? id
  const startFrom = selection?.kind === 'node' ? selection.id : undefined

  return (
    <div className="sim-panel">
      <div className="row">
        <b>Simulate</b>
        <label className="inline">
          <input
            type="checkbox"
            checked={sim.mode === 'ask'}
            disabled={sim.status === 'running'}
            onChange={(e) => setSim({ mode: e.target.checked ? 'ask' : 'auto' })}
          />
          Ask me at each condition
        </label>
        <span className="spacer" />
        {sim.status === 'running' ? (
          <button className="small" onClick={stopSimulation}>
            Stop
          </button>
        ) : (
          <>
            <button className="small primary" onClick={() => runSimulation(startFrom)}>
              ▶ {startFrom ? `Run from “${name(startFrom)}”` : 'Run'}
            </button>
            {sim.status === 'done' && (
              <button className="small" onClick={stopSimulation}>
                Clear
              </button>
            )}
          </>
        )}
      </div>
      {asking && (
        <div className="ask">
          <span>
            {name(asking.source)} → {name(asking.target)}: does “<b>{asking.data?.condition}</b>” hold?
          </span>
          <button className="small primary" onClick={() => answerCondition(true)}>
            Yes
          </button>
          <button className="small" onClick={() => answerCondition(false)}>
            No
          </button>
        </div>
      )}
      {sim.log.length > 0 && (
        <ol className="sim-log mono" ref={logRef}>
          {sim.log.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ol>
      )}
    </div>
  )
}
