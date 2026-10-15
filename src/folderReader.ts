import JSZip from 'jszip'
import type { InFile } from './importer'

/** Read a picked folder or zip into text files, skipping build output, binaries and anything secret-looking. */

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '__pycache__', '.venv', 'venv', '.next', '.cache'])
const TEXT_EXT = /\.(md|markdown|ya?ml|json|txt|sh|py|js|mjs|cjs|ts|toml|ini|cfg|csv|html|sql)$/i
// Never pull credentials into the browser, even though nothing leaves it.
const SECRET = /(^|\/)(\.env(\..*)?|[^/]*\.env|[^/]*\.(pem|key|p12|pfx)|id_[a-z0-9]+|[^/]*(secret|credential|token)[^/]*)$/i
const MAX_FILE = 512_000
const MAX_FILES = 3000

export type ReadResult = { name: string; files: InFile[]; skipped: number }

const keep = (path: string, size: number) =>
  TEXT_EXT.test(path) && !SECRET.test(path) && size <= MAX_FILE && !path.split('/').some((p) => SKIP_DIRS.has(p))

type DirHandle = {
  name: string
  kind: 'directory'
  values: () => AsyncIterable<DirHandle | FileHandle>
}
type FileHandle = { name: string; kind: 'file'; getFile: () => Promise<File> }

export const canPickDirectory = () => typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'

/** Chromium's File System Access API. Returns null when the user cancels. */
export async function pickDirectory(): Promise<ReadResult | null> {
  let dir: DirHandle
  try {
    dir = await (window as unknown as { showDirectoryPicker: (o?: object) => Promise<DirHandle> }).showDirectoryPicker({
      mode: 'read',
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') return null
    throw e
  }
  const files: InFile[] = []
  let skipped = 0
  const walk = async (d: DirHandle, prefix: string) => {
    for await (const entry of d.values()) {
      if (files.length >= MAX_FILES) return
      const path = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.kind === 'directory') {
        if (!SKIP_DIRS.has(entry.name)) await walk(entry, path)
        continue
      }
      const file = await entry.getFile()
      if (keep(path, file.size)) files.push({ path, content: await file.text() })
      else skipped++
    }
  }
  await walk(dir, '')
  return { name: dir.name, files, skipped }
}

/** Fallback for <input webkitdirectory>: paths start with the picked folder's name. */
export async function readFileList(list: FileList): Promise<ReadResult> {
  const files: InFile[] = []
  let skipped = 0
  let name = 'Imported folder'
  for (const f of [...list]) {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name
    const [top, ...rest] = rel.split('/')
    name = top
    const path = rest.join('/') || top
    if (files.length < MAX_FILES && keep(path, f.size)) files.push({ path, content: await f.text() })
    else skipped++
  }
  return { name, files, skipped }
}

export async function readZip(file: File): Promise<ReadResult> {
  const zip = await JSZip.loadAsync(file)
  const files: InFile[] = []
  let skipped = 0
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue
    const content = await entry.async('string')
    if (files.length < MAX_FILES && keep(entry.name, content.length)) files.push({ path: entry.name, content })
    else skipped++
  }
  // A zip of one folder: strip that folder so paths start at its contents.
  const tops = new Set(files.map((f) => f.path.split('/')[0]))
  const name = file.name.replace(/\.zip$/i, '')
  if (tops.size === 1 && files.every((f) => f.path.includes('/'))) {
    const [top] = tops
    return { name: top, files: files.map((f) => ({ ...f, path: f.path.slice(top.length + 1) })), skipped }
  }
  return { name, files, skipped }
}
