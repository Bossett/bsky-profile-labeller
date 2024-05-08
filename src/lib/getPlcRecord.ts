import { plcLimit } from '@/env/rateLimit.js'
import CachedFetch from '@/lib/CachedFetch.js'
import env from '@/env/env.js'

const plcFetch = new CachedFetch({
  maxAge: env.limits.PLC_DIRECTORY_MAX_AGE_MS,
  maxSize: env.limits.PLC_DIRECTORY_MAX_SIZE,
  limiter: plcLimit,
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

async function getPlcRecord(did: string) {
  const res = await plcFetch.getJson(`${env.PLC_DIRECTORY}/${did}/log/audit`)

  if (res.error) return []

  const plcJson = res as {
    did: string
    createdAt: string
    operation: { alsoKnownAs?: string[] }
  }[]

  const handles: { handle: string; createdAt: Date }[] = []

  plcJson.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  )

  let previousHandle: string = ''

  for (const op of plcJson) {
    if (op.operation?.alsoKnownAs === undefined) break
    const handle = op.operation.alsoKnownAs[0]?.split('at://')[1]
    const createdAt = new Date(op.createdAt)

    if (handle !== previousHandle) {
      previousHandle = handle
      handles.push({ handle: handle, createdAt: createdAt })
    }
  }

  return handles
}

export default getPlcRecord
