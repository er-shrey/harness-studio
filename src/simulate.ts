import { useStore } from './store'

/** Dry-run the flow on the canvas: walk from the start skills, pausing on each condition. */

let runToken = 0
let pendingAnswer: ((yes: boolean) => void) | null = null

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function answerCondition(yes: boolean) {
  const resolve = pendingAnswer
  pendingAnswer = null
  resolve?.(yes)
}

export function stopSimulation() {
  runToken++
  answerCondition(false)
  useStore.getState().resetSim()
}

export async function runSimulation(startId?: string) {
  const token = ++runToken
  const live = () => token === runToken
  const { nodes, edges, setSim, resetSim } = useStore.getState()
  resetSim()
  const sim = () => useStore.getState().sim
  const log = (line: string) => setSim({ log: [...sim().log, line] })
  const name = (id: string) => nodes.find((n) => n.id === id)?.data.name ?? id

  const starts = startId
    ? [startId]
    : nodes.filter((n) => !edges.some((e) => e.target === n.id)).map((n) => n.id)
  if (!starts.length) {
    setSim({ status: 'done', log: ['Every skill has an incoming link, so there is no start. Select a skill and run from it.'] })
    return
  }

  setSim({ status: 'running' })
  const queue = [...starts]
  const visited = new Set<string>()

  while (queue.length && live()) {
    const id = queue.shift()!
    if (visited.has(id)) {
      log(`↺ ${name(id)} already ran; not looping again in the dry run`)
      continue
    }
    visited.add(id)
    setSim({ activeNodeId: id, activeEdgeId: null, visitedNodes: [...visited] })
    log(`▶ ${name(id)}`)
    await sleep(900)

    for (const e of edges.filter((e) => e.source === id)) {
      if (!live()) return
      const condition = e.data?.condition?.trim()
      let pass = true
      if (condition && sim().mode === 'ask') {
        setSim({ askingEdgeId: e.id })
        pass = await new Promise<boolean>((resolve) => (pendingAnswer = resolve))
        if (!live()) return
        setSim({ askingEdgeId: null })
      }
      if (!pass) {
        setSim({ skippedEdges: [...sim().skippedEdges, e.id] })
        log(`  ✗ skipped ${name(e.target)}: “${condition}” did not hold`)
        continue
      }
      log(`  ✓ ${condition ? `“${condition}”` : 'always'} → ${name(e.target)}`)
      setSim({ activeEdgeId: e.id })
      await sleep(1100)
      setSim({ takenEdges: [...sim().takenEdges, e.id], activeEdgeId: null })
      queue.push(e.target)
    }
  }

  if (live()) {
    setSim({ status: 'done', activeNodeId: null, activeEdgeId: null })
    log('■ Flow finished')
  }
}
