import {
  AppBskyFeedDefs,
  AppBskyFeedGetAuthorFeed,
  AppBskyFeedPost,
} from '@atproto/api'

import {
  isReasonRepost,
  isReasonPin,
} from '@atproto/api/dist/client/types/app/bsky/feed/defs.js'

import { OperationsResult } from '@/lib/insertOperations.js'
import getPost from '@/lib/getPost.js'

import env from '@/env/env.js'
import logger from '@/helpers/logger.js'

import getAuthorFeed, {
  purgeCacheForDid as purgeAuthorFeedCache,
} from '@/lib/getAuthorFeed.js'
import getPlcHandleHistory from '@/lib/getPlcRecord.js'

interface Params {
  did: string
  rkey: string
  watchedFrom: number
}

const stDev = (numArr: number[]) => {
  if (numArr.length === 0) return Infinity
  const n = numArr.length
  const mean = numArr.reduce((a, b) => a + b) / n
  const deviations = numArr.map((x) => Math.pow(x - mean, 2))
  const variance = deviations.reduce((a, b) => a + b) / n
  return Math.sqrt(variance)
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

  if ('error' in data) {
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
    (record) => !(isReasonPin(record.reason) || !isReasonRepost(record.reason)),
  )

  if (authorFeed.length === 0) return labelResult // we had reposts only, no labels

  authorFeed.sort((a, b) => {
    const a_val =
      a.reason && 'indexedAt' in a.reason
        ? `${a.reason.indexedAt}`
        : a.post.indexedAt
    const b_val =
      b.reason && 'indexedAt' in b.reason
        ? `${b.reason.indexedAt}`
        : b.post.indexedAt
    return new Date(a_val).getTime() - new Date(b_val).getTime()
  })

  if (authorFeed[0].post.uri === post && isFullFeedHistory) {
    /* REMOVING NEW ACCOUNT LABEL

    if (new Date(authorFeed[0].post.indexedAt).getTime() > watchedFrom)
      // current post is their first ever
      // and happened in the watched period
      createLabels.add('newaccount')

    */
  }

  switch (did.startsWith('did:plc:')) {
    case false:
      break
    case true:
      const handles = await getPlcHandleHistory(did)
      if (handles.length <= 1) break // no handle changes or error

      const currentHandle = handles[handles.length - 1]
      const handleCreationTime = new Date(currentHandle.createdAt).getTime()

      let postBeforeChange = false
      let postAfterChange = false
      let postFound = false
      let postIntervals: number[] = []
      let hasSeenTopLevel = false
      let hasSeenReply = false
      let wantsHandleChange = false

      let previousPostTime: number | undefined = undefined

      for (const item of authorFeed) {
        const postTime = new Date(item.post.indexedAt).getTime()
        if (previousPostTime) postIntervals.push(postTime - previousPostTime)
        if (item.post.author.did === did && !item.reply) hasSeenTopLevel = true
        if (item.post.author.did === did && item.reply) hasSeenReply = true

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
            wantsHandleChange = true
          }
          postAfterChange = true
        }
        previousPostTime = postTime
      }

      let thisPost: AppBskyFeedDefs.PostView | undefined = undefined

      if (!postFound) {
        try {
          const postData = await getPost(post)

          if (!('error' in postData)) {
            thisPost = postData as AppBskyFeedDefs.PostView
          } else {
            logger.debug(`error finding ${post}: ${postData.error}`)
          }
        } catch (e) {
          logger.debug(`${e.message} fetching post ${post}`)
        }
      }

      if (thisPost) {
        if (postBeforeChange && !postAfterChange) {
          if (new Date(thisPost.indexedAt).getTime() > handleCreationTime)
            wantsHandleChange = true
        }

        const record = thisPost.record as AppBskyFeedPost.Record

        if (record) {
          if (record.reply) hasSeenReply = true
          else hasSeenTopLevel = true
        }
      }

      if (wantsHandleChange) {
        if (handles[handles.length - 1].createdAt.getTime() >= watchedFrom) {
          createLabels.add('changedhandle')
        } else {
          removeLabels.add('changedhandle')
        }
      }

      const isPotentialRapidPoster =
        stDev(postIntervals) < env.limits.REGULAR_POST_STDEV_MS &&
        postIntervals.length === limit - 1 &&
        !hasSeenReply

      if (!isPotentialRapidPoster && hasSeenTopLevel) {
        removeLabels.add('onlyreplies')
        removeLabels.add('rapidposts')
        break
      }

      const data = await getAuthorFeed(did, true)
      if (!('error' in data)) {
        const topOnlyAuthorResult =
          data as AppBskyFeedGetAuthorFeed.OutputSchema
        const topOnlyAuthorFeed = topOnlyAuthorResult.feed

        if (topOnlyAuthorFeed.length === 0 && hasSeenReply) {
          createLabels.add('onlyreplies')
        } else removeLabels.add('onlyreplies')

        if (isPotentialRapidPoster) {
          const postIntervals: number[] = topOnlyAuthorFeed.reduce(
            (acc: number[], curr, index, array) => {
              if (index !== 0) {
                const diff =
                  new Date(curr.post.indexedAt).getTime() -
                  new Date(array[index - 1].post.indexedAt).getTime()
                acc.push(Math.abs(diff))
              }
              return acc
            },
            [],
          )

          if (stDev(postIntervals) < env.limits.REGULAR_POST_STDEV_MS) {
            createLabels.add('rapidposts')
          } else {
            removeLabels.add('rapidposts')
          }
        }
      }
  }

  return { create: Array.from(createLabels), remove: Array.from(removeLabels) }
}
