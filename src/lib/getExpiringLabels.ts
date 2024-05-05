import { ComAtprotoLabelDefs } from '@atproto/api'

interface Params {
  labels: ComAtprotoLabelDefs.Label[]
  labeller: string
  watchedFrom: number
  handlesToExpire: string[]
}

interface Result {
  create?: string[]
  remove?: string[]
}

export async function getExpiringLabels({
  labels,
  labeller,
  watchedFrom,
  handlesToExpire,
}: Params): Promise<Result> {
  if (!labeller) return { create: [], remove: [] }

  const operations: { create: string[]; remove: string[] } = {
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
