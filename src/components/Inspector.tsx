import { useRef, useState } from 'react'
import { confirmDelete, useStore } from '../store'
import { missingConnectors } from '../connectors'
import type { SkillNode } from '../types'

const readFiles = (files: FileList) =>
  Promise.all([...files].map(async (f) => ({ name: f.name, content: await f.text() })))

export default function Inspector({ onOpenConnectors }: { onOpenConnectors: (id?: string) => void }) {
  const node = useStore((s) => (s.selection?.kind === 'node' ? s.nodes.find((n) => n.id === s.selection!.id) : undefined))
  const edge = useStore((s) => (s.selection?.kind === 'edge' ? s.edges.find((e) => e.id === s.selection!.id) : undefined))

  if (node) return <NodeInspector key={node.id} node={node} onOpenConnectors={onOpenConnectors} />
  if (edge) return <EdgeInspector key={edge.id} id={edge.id} />
  return <ProjectInspector onOpenConnectors={onOpenConnectors} />
}

function ProjectInspector({ onOpenConnectors }: { onOpenConnectors: (id?: string) => void }) {
  const { name, description, nodes, edges, connectors, setMeta } = useStore()
  return (
    <div className="inspector">
      <h2>Harness</h2>
      <label>
        Name
        <input value={name} onChange={(e) => setMeta({ name: e.target.value })} />
      </label>
      <label>
        Description <span className="hint">becomes the skill's trigger description</span>
        <textarea rows={4} value={description} onChange={(e) => setMeta({ description: e.target.value })} />
      </label>
      <p className="muted">
        {nodes.length} skills · {edges.length} links · {Object.keys(connectors).length} connectors
      </p>
      <button onClick={() => onOpenConnectors()}>Edit connectors</button>
      <div className="help">
        <h3>How to use</h3>
        <ul>
          <li>
            <b>Add skill</b> in the toolbar, or double-click the canvas.
          </li>
          <li>Drag from a skill's right dot to another skill to link them.</li>
          <li>Click a link's label to set its condition.</li>
          <li>Select a skill to add instructions, attach .md / .yaml files, and attach connectors.</li>
          <li>
            <b>Simulate</b> walks the flow and asks you to decide each condition.
          </li>
          <li>Remove the selected skill or link with its Delete button, the ✕ on the canvas, or the Delete / Backspace key.</li>
        </ul>
      </div>
    </div>
  )
}

function NodeInspector({ node, onOpenConnectors }: { node: SkillNode; onOpenConnectors: (id?: string) => void }) {
  const { updateSkill, addAttachments, updateAttachment, removeAttachment, attachConnector, detachConnector, connectors } =
    useStore()
  const fileInput = useRef<HTMLInputElement>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const d = node.data
  const suggestions = missingConnectors(d, connectors)
  const unattachedCatalog = Object.values(connectors).filter((c) => !d.connectorIds.includes(c.id))

  return (
    <div className="inspector">
      <div className="row inspector-head">
        <h2>Skill</h2>
        <span className="spacer" />
        <button className="small danger" onClick={confirmDelete}>
          Delete skill
        </button>
      </div>
      {d.sourcePath && (
        <p className="muted source-path">
          Imported from <code>{d.sourcePath}</code>
        </p>
      )}
      <label>
        Name
        <input autoFocus={!d.name} value={d.name} onChange={(e) => updateSkill(node.id, { name: e.target.value })} />
      </label>
      <label>
        Description
        <input value={d.description} onChange={(e) => updateSkill(node.id, { description: e.target.value })} />
      </label>
      <label>
        Instructions <span className="hint">what Claude does at this step</span>
        <textarea rows={5} value={d.instructions} onChange={(e) => updateSkill(node.id, { instructions: e.target.value })} />
      </label>

      <section>
        <div className="section-head">
          <h3>Attached files</h3>
          <button className="small" onClick={() => fileInput.current?.click()}>
            Upload
          </button>
          <button
            className="small"
            onClick={() => addAttachments(node.id, [{ name: `note-${d.attachments.length + 1}.md`, content: '# Notes\n' }])}
          >
            New note
          </button>
        </div>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept=".md,.markdown,.yaml,.yml,.txt,.json"
          hidden
          onChange={async (e) => {
            if (e.target.files?.length) addAttachments(node.id, await readFiles(e.target.files))
            e.target.value = ''
          }}
        />
        {!d.attachments.length && <p className="muted">Skill files, reference docs or YAML config used at this step.</p>}
        <ul className="attachments">
          {d.attachments.map((a) => (
            <li key={a.id}>
              <div className="attachment-row">
                <button className="link" onClick={() => setOpenId(openId === a.id ? null : a.id)}>
                  {openId === a.id ? '▾' : '▸'} {a.name}
                </button>
                <button className="small danger" onClick={() => removeAttachment(node.id, a.id)} aria-label={`Remove ${a.name}`}>
                  ✕
                </button>
              </div>
              {openId === a.id && (
                <div className="attachment-edit">
                  <input value={a.name} onChange={(e) => updateAttachment(node.id, a.id, { name: e.target.value })} />
                  <textarea
                    rows={8}
                    className="mono"
                    value={a.content}
                    onChange={(e) => updateAttachment(node.id, a.id, { content: e.target.value })}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <div className="section-head">
          <h3>MCP connectors</h3>
        </div>
        {d.connectorIds.map((id) => (
          <div key={id} className="connector-row">
            <button className="link" onClick={() => onOpenConnectors(id)}>
              {connectors[id]?.label ?? id}
            </button>
            <button className="small danger" onClick={() => detachConnector(node.id, id)} aria-label="Detach">
              ✕
            </button>
          </div>
        ))}
        {suggestions.map((s) => (
          <div key={s.connector.id} className="suggestion">
            <span>
              ⚠ Needs <b>{s.connector.label}</b>
              <span className="hint"> ({s.reason})</span>
            </span>
            <button className="small primary" onClick={() => attachConnector(node.id, connectors[s.connector.id] ?? s.connector)}>
              Attach
            </button>
          </div>
        ))}
        {unattachedCatalog.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              const c = connectors[e.target.value]
              if (c) attachConnector(node.id, c)
            }}
          >
            <option value="">+ Attach an existing connector…</option>
            {unattachedCatalog.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        )}
      </section>
    </div>
  )
}

function EdgeInspector({ id }: { id: string }) {
  const edge = useStore((s) => s.edges.find((e) => e.id === id))!
  const nodes = useStore((s) => s.nodes)
  const updateEdge = useStore((s) => s.updateEdge)
  const name = (nid: string) => nodes.find((n) => n.id === nid)?.data.name ?? '?'
  return (
    <div className="inspector">
      <div className="row inspector-head">
        <h2>Link</h2>
        <span className="spacer" />
        <button className="small danger" onClick={confirmDelete}>
          Delete link
        </button>
      </div>
      <p>
        <b>{name(edge.source)}</b> → <b>{name(edge.target)}</b>
      </p>
      <label>
        Continue only if…
        <textarea
          autoFocus
          rows={4}
          placeholder="e.g. the message links a pull request and tags me"
          value={edge.data?.condition ?? ''}
          onChange={(e) => updateEdge(id, e.target.value)}
        />
      </label>
      <p className="muted">
        Write it in plain language. Claude checks it against what the previous step found. Leave it empty to always
        continue.
      </p>
    </div>
  )
}
