import { AppBskyFeedGetAuthorFeed } from '@atproto/api'
import env from '@/env/env.js'
import { retryLimit } from '@/env/rateLimit.js'

import CachedFetch from '@/lib/CachedFetch.js'

const limit = env.limits.AUTHOR_FEED_MAX_RESULTS

const fetchCachedFeed = new CachedFetch({
  maxAge: env.limits.AUTHOR_FEED_MAX_AGE_MS,
  maxSize: env.limits.AUTHOR_FEED_MAX_SIZE,
  limiter: retryLimit,
})

export function cacheStatistics() {
  return fetchCachedFeed.cacheStatistics()
}

export function purgeCacheForDid(did: string, time?: number) {
  return fetchCachedFeed.purgeCacheForKey(
    `${env.PUBLIC_SERVICE}/xrpc/app.bsky.feed.getAuthorFeed` +
      `?actor=${did}&` +
      `limit=${limit}&` +
      `filter=posts_with_replies`,
    time,
  )
}

async function getAuthorFeed(
  did: string,
): Promise<AppBskyFeedGetAuthorFeed.OutputSchema | { error: string }> {
  const res = await fetchCachedFeed.getJson(
    `${env.PUBLIC_SERVICE}/xrpc/app.bsky.feed.getAuthorFeed` +
      `?actor=${did}&` +
      `limit=${limit}&` +
      `filter=posts_with_replies`,
  )

  if (res.error) return res as { error: string }
  else return res as AppBskyFeedGetAuthorFeed.OutputSchema
}

export default getAuthorFeed
