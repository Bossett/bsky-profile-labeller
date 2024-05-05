import { AppBskyActorDefs } from '@atproto/api'
import { pdsLimit } from '@/lib/rateLimit.js'
import { agent } from '@/lib/bskyAgent.js'
import env from '@/lib/env.js'
import wait from '@/lib/wait.js'

const results = new Map<string, pendingResults>()

type pendingResults = {
  did: string
  completedDate?: Date
  data?: AppBskyActorDefs.ProfileViewDetailed
  errorReason?: string
  failed: boolean
}

let batchExecuting = false
let lastBatchRun = Date.now()

async function executeBatch() {
  if (batchExecuting) {
    return
  }

  batchExecuting = true

  const maxRequestChunk = 25
  const getProfiles = (actors: string[]) =>
    pdsLimit(() => agent.app.bsky.actor.getProfiles({ actors: actors }))

  const batchDids = Array.from(results.keys()).sort()

  const allActors: string[] = batchDids.filter((did) => {
    const result = results.get(did)
    if (!result) return false
    if (isFailedResult(result)) return false
    if (result.completedDate === undefined) return true
  })

  if (allActors.length < maxRequestChunk && Date.now() - lastBatchRun < 10000) {
    batchExecuting = false
    return
  }

  const sliceAt = allActors.length - (allActors.length % maxRequestChunk)

  const actors = allActors.slice(0, sliceAt > 0 ? sliceAt : allActors.length)

  const foundActors = new Set<string>()

  try {
    for (let i = 0; i < actors.length; i += maxRequestChunk) {
      const actorsChunk = actors.slice(i, i + maxRequestChunk)
      const res = await getProfiles(actorsChunk)
      const profiles = res.data.profiles.reduce(
        (map, profile) => ({ ...map, [profile.did]: profile }),
        {},
      )

      for (const did of actors) {
        if (profiles[did]) {
          results.set(did, {
            data: profiles[did],
            completedDate: new Date(),
            did: did,
            failed: false,
          })
          foundActors.add(did)
        }
      }
    }
  } catch (e) {
    batchExecuting = false
    return
  }

  for (const did of actors) {
    if (!foundActors.has(did)) {
      results.set(did, {
        did: did,
        failed: true,
        errorReason: 'not found',
        completedDate: new Date(),
      })
    }
  }

  lastBatchRun = Date.now()

  batchExecuting = false
  return
}

function isExpiredResult(result: pendingResults) {
  if (result.completedDate === undefined) return false

  if (
    result.completedDate.getTime() <
    Date.now() - env.limits.USER_DETAILS_MAX_AGE_MS
  ) {
    return true
  } else return false
}

function isFailedResult(result: pendingResults) {
  if (isExpiredResult(result)) return false
  return result.failed
}

let globalCacheHit = 0
let globalCacheMiss = 0
let lastScavengeCount = 0

export function cacheStatistics() {
  const hitRate = () =>
    100 * (globalCacheHit / (globalCacheHit + globalCacheMiss))
  return {
    cacheHit: globalCacheHit,
    cacheMiss: globalCacheMiss,
    hitRate: isNaN(hitRate()) ? () => 0 : hitRate,
    items: () => results.size,
    recentExpired: () => lastScavengeCount,
    reset: () => {
      globalCacheHit = 0
      globalCacheMiss = 0
      scavengeExpired()
    },
  }
}

function scavengeExpired() {
  lastScavengeCount = 0
  for (const [did, result] of results) {
    if (isExpiredResult(result)) {
      results.delete(did)
      lastScavengeCount++
    }
  }
}

async function getUserDetails(
  did: string,
): Promise<AppBskyActorDefs.ProfileViewDetailed | { error: string }> {
  let cacheHit = true
  do {
    const result = results.get(did)

    if (result && isExpiredResult(result)) {
      results.delete(did)
      continue
    }

    if (result && isFailedResult(result)) {
      if (cacheHit) globalCacheHit++
      return {
        error:
          (`${results.get(did)?.errorReason}` || 'unknown') +
          `${cacheHit ? ' (cached)' : ''}`,
      }
    }

    if (result) {
      const data = result.data
      if (data?.did) {
        if (cacheHit) globalCacheHit++
        return structuredClone(data) as AppBskyActorDefs.ProfileViewDetailed
      }
    } else {
      globalCacheMiss++
      results.set(did, {
        did: did,
        failed: false,
        data: undefined,
        completedDate: undefined,
        errorReason: undefined,
      })
    }

    await executeBatch()
  } while (await wait(500))

  return { error: 'unknown error' }
}

export default getUserDetails
