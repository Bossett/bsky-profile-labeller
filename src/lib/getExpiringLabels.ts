import { ComAtprotoLabelDefs } from '@atproto/api'
import { OperationsResult } from '@/lib/insertOperations.js'

interface Params {
  labels: ComAtprotoLabelDefs.Label[]
  labeller: string
  watchedFrom: number
  handlesToExpire: string[]
}

export async function getExpiringLabels({
  labels,
  labeller,
  watchedFrom,
  handlesToExpire,
}: Params): Promise<OperationsResult> {
  if (!labeller) return { create: [], remove: [] }

  const operations: OperationsResult = {
    create: [],
    remove: [],
  }

  for (const label of labels) {
    if (label.src !== labeller) continue
    if (!handlesToExpire.includes(label.val)) continue

    if (new Date(label.cts).getTime() < watchedFrom) {
      operations.remove.push(label.val)
    }
  }

  return operations
}
