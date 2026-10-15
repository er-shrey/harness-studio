import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  ControlButton,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { confirmDelete, useStore } from './store'
import { exampleProject } from './example'
import { createWorkflow, initWorkflows, newWorkflow, useWorkflows } from './workflows'
import WorkflowList from './components/WorkflowList'
import type { Project } from './types'
import SkillNodeView from './components/SkillNodeView'
import ConditionEdge from './components/ConditionEdge'
import Inspector from './components/Inspector'
import SimPanel from './components/SimPanel'
import ConnectorsDialog from './components/ConnectorsDialog'
import ExportDialog from './components/ExportDialog'
import { download, slug } from './exporter'
import { importFiles } from './importer'
import { canPickDirectory, pickDirectory, readFileList, readZip, type ReadResult } from './folderReader'

const nodeTypes = { skill: SkillNodeView }
const edgeTypes = { condition: ConditionEdge }
const arrow = { type: MarkerType.ArrowClosed, width: 18, height: 18 }

function parseProject(text: string): Project {
  const p = JSON.parse(text) as Project
  if (p?.version !== 1 || !Array.isArray(p.nodes) || !Array.isArray(p.edges) || typeof p.connectors !== 'object')
    throw new Error('Not a Harness Studio harness.json file')
  return p
}

function Studio() {
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect, addSkill, select, name, toProject, tidyLayout } = useStore()
  const { ready, currentId } = useWorkflows()
  const [showList, setShowList] = useState(() => window.innerWidth > 900)
  const { screenToFlowPosition, fitView } = useReactFlow()
  const [dialog, setDialog] = useState<{ kind: 'connectors'; id?: string } | { kind: 'export' } | null>(null)
  const importInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const zipInput = useRef<HTMLInputElement>(null)
  const [notice, setNotice] = useState<{ title: string; lines: string[]; error?: boolean } | null>(null)

  useEffect(() => {
    initWorkflows().catch((e: Error) => setNotice({ title: 'Could not open saved workflows', lines: [e.message], error: true }))
  }, [])

  // Frame the graph whenever a different workflow opens.
  useEffect(() => {
    if (currentId) setTimeout(() => fitView({ padding: 0.2, minZoom: 0.1 }), 50)
  }, [currentId, fitView])

  const shownEdges = useMemo(() => edges.map((e) => ({ ...e, markerEnd: arrow })), [edges])
  const closeDialog = useCallback(() => setDialog(null), [])

  // One delete path for keys, buttons and the canvas ✕, so the store's selection is the source of truth.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const t = e.target as HTMLElement
      if (dialog || t.closest('input, textarea, select, [contenteditable="true"]')) return
      e.preventDefault()
      confirmDelete()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dialog])

  const tidy = () => {
    tidyLayout()
    setTimeout(() => fitView({ padding: 0.15, duration: 300 }), 30)
  }

  const fail = (title: string) => (e: Error) => setNotice({ title, lines: [e.message], error: true })

  /** Every new, imported or opened file becomes its own workflow, so nothing is ever replaced. */
  const addWorkflow = async (p: Project, imported?: { title: string; lines: string[] }) => {
    await createWorkflow(p)
    setNotice(imported ?? null)
  }

  const runImport = async (read: () => Promise<ReadResult | null>) => {
    try {
      const r = await read()
      if (!r) return
      if (!r.files.length) throw new Error('No readable text files were found there.')
      const { project, notes } = importFiles(r.files, r.name)
      const skipped = r.skipped
        ? [`Skipped ${r.skipped} file${r.skipped > 1 ? 's' : ''}: binaries, build output, very large or secret-looking files.`]
        : []
      await addWorkflow(project, { title: `Imported “${r.name}” as a new workflow`, lines: [...notes, ...skipped] })
    } catch (err) {
      setNotice({ title: 'Import failed', lines: [(err as Error).message], error: true })
    }
  }

  return (
    <div className="app">
      <header className="toolbar">
        <button
          className="small icon-toggle"
          onClick={() => setShowList((v) => !v)}
          aria-label={showList ? 'Hide workflows' : 'Show workflows'}
          aria-expanded={showList}
          title="Workflows"
        >
          ☰
        </button>
        <div className="brand">
          <img src="/icon.svg" alt="" width={22} height={22} />
          <span>Harness Studio</span>
          <span className="project-name">/ {name}</span>
        </div>
        <span className="spacer" />
        <button className="primary" onClick={() => addSkill('New skill')}>
          + Add skill
        </button>
        <button onClick={() => setDialog({ kind: 'connectors' })}>Connectors</button>
        <div className="menu">
          <button>File ▾</button>
          <div className="menu__items">
            <button onClick={() => newWorkflow().catch(fail('Could not create a workflow'))}>New workflow</button>
            <button onClick={() => (canPickDirectory() ? runImport(pickDirectory) : folderInput.current?.click())}>
              Import skill folder…
            </button>
            <button onClick={() => zipInput.current?.click()}>Import skill .zip…</button>
            <button onClick={() => importInput.current?.click()}>Open harness.json…</button>
            <button onClick={tidy}>Tidy layout</button>
            <button onClick={() => download(`${slug(name)}.harness.json`, JSON.stringify(toProject(), null, 2), 'application/json')}>
              Save harness.json
            </button>
            <button onClick={() => addWorkflow(exampleProject()).catch(fail('Could not create a workflow'))}>
              New from example
            </button>
          </div>
        </div>
        <button className="accent" onClick={() => setDialog({ kind: 'export' })}>
          Generate skill
        </button>
        <input
          ref={importInput}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (!f) return
            try {
              await addWorkflow(parseProject(await f.text()), { title: `Opened “${f.name}” as a new workflow`, lines: [] })
            } catch (err) {
              fail('Could not open that file')(err as Error)
            }
          }}
        />
        <input
          ref={folderInput}
          type="file"
          hidden
          {...{ webkitdirectory: '', directory: '' }}
          onChange={(e) => {
            const list = e.target.files
            if (list?.length) runImport(() => readFileList(list)).finally(() => (e.target.value = ''))
          }}
        />
        <input
          ref={zipInput}
          type="file"
          accept=".zip,application/zip"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) runImport(() => readZip(f)).finally(() => (e.target.value = ''))
          }}
        />
      </header>

      <main className="workspace">
        {showList && <WorkflowList onError={(m) => setNotice({ title: 'Something went wrong', lines: [m], error: true })} />}
        <div className="canvas">
          <ReactFlow
            nodes={nodes}
            edges={shownEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, n) => select({ kind: 'node', id: n.id })}
            onEdgeClick={(_, e) => select({ kind: 'edge', id: e.id })}
            onPaneClick={() => select(null)}
            onDoubleClick={(e) => {
              if (!(e.target as HTMLElement).classList.contains('react-flow__pane')) return
              addSkill('New skill', screenToFlowPosition({ x: e.clientX - 100, y: e.clientY - 30 }))
            }}
            zoomOnDoubleClick={false}
            deleteKeyCode={null}
            fitView
            fitViewOptions={{ padding: 0.2, minZoom: 0.1 }}
            minZoom={0.1}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={20} />
            <Controls fitViewOptions={{ padding: 0.15, minZoom: 0.1 }}>
              <ControlButton onClick={tidy} title="Tidy layout" aria-label="Tidy layout">
                ⇶
              </ControlButton>
            </Controls>
            <MiniMap pannable zoomable className="minimap" />
          </ReactFlow>
          {!ready && <div className="empty">Opening your workflows…</div>}
          {ready && !nodes.length && (
            <div className="empty">
              <p>Your canvas is empty.</p>
              <p className="muted">Click “+ Add skill” or double-click anywhere to drop your first skill.</p>
            </div>
          )}
          {notice && (
            <div className="notices">
              {notice && (
                <div className={`notice ${notice.error ? 'notice--error' : ''}`} role="status">
                  <div className="row">
                    <b>{notice.title}</b>
                    <span className="spacer" />
                    <button className="small" onClick={() => setNotice(null)} aria-label="Dismiss">
                      ✕
                    </button>
                  </div>
                  {notice.lines.length > 0 && (
                    <ul>
                      {notice.lines.map((l) => (
                        <li key={l}>{l}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
          <SimPanel />
        </div>
        <Inspector onOpenConnectors={(id) => setDialog({ kind: 'connectors', id })} />
      </main>

      {dialog?.kind === 'connectors' && <ConnectorsDialog initialId={dialog.id} onClose={closeDialog} />}
      {dialog?.kind === 'export' && <ExportDialog onClose={closeDialog} />}
    </div>
  )
}

export default function App() {
  return (
    <ReactFlowProvider>
      <Studio />
    </ReactFlowProvider>
  )
}
