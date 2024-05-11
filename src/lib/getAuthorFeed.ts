import { AppBskyFeedGetAuthorFeed } from '@atproto/api'
import env from '@/env/env.js'
import { publicLimit } from '@/env/rateLimit.js'

import CachedFetch from '@/lib/CachedFetch.js'

const limit = env.limits.AUTHOR_FEED_MAX_RESULTS

const fetchCachedFeed = new CachedFetch({
  maxAge: env.limits.AUTHOR_FEED_MAX_AGE_MS,
  maxSize: env.limits.AUTHOR_FEED_MAX_SIZE,
  limiter: publicLimit,
  maxBatch: env.limits.PUBLIC_LIMIT_MAX_CONCURRENT,
})

export function cacheStatistics() {
  return fetchCachedFeed.cacheStatistics()
}

function getFeedUrl(did: string, topOnly: boolean) {
  return (
    `${env.PUBLIC_SERVICE}/xrpc/app.bsky.feed.getAuthorFeed` +
    `?actor=${did}&` +
    `limit=${limit}&` +
    (topOnly ? `filter=posts_no_replies` : `filter=posts_with_replies`)
  )
}

export function purgeCacheForDid(did: string, time?: number) {
  const purgedTop = fetchCachedFeed.purgeCacheForKey(
    getFeedUrl(did, true),
    time,
  )
  const purgedFull = fetchCachedFeed.purgeCacheForKey(
    getFeedUrl(did, false),
    time,
  )

  return purgedTop || purgedFull
}

async function getAuthorFeed(
  did: string,
  topOnly: boolean = false,
): Promise<AppBskyFeedGetAuthorFeed.OutputSchema | { error: string }> {
  const res = await fetchCachedFeed.getJson(getFeedUrl(did, topOnly))

  if (res.error) return res as { error: string }
  else return res as AppBskyFeedGetAuthorFeed.OutputSchema
}

export default getAuthorFeed
