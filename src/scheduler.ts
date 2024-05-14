import wait from '@/helpers/wait.js'
import logger from '@/helpers/logger.js'
import lists, {
  getAllPending,
  updateListItemURLs,
  updateLists,
} from '@/lib/listManager.js'
import { pdsLimit, deleteLimit } from '@/env/rateLimit.js'
import { agent, agentDid } from '@/lib/bskyAgent.js'
import env from '@/env/env.js'

export default async function scheduler() {
  do {
    await updateLists()
    await processListChanges()
    logger.debug('scheduler waiting...')
  } while (await wait(60 * 1000))
}

async function processListChanges() {
  const pendingListChanges = await getAllPending()

  const allItems: { id: number; listItemURL: string | null }[] = []

  for (const listUrl of Object.keys(pendingListChanges.creates)) {
    for (const did of Object.keys(pendingListChanges.creates[listUrl])) {
      const res = env.DANGEROUSLY_EXPOSE_SECRETS
        ? {
            success: true,
            data: { uri: 'at://<did>/app.bsky.graph.list/<rkey>' },
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
        const listItemUrl = res.data.uri

        const ids = pendingListChanges.creates[listUrl][did].ids
        ids.map((id) => {
          allItems.push({ id, listItemURL: listItemUrl })
        })

        logger.debug(`doing listitem creation ${listItemUrl} ${did} ${ids}`)
      } else {
        logger.debug(`failed listitem creation adding ${did} to ${listUrl}`)
      }
    }
  }

  const postUriRegex =
    /at:\/\/(did:[^:]+:[^\/]+)\/app\.bsky\.graph\.listitem\/([^\/]+)/

  for (const listUrl of Object.keys(pendingListChanges.removals)) {
    for (const did of Object.keys(pendingListChanges.removals[listUrl])) {
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
        ids.map((id) => {
          allItems.push({ id, listItemURL: null })
        })

        logger.debug(`doing listitem removal ${atURLtoDelete} ${did} ${ids}`)
      } else {
        logger.debug(`failed listitem removal ${atURLtoDelete} ${did} ${ids}`)
      }
    }
  }

  const groupedItems = allItems.reduce((acc, item) => {
    const existingItem = acc.find((i) => i.listItemURL === item.listItemURL)
    if (existingItem) {
      existingItem.ids.push(item.id)
    } else {
      acc.push({ listItemURL: item.listItemURL, ids: [item.id] })
    }
    return acc
  }, [] as { listItemURL: string | null; ids: number[] }[])

  const itemsUpdated = await updateListItemURLs(groupedItems)
  logger.info(`updated ${itemsUpdated} items in lists`)
}
