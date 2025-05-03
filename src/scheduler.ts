import wait from '@/helpers/wait.js'
import logger from '@/helpers/logger.js'
import formatDuration from '@/helpers/formatDuration.js'
import {
  getAllPending,
  updateListItemURLs,
  updateLists,
} from '@/lib/listManager.js'
import { pdsLimit, deleteLimit } from '@/env/rateLimit.js'
import { agent, agentDid } from '@/lib/bskyAgent.js'
import env from '@/env/env.js'

const interval_ms = env.limits.DB_WRITE_INTERVAL_MS

export default async function scheduler() {
  let cycleInterval =
    interval_ms - ((Date.now() + Math.floor(interval_ms / 2)) % interval_ms)

  do {
    const started = Date.now()
    await updateLists()
    const { creates, removals, cleared } = await processListChanges()

    logger.info(
      `scheduler completed in ${formatDuration(Date.now() - started)}`,
    )

    if (creates + removals + cleared > 0) {
      logger.info(
        `${creates} creates, ${removals} removals, ${cleared} stale records removed`,
      )
    }

    cycleInterval =
      interval_ms - ((Date.now() + Math.floor(interval_ms / 2)) % interval_ms)
  } while (await wait(cycleInterval))
}

async function processListChanges() {
  const pendingListChanges = await getAllPending()

  const allItems: {
    id: number
    listItemURL: string | null
    did: string
    listURLId: number
  }[] = []

  let creates = 0

  for (const listUrl of Object.keys(pendingListChanges.creates)) {
    for (const did of Object.keys(pendingListChanges.creates[listUrl])) {
      try {
        const res = env.DANGEROUSLY_EXPOSE_SECRETS
          ? {
              success: true,
              data: { uri: 'at://did:plc:fake/app.bsky.graph.listitem/<rkey>' },
            }
          : await pdsLimit(() => {
              return agent.com.atproto.repo.createRecord({
                repo: agentDid,
                collection: 'app.bsky.graph.listitem',
                record: {
                  $type: 'app.bsky.graph.listitem',
                  subject: did,
                  list: listUrl,
                  createdAt: new Date().toISOString(),
                },
              })
            })

        if (res.success) {
          creates++
          const listItemUrl = res.data.uri

          const ids = pendingListChanges.creates[listUrl][did].ids
          ids.map((id) => {
            allItems.push({
              id,
              listItemURL: listItemUrl,
              listURLId: pendingListChanges.creates[listUrl][did].listURLId,
              did: did,
            })
          })

          logger.debug(`doing listitem creation ${listItemUrl} ${did} ${ids}`)
        } else {
          logger.debug(`failed listitem creation adding ${did} to ${listUrl}`)
        }
      } catch (e) {
        logger.warn(`failure adding ${did} to ${listUrl}: ${e}`)
      }
    }
  }

  let removals = 0

  const postUriRegex =
    /at:\/\/(did:[^:]+:[^\/]+)\/app\.bsky\.graph\.listitem\/([^\/]+)/

  for (const listUrl of Object.keys(pendingListChanges.removals)) {
    for (const did of Object.keys(pendingListChanges.removals[listUrl])) {
      try {
        const ids = pendingListChanges.removals[listUrl][did].ids

        const atURLtoDelete =
          pendingListChanges.removals[listUrl][did].listItemURL

        const match = atURLtoDelete?.match(postUriRegex)
        if (!match) continue
        const [_, _did, rkey] = match

        const res = env.DANGEROUSLY_EXPOSE_SECRETS
          ? { success: true }
          : await deleteLimit(() => {
              return agent.com.atproto.repo.deleteRecord({
                repo: agentDid,
                collection: 'app.bsky.graph.listitem',
                rkey: rkey,
              })
            })

        if (res.success) {
          removals++
          ids.map((id) => {
            allItems.push({
              id,
              listItemURL: null,
              listURLId: pendingListChanges.removals[listUrl][did].listURLId,
              did: did,
            })
          })

          logger.debug(`doing listitem removal ${atURLtoDelete} ${did} ${ids}`)
        } else {
          logger.debug(`failed listitem removal ${atURLtoDelete} ${did} ${ids}`)
        }
      } catch (e) {
        logger.warn(`failure removing ${did} from ${listUrl}: ${e}`)
      }
    }
  }

  // const itemsUpdated = await updateListItemURLs(allItems)
  return {
    creates: creates,
    removals: removals,
    cleared: 0, // itemsUpdated - (creates + removals),
  }
}
