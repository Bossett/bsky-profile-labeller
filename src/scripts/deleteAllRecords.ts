import CachedFetch from '@/lib/CachedFetch.js'
import env from '@/env/env.js'
import { publicLimit, deleteLimit } from '@/env/rateLimit.js'
import { agent, agentDid } from '@/lib/bskyAgent.js'
import logger from '@/helpers/logger.js'

const fetchCachedList = new CachedFetch({
  maxAge: env.limits.AUTHOR_FEED_MAX_AGE_MS,
  maxSize: env.limits.AUTHOR_FEED_MAX_SIZE,
  limiter: publicLimit,
  maxBatch: env.limits.PUBLIC_LIMIT_MAX_CONCURRENT,
})

const collection = 'app.bsky.graph.listitem'

const list = `https://bsky.social/xrpc/com.atproto.repo.listRecords?repo=${agentDid}&collection=${collection}`

let cursor: string | undefined = undefined

const listItems: { uri: string; cid: string; value: unknown }[] = []

do {
  const res = await fetchCachedList.getJson(`${list}&cursor=${cursor}`)
  listItems.push(...res.records)
  cursor = res.cursor
} while (cursor)

logger.info(`deleting ${listItems.length} items from ${collection}`)

const postUriRegex =
  /at:\/\/(did:[^:]+:[^\/]+)\/app\.bsky\.graph\.listitem\/([^\/]+)/

for (const listItem of listItems) {
  const match = listItem.uri.match(postUriRegex)
  if (!match) continue
  const [_, _did, rkey] = match

  const res = await deleteLimit(() => {
    return agent.com.atproto.repo.deleteRecord({
      repo: agentDid,
      collection: 'app.bsky.graph.listitem',
      rkey: rkey,
    })
  })
}
