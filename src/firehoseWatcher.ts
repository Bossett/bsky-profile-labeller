import FirehoseIterable from './lib/firehoseIterable/firehoseIterable.js'
import logger from '@/helpers/logger.js'
import wait from '@/helpers/wait.js'
import formatNumber from '@/helpers/formatNumber.js'

import formatDuration from '@/helpers/formatDuration.js'

import { cacheStatistics as userDetailsCacheStats } from '@/lib/getUserDetails.js'
import { cacheStatistics as authorFeedDetailsCacheStats } from '@/lib/getAuthorFeed.js'
import { cacheStatistics as plcDirectoryCacheStats } from '@/lib/getPlcRecord.js'
import { cacheStatistics as postBatchCacheStats } from '@/lib/getPost.js'

import env from '@/env/env.js'
import db, { schema } from '@/db/db.js'
import { processCommit } from '@/lib/processCommit.js'

export default async function firehoseWatcher() {
  let seq: number =
    (
      await db.query.subscription_status.findFirst({
        columns: { last_sequence: true },
      })
    )?.last_sequence || 0

  let lag = 0
  let lastLag = 0
  let deltaLag = 0
  const interval_ms = env.limits.DB_WRITE_INTERVAL_MS
  const stalled_at = env.limits.MIN_FIREHOSE_OPS
  let seenFirstCommit = false
  let lastRss = 0

  let isInitialising = true

  const firstRun = Date.now()

  let willRestartOnUnpause = false

  let itemsProcessed = 0
  let itemsSkipped = 0

  const interval = async () => {
    logger.info(`waiting for first commit...`)
    do {
      await wait(10)
    } while (!seenFirstCommit)

    let cycleInterval = interval_ms - (Date.now() % interval_ms)
    let cycleCount = 0
    while (await wait(cycleInterval)) {
      const speed = (itemsProcessed + itemsSkipped) / (cycleInterval / 1000)

      cycleCount++
      deltaLag =
        cycleCount <= 3
          ? 0
          : (deltaLag * (cycleCount - 1) + (lag - lastLag)) / cycleCount

      let timeToRealtimeStr: string
      let isSlowingDown: boolean

      isSlowingDown = false
      timeToRealtimeStr = 'initialising'

      const skippedItems = itemsSkipped
      const totalItems = itemsProcessed + itemsSkipped

      if (deltaLag < 0) {
        const timeToRealtime = lag / (deltaLag / cycleInterval)
        if (lastLag !== 0) {
          timeToRealtimeStr = `${formatDuration(timeToRealtime)} to catch up`
        }
        isSlowingDown = false
        isInitialising = false
      } else {
        if (cycleCount > 3) {
          timeToRealtimeStr = `not catching up`
          isSlowingDown = true
          isInitialising = false
        }
      }

      if (lag < 60000) {
        isSlowingDown = false
        timeToRealtimeStr = `real time`
        isInitialising = false
      }

      if (lag < 15 * 60 * 1000) {
        isSlowingDown = false
      }

      lastLag = lag

      const detailsCacheStats = userDetailsCacheStats()
      const authorFeedCacheStats = authorFeedDetailsCacheStats()
      const plcCacheStats = plcDirectoryCacheStats()
      const postCacheStats = postBatchCacheStats()

      const thisRss = process.memoryUsage().rss

      const logLines = [
        `${formatNumber(speed)} ops/s, at seq: ${seq}`,
        `${timeToRealtimeStr} with lag ${formatDuration(
          lag,
        )} (running ${formatDuration(Date.now() - firstRun)})`,
        `${formatNumber(totalItems)} items: ${formatNumber(
          itemsProcessed,
        )} processed, ${formatNumber(skippedItems)} skipped `,
        `details cache: ${formatNumber(
          detailsCacheStats.items(),
        )} items ${formatNumber(
          detailsCacheStats.hitRate(),
        )}% hit (${formatNumber(detailsCacheStats.recentExpired())} expired)`,
        `author feed cache: ${formatNumber(
          authorFeedCacheStats.items(),
        )} items ${formatNumber(
          authorFeedCacheStats.hitRate(),
        )}% hit (${formatNumber(
          authorFeedCacheStats.recentExpired(),
        )} expired)`,
        `plc directory cache: ${formatNumber(
          plcCacheStats.items(),
        )} items ${formatNumber(plcCacheStats.hitRate())}% hit (${formatNumber(
          plcCacheStats.recentExpired(),
        )} expired)`,
        `post cache: ${formatNumber(
          postCacheStats.items(),
        )} items ${formatNumber(postCacheStats.hitRate())}% hit (${formatNumber(
          postCacheStats.recentExpired(),
        )} expired)`,
        `${formatNumber(thisRss / 1024 / 1024)}MB used by process (${
          thisRss > lastRss ? 'growing' : 'shrinking'
        })`,
      ]

      for (const line of logLines) {
        logger.info(line)
      }

      if (
        postCacheStats.timeoutFailures > 0 ||
        detailsCacheStats.timeoutFailures > 0 ||
        authorFeedCacheStats.timeoutFailures > 0 ||
        plcCacheStats.timeoutFailures > 0
      ) {
        logger.warn(
          `${detailsCacheStats.timeoutFailures} details cache timeout failures`,
        )
        logger.warn(
          `${authorFeedCacheStats.timeoutFailures} author feed cache timeout failures`,
        )
        logger.warn(
          `${plcCacheStats.timeoutFailures} plc cache timeout failures`,
        )
        logger.warn(
          `${postCacheStats.timeoutFailures} post cache timeout failures`,
        )
      }

      detailsCacheStats.reset()
      authorFeedCacheStats.reset()
      plcCacheStats.reset()
      postCacheStats.reset()

      lastRss = thisRss

      if (!isInitialising)
        await db
          .insert(schema.subscription_status)
          .values({
            id: 1,
            last_sequence: seq,
          })
          .onConflictDoUpdate({
            target: schema.subscription_status.id,
            set: {
              last_sequence: seq,
            },
          })

      if (speed < stalled_at && isSlowingDown) {
        logger.error(`firehose stalled at ${speed} ops/s`)

        willRestartOnUnpause = true
        isSlowingDown = false
      }

      itemsSkipped = 0
      itemsProcessed = 0

      cycleInterval = interval_ms - (Date.now() % interval_ms)
    }
  }

  interval()

  do {
    willRestartOnUnpause = false

    try {
      const firehose = await new FirehoseIterable().create({
        seq: seq,
        timeout: env.limits.MAX_FIREHOSE_DELAY,
        maxPending: 10000,
        includeTypes: ['app.bsky.feed.post', 'app.bsky.actor.profile'],
      })

      for await (const commit of firehose) {
        if (!Number.isSafeInteger(commit.meta['seq'])) continue
        seenFirstCommit = true

        const commitTime = new Date(commit.meta['time']).getTime()
        lag =
          lag !== 0
            ? (lag + (Date.now() - commitTime)) / 2
            : Date.now() - commitTime

        if (willRestartOnUnpause) {
          throw new Error('FirehoseNotCatchingUp')
        }

        if (await processCommit(commit)) itemsProcessed++
        else itemsSkipped++

        seq = commit.meta['seq']
      }
    } catch (e) {
      logger.warn(`${e} in firehoseWatcher`)
      throw e
    }

    seenFirstCommit = false
  } while (await wait(10000))
}
