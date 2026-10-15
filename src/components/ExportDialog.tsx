import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { buildBundle, buildMcpJson, buildSkillMd, download, exportWarnings, slug, usedConnectors } from '../exporter'
import Modal from './Modal'

export default function ExportDialog({ onClose }: { onClose: () => void }) {
  const toProject = useStore((s) => s.toProject)
  const project = useMemo(() => toProject(), [toProject])
  const skillMd = useMemo(() => buildSkillMd(project), [project])
  const warnings = useMemo(() => exportWarnings(project), [project])
  const connectors = usedConnectors(project)
  const [copied, setCopied] = useState(false)
  const name = slug(project.name)

  const files = [
    `${name}/SKILL.md`,
    ...project.nodes.flatMap((n) => n.data.attachments.map((a) => `${name}/references/${slug(n.data.name)}/${a.name}`)),
    ...(connectors.length ? [`${name}/.mcp.json`, `${name}/connectors.yaml`] : []),
    `${name}/harness.json`,
  ]

  return (
    <Modal title="Generate workflow skill" onClose={onClose} wide>
      {warnings.length > 0 && (
        <div className="warnings">
          <b>Check before you use it</b>
          <ul>
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="export">
        <aside>
          <h3>Bundle contents</h3>
          <ul className="file-list">
            {files.map((f) => (
              <li key={f} className="mono">
                {f}
              </li>
            ))}
          </ul>
          <p className="muted">
            Unzip into <code>~/.claude/skills/</code> (personal) or <code>.claude/skills/</code> in a repo. Copy{' '}
            <code>.mcp.json</code> to the project root to register the connectors. <code>harness.json</code> reopens this
            graph in Harness Studio.
          </p>
        </aside>
        <div className="preview">
          <div className="row">
            <h3>SKILL.md</h3>
            <span className="spacer" />
            <button
              className="small"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(skillMd)
                  setCopied(true)
                } catch {
                  setCopied(false)
                }
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre className="mono">{skillMd}</pre>
        </div>
      </div>
      <footer className="row">
        <button onClick={() => download('SKILL.md', skillMd, 'text/markdown')}>SKILL.md only</button>
        <button disabled={!connectors.length} onClick={() => download('.mcp.json', buildMcpJson(connectors), 'application/json')}>
          .mcp.json only
        </button>
        <span className="spacer" />
        <button className="primary" onClick={async () => download(`${name}.zip`, await buildBundle(project))}>
          Download skill bundle (.zip)
        </button>
      </footer>
    </Modal>
  )
}
