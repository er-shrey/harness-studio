import { create } from 'zustand'
import { emptyProject, uid, useStore } from './store'
import { exampleProject } from './example'
import { stopSimulation } from './simulate'
import { openStorage, type WorkflowMeta, type WorkflowStorage } from './storage'
import type { Project } from './types'

/**
 * The list of saved workflows and which one is open in the editor. The editor store
 * (store.ts) holds only the open workflow; this module loads it in and autosaves it out.
 */

type SaveStatus = 'saved' | 'saving' | 'error'

type WorkflowsState = {
  ready: boolean
  list: WorkflowMeta[]
  currentId: string | null
  status: SaveStatus
  error: string
  storageKind: WorkflowStorage['kind'] | null
}

export const useWorkflows = create<WorkflowsState>()(() => ({
  ready: false,
  list: [],
  currentId: null,
  status: 'saved',
  error: '',
  storageKind: null,
}))

let storage: WorkflowStorage
const LAST_OPEN = 'harness-studio:last-open'
const LEGACY_KEY = 'harness-studio:project'
const SAVE_DELAY = 400

const set = useWorkflows.setState
const get = useWorkflows.getState

// Other tabs: refresh the list when they save, create or delete.
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('harness-studio') : null
const announce = () => channel?.postMessage('changed')

const readLocal = (k: string) => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
const writeLocal = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k)
    else localStorage.setItem(k, v)
  } catch {
    /* only a convenience */
  }
}

/** "Name", or "Name (2)", "Name (3)"… so every workflow in the list can be told apart. */
export function uniqueName(base: string, exceptId?: string): string {
  const name = base.trim() || 'Untitled workflow'
  const taken = new Set(get().list.filter((w) => w.id !== exceptId).map((w) => w.name.toLowerCase()))
  if (!taken.has(name.toLowerCase())) return name
  const stem = name.replace(/ \(\d+\)$/, '')
  for (let i = 2; ; i++) if (!taken.has(`${stem} (${i})`.toLowerCase())) return `${stem} (${i})`
}

export const isNameTaken = (name: string, exceptId?: string) =>
  get().list.some((w) => w.id !== exceptId && w.name.toLowerCase() === name.trim().toLowerCase())

const metaFor = (id: string, p: Project, createdAt: number): WorkflowMeta => ({
  id,
  name: p.name,
  description: p.description,
  nodeCount: p.nodes.length,
  edgeCount: p.edges.length,
  createdAt,
  updatedAt: Date.now(),
})

async function refreshList() {
  set({ list: await storage.list() })
}

// ---------- autosave ----------

/** JSON of the project as last saved (or loaded), so selection or hover changes don't count as edits. */
let savedJson = ''
let timer: ReturnType<typeof setTimeout> | undefined
let suppress = false

async function saveNow() {
  clearTimeout(timer)
  timer = undefined
  const id = get().currentId
  if (!id) return
  const project = useStore.getState().toProject()
  const json = JSON.stringify(project)
  if (json === savedJson) return
  set({ status: 'saving' })
  try {
    const createdAt = get().list.find((w) => w.id === id)?.createdAt ?? Date.now()
    const meta = metaFor(id, project, createdAt)
    await storage.save(meta, project)
    savedJson = json
    set({
      status: 'saved',
      error: '',
      list: [meta, ...get().list.filter((w) => w.id !== id)],
    })
    announce()
  } catch (e) {
    set({ status: 'error', error: (e as Error).message || 'Could not save' })
  }
}

/** Save any pending edit right away, e.g. before switching workflows. */
export const flushSave = () => (timer ? saveNow() : Promise.resolve())

useStore.subscribe((s, prev) => {
  if (suppress || !get().currentId) return
  if (
    s.nodes === prev.nodes &&
    s.edges === prev.edges &&
    s.connectors === prev.connectors &&
    s.name === prev.name &&
    s.description === prev.description
  )
    return
  clearTimeout(timer)
  timer = setTimeout(saveNow, SAVE_DELAY)
})

window.addEventListener('pagehide', () => void flushSave())

// ---------- operations ----------

function show(id: string, p: Project) {
  stopSimulation()
  suppress = true
  useStore.getState().loadProject(p)
  suppress = false
  savedJson = JSON.stringify(useStore.getState().toProject())
  set({ currentId: id })
  writeLocal(LAST_OPEN, id)
}

export async function openWorkflow(id: string) {
  if (id === get().currentId) return
  await flushSave()
  const p = await storage.load(id)
  if (!p) {
    await refreshList()
    throw new Error('That workflow no longer exists.')
  }
  show(id, p)
}

/** Save a project as a new workflow and open it. */
export async function createWorkflow(p: Project): Promise<string> {
  await flushSave()
  const id = `w-${uid()}`
  const project = { ...p, name: uniqueName(p.name) }
  const meta = metaFor(id, project, Date.now())
  await storage.save(meta, project)
  set({ list: [meta, ...get().list] })
  show(id, project)
  announce()
  return id
}

export const newWorkflow = () => createWorkflow({ ...emptyProject(), name: 'Untitled workflow' })

export async function renameWorkflow(id: string, name: string) {
  const clean = name.trim()
  if (!clean) throw new Error('A workflow needs a name.')
  if (isNameTaken(clean, id)) throw new Error(`There is already a workflow called “${clean}”.`)
  if (id === get().currentId) {
    useStore.getState().setMeta({ name: clean })
    await saveNow()
    return
  }
  const p = await storage.load(id)
  const old = get().list.find((w) => w.id === id)
  if (!p || !old) return
  const project = { ...p, name: clean }
  const meta = { ...metaFor(id, project, old.createdAt) }
  await storage.save(meta, project)
  set({ list: get().list.map((w) => (w.id === id ? meta : w)).sort((a, b) => b.updatedAt - a.updatedAt) })
  announce()
}

export async function duplicateWorkflow(id: string) {
  await flushSave()
  const p = await storage.load(id)
  if (!p) return
  await createWorkflow({ ...structuredClone(p), name: `${p.name} copy` })
}

export async function deleteWorkflow(id: string) {
  if (id === get().currentId) {
    clearTimeout(timer)
    timer = undefined
  }
  await storage.remove(id)
  const list = get().list.filter((w) => w.id !== id)
  set({ list })
  announce()
  if (id !== get().currentId) return
  if (list.length) await openFirst(list[0].id)
  else await newWorkflow()
}

async function openFirst(id: string) {
  const p = await storage.load(id)
  if (p) show(id, p)
}

let booting: Promise<void> | undefined

/** Boot once (React's StrictMode calls effects twice in development). */
export const initWorkflows = () => (booting ??= boot())

/** Open storage, move the old single-project autosave across, open the last workflow. */
async function boot() {
  storage = await openStorage()
  set({ storageKind: storage.kind })
  await refreshList()

  const legacy = readLocal(LEGACY_KEY)
  if (legacy) {
    try {
      const state = (JSON.parse(legacy) as { state?: Omit<Project, 'version'> }).state
      if (state?.nodes?.length) await createWorkflow({ version: 1, ...state })
      writeLocal(LEGACY_KEY, null)
    } catch {
      /* unreadable old save: leave it for a later version to look at */
    }
  }

  const list = get().list
  if (!get().currentId) {
    const last = readLocal(LAST_OPEN)
    const target = list.find((w) => w.id === last) ?? list[0]
    if (target) await openFirst(target.id)
    else await createWorkflow(exampleProject())
  }
  set({ ready: true })

  channel?.addEventListener('message', () => void refreshList())
}
