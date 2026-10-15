import type { Project } from './types'

/** What the workflow list shows, kept apart from the (possibly large) project body. */
export type WorkflowMeta = {
  id: string
  name: string
  description: string
  nodeCount: number
  edgeCount: number
  createdAt: number
  updatedAt: number
}

/**
 * Everything the app needs from persistence. IndexedDB implements it today; a local or
 * hosted backend can implement the same five calls later without touching the UI.
 */
export interface WorkflowStorage {
  readonly kind: 'indexeddb' | 'memory'
  list(): Promise<WorkflowMeta[]>
  load(id: string): Promise<Project | undefined>
  save(meta: WorkflowMeta, project: Project): Promise<void>
  remove(id: string): Promise<void>
}

const DB_NAME = 'harness-studio'
const DB_VERSION = 1
const META = 'meta'
const PROJECTS = 'projects'

const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'))
  })

class IndexedDbStorage implements WorkflowStorage {
  readonly kind = 'indexeddb' as const
  private db: Promise<IDBDatabase>

  constructor() {
    this.db = new Promise((resolve, reject) => {
      const open = indexedDB.open(DB_NAME, DB_VERSION)
      open.onupgradeneeded = () => {
        const db = open.result
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'id' })
        if (!db.objectStoreNames.contains(PROJECTS)) db.createObjectStore(PROJECTS)
      }
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
      open.onblocked = () => reject(new Error('The database is blocked by another tab'))
    })
  }

  async list() {
    const db = await this.db
    const all = await req(db.transaction(META).objectStore(META).getAll() as IDBRequest<WorkflowMeta[]>)
    return all.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async load(id: string) {
    const db = await this.db
    return req(db.transaction(PROJECTS).objectStore(PROJECTS).get(id) as IDBRequest<Project | undefined>)
  }

  async save(meta: WorkflowMeta, project: Project) {
    const db = await this.db
    const tx = db.transaction([META, PROJECTS], 'readwrite')
    tx.objectStore(META).put(meta)
    tx.objectStore(PROJECTS).put(project, meta.id)
    await done(tx)
  }

  async remove(id: string) {
    const db = await this.db
    const tx = db.transaction([META, PROJECTS], 'readwrite')
    tx.objectStore(META).delete(id)
    tx.objectStore(PROJECTS).delete(id)
    await done(tx)
  }
}

/** Fallback when IndexedDB is unavailable (some private modes): works, but forgets on reload. */
class MemoryStorage implements WorkflowStorage {
  readonly kind = 'memory' as const
  private meta = new Map<string, WorkflowMeta>()
  private projects = new Map<string, Project>()
  async list() {
    return [...this.meta.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  }
  async load(id: string) {
    return structuredClone(this.projects.get(id))
  }
  async save(meta: WorkflowMeta, project: Project) {
    this.meta.set(meta.id, meta)
    this.projects.set(meta.id, structuredClone(project))
  }
  async remove(id: string) {
    this.meta.delete(id)
    this.projects.delete(id)
  }
}

/** Open IndexedDB, falling back to memory if it can't be used at all. */
export async function openStorage(): Promise<WorkflowStorage> {
  try {
    if (typeof indexedDB === 'undefined') throw new Error('No IndexedDB')
    const s = new IndexedDbStorage()
    await s.list()
    return s
  } catch {
    return new MemoryStorage()
  }
}
