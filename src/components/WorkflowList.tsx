import { useState } from 'react'
import {
  deleteWorkflow,
  duplicateWorkflow,
  newWorkflow,
  openWorkflow,
  renameWorkflow,
  useWorkflows,
} from '../workflows'
import type { WorkflowMeta } from '../storage'

function ago(t: number) {
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  if (d < 14) return `${d} d ago`
  return new Date(t).toLocaleDateString()
}

export default function WorkflowList({ onError }: { onError: (message: string) => void }) {
  const { list, currentId, status, error, storageKind } = useWorkflows()
  const [query, setQuery] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)

  const run = (p: Promise<unknown>) => p.catch((e: Error) => onError(e.message))
  const shown = query.trim()
    ? list.filter((w) => `${w.name} ${w.description}`.toLowerCase().includes(query.trim().toLowerCase()))
    : list

  return (
    <nav className="workflows" aria-label="Workflows">
      <div className="row workflows__head">
        <h3>Workflows</h3>
        <span className="spacer" />
        <button className="small primary" onClick={() => run(newWorkflow())}>
          + New
        </button>
      </div>
      {list.length > 5 && (
        <input
          className="workflows__search"
          type="search"
          placeholder="Search workflows"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      <ul>
        {shown.map((w) =>
          renaming === w.id ? (
            <RenameRow key={w.id} workflow={w} onDone={() => setRenaming(null)} onError={onError} />
          ) : (
            <li key={w.id} className={w.id === currentId ? 'active' : ''}>
              <button
                className="workflows__open"
                onClick={() => run(openWorkflow(w.id))}
                onDoubleClick={() => setRenaming(w.id)}
                title={w.description || w.name}
                aria-current={w.id === currentId ? 'page' : undefined}
              >
                <span className="workflows__name">{w.name}</span>
                <span className="hint">
                  {w.nodeCount} skill{w.nodeCount === 1 ? '' : 's'} · {ago(w.updatedAt)}
                </span>
              </button>
              <div className="workflows__actions">
                <button className="small" onClick={() => setRenaming(w.id)} title="Rename" aria-label={`Rename ${w.name}`}>
                  ✎
                </button>
                <button
                  className="small"
                  onClick={() => run(duplicateWorkflow(w.id))}
                  title="Duplicate"
                  aria-label={`Duplicate ${w.name}`}
                >
                  ⧉
                </button>
                <button
                  className="small danger"
                  onClick={() => {
                    if (confirm(`Delete the workflow “${w.name}”? This can't be undone.`)) run(deleteWorkflow(w.id))
                  }}
                  title="Delete"
                  aria-label={`Delete ${w.name}`}
                >
                  ✕
                </button>
              </div>
            </li>
          ),
        )}
        {!shown.length && <li className="muted workflows__empty">No workflows match.</li>}
      </ul>
      <footer className={`workflows__status ${status}`} role="status">
        {storageKind === 'memory'
          ? "This browser can't store workflows; they're lost on reload."
          : status === 'error'
            ? `Couldn't save: ${error}`
            : status === 'saving'
              ? 'Saving…'
              : 'All changes saved in this browser'}
      </footer>
    </nav>
  )
}

function RenameRow({ workflow, onDone, onError }: { workflow: WorkflowMeta; onDone: () => void; onError: (m: string) => void }) {
  const [value, setValue] = useState(workflow.name)
  const [problem, setProblem] = useState('')

  const commit = async () => {
    if (value.trim() === workflow.name) return onDone()
    try {
      await renameWorkflow(workflow.id, value)
      onDone()
    } catch (e) {
      setProblem((e as Error).message)
    }
  }

  return (
    <li className="active renaming">
      <input
        autoFocus
        value={value}
        aria-label="Workflow name"
        onFocus={(e) => e.target.select()}
        onChange={(e) => {
          setValue(e.target.value)
          setProblem('')
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void commit()
          if (e.key === 'Escape') onDone()
        }}
        onBlur={() => {
          if (!problem) void commit().catch((e: Error) => onError(e.message))
        }}
      />
      {problem && <p className="error">{problem}</p>}
    </li>
  )
}
