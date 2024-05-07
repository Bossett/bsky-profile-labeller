import { AppBskyActorDefs } from '@atproto/api'
import { pdsLimit } from '@/lib/rateLimit.js'
import { agent } from '@/lib/bskyAgent.js'
import env from '@/lib/env.js'
import wait from '@/lib/wait.js'
import logger from '@/lib/logger.js'

const results = new Map<string, pendingResults>()

type pendingResults = {
  did: string
  completedDate?: number
  data?: AppBskyActorDefs.ProfileViewDetailed
  errorReason?: string
  failed: boolean
}

let batchExecuting = false
let lastBatchRun = Date.now()

function trackLimit() {
  if (results.size > env.limits.USER_DETAILS_MAX_SIZE * 2) {
    const initialSize = results.size
    const resultsArray = Array.from(results.entries())

    resultsArray.sort((a, b) => {
      const dateA = a[1].completedDate || 0
      const dateB = b[1].completedDate || 0
      return dateB - dateA
    })

    const topResults = resultsArray.slice(0, env.limits.USER_DETAILS_MAX_SIZE)

    results.clear()

    for (const [key, value] of topResults) {
      if (!isExpiredResult(value)) results.set(key, value)
    }
    return initialSize - results.size
  }
  return 0
}

async function executeBatch() {
  if (batchExecuting) {
    await wait(1)
    return true
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

  if (allActors.length < maxRequestChunk && Date.now() - lastBatchRun < 1000) {
    batchExecuting = false
    await wait(1)
    return true
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
            completedDate: Date.now(),
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
        completedDate: Date.now(),
      })
    }
  }

  lastBatchRun = Date.now()

  batchExecuting = false
  return true
}

function seededRandom(seed: number) {
  const a = 1664525
  const c = 1013904223
  const m = 2 ** 32 // 2 to the power of 32
  seed = (a * seed + c) % m
  return seed / m
}

function isExpiredResult(result: pendingResults) {
  if (result.completedDate === undefined) return false

  if (
    result.completedDate <
    Date.now() -
      (env.limits.USER_DETAILS_MIN_AGE_MS +
        Math.floor(seededRandom(result.completedDate)))
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
  lastScavengeCount = trackLimit()

  for (const [did, result] of results) {
    if (isExpiredResult(result)) {
      results.delete(did)
      lastScavengeCount++
    }
  }
}

export function purgeCacheForDid(did: string) {
  if (!did) return

  results.set(did, {
    ...(results.get(did) as pendingResults),
    completedDate: 0,
  })
  logger.debug(`cache purged for ${did}`)
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
        return data as AppBskyActorDefs.ProfileViewDetailed
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
  } while (await wait(1))

  return { error: 'unknown error' }
}

export default getUserDetails
