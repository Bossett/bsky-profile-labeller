import { plcLimit } from '@/env/rateLimit.js'
import CachedFetch from '@/lib/CachedFetch.js'
import env from '@/env/env.js'
import * as plc from '@did-plc/lib'

const plcFetch = new CachedFetch({
  maxAge: env.limits.PLC_DIRECTORY_MAX_AGE_MS,
  maxSize: env.limits.PLC_DIRECTORY_MAX_SIZE,
  limiter: plcLimit,
  maxBatch: env.limits.PLC_LIMIT_MAX_CONCURRENT,
})

export function cacheStatistics() {
  return plcFetch.cacheStatistics()
}

export function purgeCacheForDid(did: string, time?: number) {
  return plcFetch.purgeCacheForKey(
    `${env.PLC_DIRECTORY}/${did}/log/audit`,
    time,
  )
}

async function getPlcOperations(
  did: string,
): Promise<plc.ExportedOp[] | { error: string }> {
  let res: plc.ExportedOp[]
  try {
    res = await plcFetch.getJson(`${env.PLC_DIRECTORY}/${did}/log/audit`)
  } catch (e) {
    return { error: e.message }
  }

  if (res) {
    res.sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    )
    return res as plc.ExportedOp[]
  } else return res as { error: string }
}

export async function getPlcPDS(did: string): Promise<string | undefined> {
  const plcOperations = await getPlcOperations(did)
  if ('error' in plcOperations) return undefined

  let pds: string = ''

  for (const op of plcOperations) {
    if (
      op.operation.type === 'plc_operation' &&
      op.operation?.services?.atproto_pds?.endpoint !== undefined
    ) {
      pds = op.operation?.services?.atproto_pds.endpoint
    }
  }
  return pds
}

async function getPlcHandleHistory(did: string) {
  const plcOperations = await getPlcOperations(did)

  if ('error' in plcOperations) return []

  const handles: { handle: string; createdAt: Date }[] = []

  let previousHandle: string = ''

  for (const op of plcOperations) {
    if (
      op.operation.type === 'plc_operation' &&
      op.operation?.alsoKnownAs.length > 0
    ) {
      const alsoKnownAs = op.operation.alsoKnownAs.filter((value) =>
        value.startsWith('at://'),
      )

      const handle = alsoKnownAs[0]?.split('at://')[1]
      const createdAt = new Date(op.createdAt)

      if (handle !== previousHandle) {
        previousHandle = handle
        handles.push({ handle: handle, createdAt: createdAt })
      }
    }
  }

  return handles
}

export default getPlcHandleHistory
