import { AppBskyFeedGetAuthorFeed } from '@atproto/api'
import { retryLimit } from '@/lib/rateLimit.js'

import env from '@/lib/env.js'
import logger from '@/lib/logger.js'

const results = new Map<string, pendingResults>()

type pendingResults = {
  did: string
  completedDate?: number
  data?: AppBskyFeedGetAuthorFeed.OutputSchema
  errorReason?: string
  failed: boolean
}

function seededRandom(seed: number) {
  const a = 1664525
  const c = 1013904223
  const m = 2 ** 32 // 2 to the power of 32
  seed = (a * seed + c) % m
  return seed / m
}

function trackLimit() {
  if (results.size > env.limits.AUTHOR_FEED_MAX_SIZE * 2) {
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

function isExpiredResult(result: pendingResults) {
  if (result.completedDate === undefined) return false

  if (
    result.completedDate <
    Date.now() -
      (env.limits.AUTHOR_FEED_MIN_AGE_MS +
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

export function purgeCacheForDid(did: string, time: Date) {
  if (!did) return

  const res = results.get(did)
  if (!res) return

  if ((res.completedDate ? res.completedDate : 0) < time.getTime()) {
    results.set(did, {
      ...(results.get(did) as pendingResults),
      completedDate: 0,
    })
    logger.debug(`cache purged for ${did}`)
    return true
  } else {
    logger.debug(`cache too new, not purging for ${did}`)
    return false
  }
}

async function getAuthorFeed(
  did: string,
): Promise<AppBskyFeedGetAuthorFeed.OutputSchema | { error: string }> {
  let cacheHit = true

  let result = results.get(did)

  if (result && isExpiredResult(result)) {
    results.delete(did)
    result = undefined
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
    if (data?.feed) {
      if (cacheHit) globalCacheHit++
      return data as AppBskyFeedGetAuthorFeed.OutputSchema
    }
  } else {
    globalCacheMiss++

    try {
      const limit = env.limits.AUTHOR_FEED_MAX_RESULTS
      const res = await retryLimit(() =>
        fetch(
          `${env.PUBLIC_SERVICE}/xrpc/app.bsky.feed.getAuthorFeed` +
            `?actor=${did}&` +
            `limit=${limit}&` +
            `filter=posts_with_replies`,
        ),
      )

      const json = await res.json()

      results.set(did, {
        did: did,
        failed: false,
        data: json as AppBskyFeedGetAuthorFeed.OutputSchema,
        completedDate: Date.now(),
        errorReason: undefined,
      })
      return json as AppBskyFeedGetAuthorFeed.OutputSchema
    } catch (e) {
      return { error: `failed to fetch (${e.message})` }
    }
  }

  return { error: 'unknown error' }
}

export default getAuthorFeed
