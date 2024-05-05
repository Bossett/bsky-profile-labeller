import {
  AppBskyFeedDefs,
  AppBskyFeedGetAuthorFeed,
  AppBskyFeedGetPosts,
} from '@atproto/api'

import { plcLimit, retryLimit } from '@/lib/rateLimit.js'
import env from '@/lib/env.js'
import logger from '@/lib/logger.js'

import moize from 'moize'

const moizedFetch = moize(
  (uri) =>
    retryLimit(async () => {
      return (await fetch(uri)).json()
    }),
  {
    maxAge: env.limits.MOIZED_FETCH_MAX_AGE_MS,
  },
)

async function getPlcRecord(did: string) {
  let res: Response | undefined
  try {
    res = await plcLimit(() => fetch(`${env.PLC_DIRECTORY}/${did}/log/audit`))
  } catch (e) {
    res = undefined
    logger.debug(`${e.message} reading PLC record for ${did}`)
  }

  if (res === undefined) return []

  const plcJson = (await res.json()) as {
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

interface Params {
  did: string
  rkey: string
  watchedFrom: number
}

interface Result {
  create?: string[]
  remove?: string[]
}

async function _getNewLabel({
  did,
  rkey,
  watchedFrom,
}: Params): Promise<Result> {
  const post = `at://${did}/app.bsky.feed.post/${rkey}`

  const createLabels = new Set<string>()
  const removeLabels = new Set<string>()

  const limit = env.limits.AUTHOR_FEED_MAX_RESULTS

  let authorFeed: AppBskyFeedDefs.FeedViewPost[] = []
  let isFullFeedHistory = false

  try {
    const res = await moizedFetch(
      `${env.PUBLIC_SERVICE}/xrpc/app.bsky.feed.getAuthorFeed` +
        `?actor=${did}&` +
        `limit=${limit}&` +
        `filter=posts_with_replies`,
    )
    const data = res as AppBskyFeedGetAuthorFeed.OutputSchema
    authorFeed = data.feed
    isFullFeedHistory = data.cursor ? false : true
  } catch (e) {
    logger.debug(`${e.message} reading feed for ${did}`)
    if (`${e.message}` === 'fetch failed') throw e
    return {}
  }

  if (!authorFeed || authorFeed.length === 0) return {} // no posts, no labels

  authorFeed = authorFeed.filter(
    (record) => record.reason?.$type !== 'app.bsky.feed.defs#reasonRepost',
  )

  if (authorFeed.length === 0) return {} // we had reposts only, no labels

  authorFeed.sort((a, b) => {
    const a_val = a.reason?.indexedAt
      ? `${a.reason.indexedAt}`
      : a.post.indexedAt
    const b_val = b.reason?.indexedAt
      ? `${b.reason.indexedAt}`
      : b.post.indexedAt
    return new Date(a_val).getTime() - new Date(b_val).getTime()
  })

  if (authorFeed[0].post.uri === post && isFullFeedHistory) {
    if (new Date(authorFeed[0].post.indexedAt).getTime() > watchedFrom)
      // current post is their first ever
      // and happened in the watched period
      createLabels.add('newaccount')
  }

  switch (did.startsWith('did:plc:')) {
    case false:
      break
    case true:
      const handles = await getPlcRecord(did)
      if (handles.length <= 1) break // no handle changes or error

      const currentHandle = handles[handles.length - 1]
      const handleCreationTime = new Date(currentHandle.createdAt).getTime()

      let postBeforeChange = false
      let postAfterChange = false
      let postFound = false
      let postIntervals: number[] = []

      let previousPostTime: number | undefined = undefined

      for (const item of authorFeed) {
        const postTime = new Date(item.post.indexedAt).getTime()
        if (previousPostTime) postIntervals.push(postTime - previousPostTime)

        const thisIsEventPost = item.post.uri === post

        if (item.post.uri === post) postFound = true

        if (postTime < handleCreationTime) {
          postBeforeChange = true
        } else if (postTime >= handleCreationTime) {
          if (
            postBeforeChange === true &&
            postAfterChange === false &&
            postTime > watchedFrom &&
            thisIsEventPost
          ) {
            // this post is the first post after the change
            createLabels.add('newhandle')
          }
          postAfterChange = true
        }
        previousPostTime = postTime
      }
      // post not in feed, but handle changed - feed stale?
      if (
        postFound === false &&
        postBeforeChange === true &&
        postAfterChange === false
      ) {
        try {
          const res = await moizedFetch(
            `${env.PUBLIC_SERVICE}/xrpc/app.bsky.feed.getPosts` +
              `?uris=${post}`,
          )
          const data = res as AppBskyFeedGetPosts.OutputSchema

          if (data.posts.length !== 0) {
            const thisPost = data.posts[0]?.indexedAt

            if (thisPost) {
              if (new Date(thisPost).getTime() > handleCreationTime)
                createLabels.add('newhandle')
            }
          } else {
            logger.debug(`error finding ${post} (deleted?)`)
          }
        } catch (e) {
          logger.debug(`${e.message} fetching post ${post}`)
          if (`${e.message}` === 'fetch failed') throw e
        }
      }

      if (authorFeed.length === limit && postIntervals.length > 1) {
        const stDev = (numArr: number[]) => {
          const n = numArr.length
          const mean = numArr.reduce((a, b) => a + b) / n
          const deviations = numArr.map((x) => Math.pow(x - mean, 2))
          const variance = deviations.reduce((a, b) => a + b) / n
          return Math.sqrt(variance)
        }

        if (stDev(postIntervals) < env.limits.REGULAR_POST_STDEV_MS)
          createLabels.add('rapidposts')
        else removeLabels.add('rapidposts')
      }
  }

  return { create: Array.from(createLabels), remove: Array.from(removeLabels) }
}

export const getNewLabel = moize(_getNewLabel, {
  isPromise: true,
  maxAge: env.limits.NEW_LABEL_MAX_CACHE_AGE_MS,
  maxArgs: 1, // Ensure that moize uses only the first argument (DID) for caching
  updateExpire: true,
  isShallowEqual: true,
})
