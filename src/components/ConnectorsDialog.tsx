import { useState } from 'react'
import { useStore } from '../store'
import { CATALOG } from '../connectors'
import { buildConnectorsYaml, buildMcpJson, connectorFromYaml, connectorToYaml, download, slug } from '../exporter'
import Modal from './Modal'

export default function ConnectorsDialog({ initialId, onClose }: { initialId?: string; onClose: () => void }) {
  const { connectors, nodes, upsertConnector, removeConnector, name } = useStore()
  const ids = Object.keys(connectors)
  const [current, setCurrent] = useState<string | undefined>(initialId ?? ids[0])
  const [idDraft, setIdDraft] = useState(current ?? '')
  const [text, setText] = useState(current && connectors[current] ? connectorToYaml(connectors[current]) : '')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const open = (id: string) => {
    setCurrent(id)
    setIdDraft(id)
    setText(connectorToYaml(useStore.getState().connectors[id]))
    setError('')
    setSaved(false)
  }

  const apply = () => {
    try {
      const id = slug(idDraft)
      if (id !== current && connectors[id]) throw new Error(`A connector called “${id}” already exists`)
      upsertConnector(connectorFromYaml(id, text), current)
      setCurrent(id)
      setIdDraft(id)
      setError('')
      setSaved(true)
    } catch (e) {
      setError((e as Error).message)
      setSaved(false)
    }
  }

  const addFromCatalog = (id: string) => {
    if (id === '__custom') {
      let n = 1
      while (connectors[`custom-${n}`]) n++
      upsertConnector({ id: `custom-${n}`, label: `Custom ${n}`, transport: 'stdio', command: '<command>' })
      open(`custom-${n}`)
      return
    }
    const t = CATALOG.find((c) => c.template.id === id)?.template
    if (!t) return
    if (!connectors[id]) upsertConnector(t)
    open(id)
  }

  const all = Object.values(connectors)
  const usedBy = (id: string) => nodes.filter((n) => n.data.connectorIds.includes(id)).map((n) => n.data.name)

  return (
    <Modal title="MCP connectors" onClose={onClose} wide>
      <div className="connectors">
        <aside>
          <ul>
            {ids.map((id) => (
              <li key={id}>
                <button className={id === current ? 'active' : ''} onClick={() => open(id)}>
                  <b>{connectors[id].label}</b>
                  <span className="hint">{usedBy(id).length ? `used by ${usedBy(id).length}` : 'unused'}</span>
                </button>
              </li>
            ))}
          </ul>
          <select value="" onChange={(e) => addFromCatalog(e.target.value)}>
            <option value="">+ Add connector…</option>
            {CATALOG.filter((c) => !connectors[c.template.id]).map((c) => (
              <option key={c.template.id} value={c.template.id}>
                {c.template.label}
              </option>
            ))}
            <option value="__custom">Custom…</option>
          </select>
        </aside>
        <div className="connector-editor">
          {current && connectors[current] ? (
            <>
              <label>
                Server key <span className="hint">the name in .mcp.json, and the prefix of its tools (mcp__key__…)</span>
                <input value={idDraft} onChange={(e) => setIdDraft(e.target.value)} />
              </label>
              <label>
                Config (YAML)
                <textarea
                  className="mono"
                  rows={14}
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value)
                    setSaved(false)
                  }}
                />
              </label>
              <p className="muted">
                Use <code>${'{'}VAR{'}'}</code> placeholders for secrets. Claude Code expands them from your environment,
                so no token is stored here.
              </p>
              {usedBy(current).length > 0 && <p className="muted">Used by: {usedBy(current).join(', ')}</p>}
              {error && <p className="error">{error}</p>}
              <div className="row">
                <button className="primary" onClick={apply}>
                  Apply
                </button>
                {saved && <span className="ok">Saved</span>}
                <span className="spacer" />
                <button
                  className="danger"
                  onClick={() => {
                    removeConnector(current)
                    const next = ids.find((i) => i !== current)
                    if (next) open(next)
                    else setCurrent(undefined)
                  }}
                >
                  Delete
                </button>
              </div>
            </>
          ) : (
            <p className="muted">No connectors yet. Add one from the list, or attach a suggested one from a skill.</p>
          )}
        </div>
      </div>
      <footer className="row">
        <span className="muted">Export these on their own, without the skill:</span>
        <span className="spacer" />
        <button disabled={!all.length} onClick={() => download('.mcp.json', buildMcpJson(all), 'application/json')}>
          Download .mcp.json
        </button>
        <button
          disabled={!all.length}
          onClick={() => download(`${slug(name)}-connectors.yaml`, buildConnectorsYaml(all), 'text/yaml')}
        >
          Download connectors.yaml
        </button>
      </footer>
    </Modal>
  )
}
