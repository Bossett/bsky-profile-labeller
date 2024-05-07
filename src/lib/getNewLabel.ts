import {
  AppBskyFeedDefs,
  AppBskyFeedGetAuthorFeed,
  AppBskyFeedGetPosts,
} from '@atproto/api'

import { OperationsResult } from '@/lib/insertOperations.js'

import { retryLimit } from '@/lib/rateLimit.js'
import env from '@/lib/env.js'
import logger from '@/lib/logger.js'

import getAuthorFeed from '@/lib/getAuthorFeed.js'
import getPlcRecord from '@/lib/getPlcRecord.js'

interface Params {
  did: string
  rkey: string
  watchedFrom: number
}

export async function getNewLabel({
  did,
  rkey,
  watchedFrom,
}: Params): Promise<OperationsResult> {
  const post = `at://${did}/app.bsky.feed.post/${rkey}`

  const createLabels = new Set<string>()
  const removeLabels = new Set<string>()

  const limit = env.limits.AUTHOR_FEED_MAX_RESULTS

  let authorFeed: AppBskyFeedDefs.FeedViewPost[] = []
  let isFullFeedHistory = false

  const labelResult: OperationsResult = { create: [], remove: [] }

  const data = await getAuthorFeed(did)

  if (data.error) {
    logger.debug(`${data.error} fetching feed for ${did}`)
    return labelResult
  } else {
    authorFeed = (data as AppBskyFeedGetAuthorFeed.OutputSchema).feed

    isFullFeedHistory = (data as AppBskyFeedGetAuthorFeed.OutputSchema).cursor
      ? false
      : true
  }

  if (!authorFeed || authorFeed.length === 0) return labelResult // no posts, no labels

  authorFeed = authorFeed.filter(
    (record) => record.reason?.$type !== 'app.bsky.feed.defs#reasonRepost',
  )

  if (authorFeed.length === 0) return labelResult // we had reposts only, no labels

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
          const res = await retryLimit(
            async () =>
              await fetch(
                `${env.PUBLIC_SERVICE}/xrpc/app.bsky.feed.getPosts` +
                  `?uris=${post}`,
              ),
          )

          const data = (await res.json()) as AppBskyFeedGetPosts.OutputSchema

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
