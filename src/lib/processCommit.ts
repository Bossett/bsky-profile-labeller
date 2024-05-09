import { getNewLabel } from '@/lib/getNewLabel.js'
import { getProfileLabel } from '@/lib/getProfileLabel.js'
import getUserDetails, {
  purgeCacheForDid as purgeDetailsCache,
} from '@/lib/getUserDetails.js'
import getAuthorFeed, {
  purgeCacheForDid as purgeAuthorFeedCache,
} from '@/lib/getAuthorFeed.js'
import getPlcRecord, {
  purgeCacheForDid as purgePlcDirectoryCache,
} from '@/lib/getPlcRecord.js'
import { getExpiringLabels } from '@/lib/getExpiringLabels.js'
import {
  OperationsResult,
  insertOperations,
  operationType,
} from '@/lib/insertOperations.js'
import { AppBskyActorDefs } from '@atproto/api'
import { agentDid } from '@/lib/bskyAgent.js'
import logger from '@/helpers/logger.js'
import env from '@/env/env.js'
import wait from '@/helpers/wait.js'
import Denque from 'denque'

type Commit = {
  record?: any
  atURL: any
  collection?: string | undefined
  rkey?: string | undefined
  repo: any
  action?: string
  meta?: any
}

const regexDid = /(did:[^:]+:[^\/]+)/

export function validateCommit(commit: Commit): { seq?: number; did?: string } {
  if (
    !(
      (commit.record['$type'] &&
        ['app.bsky.feed.post', 'app.bsky.actor.profile'].includes(
          commit.record['$type'],
        )) ||
      ['com.atproto.sync.subscribeRepos#identity'].includes(
        commit.meta['$type'],
      )
    )
  ) {
    return {}
  }

  const did: string = `${commit.repo}` || ''
  const seq: number = commit.meta['seq']

  if (did === '') return {}
  if (!Number.isSafeInteger(seq)) return {}

  const matchDid = did.match(regexDid)
  if (!matchDid) {
    logger.debug(`${seq}: invalid did at ${commit.repo}`)
    return {}
  }
  return { seq: seq, did: did }
}

export function _processCommit(commit: Commit): Promise<void> {
  return new Promise(async (resolve, reject) => {
    let failTimeout: NodeJS.Timeout | undefined = undefined

    try {
      const { seq, did } = validateCommit(commit)
      if (!(seq && did)) {
        clearTimeout(failTimeout)
        reject()
        return
      }

      failTimeout = setTimeout(() => {
        logger.debug(`${seq}: took too long, failing...`)
        reject(new Error(`ProcessCommitTimeout`))
      }, env.limits.MAX_PROCESSING_TIME_MS)

      const time: number = commit.meta['time']
        ? new Date(commit.meta['time']).getTime()
        : 0

      if (commit.meta['$type'] == 'com.atproto.sync.subscribeRepos#identity') {
        if (purgePlcDirectoryCache(did, time)) {
          logger.debug(`got identity change, refreshing plc cache of ${did}`)
        }
      }
      if (commit.record['$type'] === 'app.bsky.actor.profile') {
        if (purgeDetailsCache(did, time)) {
          logger.debug(`got profile change, refreshing profile cache of ${did}`)
        }
      }
      if (commit.record['$type'] === 'app.bsky.feed.post') {
        if (purgeAuthorFeedCache(did, time)) {
          logger.debug(`got post, refreshing feed cache of ${did}`)
        }
      }

      const tmpData: AppBskyActorDefs.ProfileViewDetailed | { error: string } =
        await getUserDetails(did)

      if (tmpData.error) {
        logger.debug(`${seq}: error ${tmpData.error} retreiving ${did}`)

        clearTimeout(failTimeout)
        reject()
        return
      }

      const profileData = tmpData as AppBskyActorDefs.ProfileViewDetailed
      const allLabelOperations: OperationsResult[] = []

      const currentLabels = profileData.labels
        ? profileData.labels.filter((label) => {
            return label.src === agentDid && !label.neg
          })
        : []

      const handleExpiryThreshold = Date.now() - env.NEWHANDLE_EXPIRY * 1000

      const promArray: Promise<OperationsResult>[] = []

      switch (commit.record['$type']) {
        case 'app.bsky.feed.post':
          const regex =
            /at:\/\/(did:[^:]+:[^\/]+)\/app\.bsky\.feed\.post\/([^\/]+)/
          const match = commit.atURL.match(regex)
          if (!match) {
            logger.debug(`${seq}: invalid commit URL ${commit.atURL}`)

            clearTimeout(failTimeout)
            reject()
            return
          }
          const [, commit_did, commit_rkey] = match

          promArray.push(
            getNewLabel({
              did: commit_did,
              rkey: commit_rkey,
              watchedFrom: handleExpiryThreshold,
            }).catch((e) => {
              const op: OperationsResult = {
                create: [],
                remove: [],
              }
              return op
            }),
          )
          break
        case 'app.bsky.feed.like':
          break
        case 'app.bsky.feed.repost':
          break
        case 'app.bsky.graph.follow':
          break
        case 'app.bsky.actor.profile':
          break

        default:
          clearTimeout(failTimeout)
          return
      }

      promArray.push(
        getProfileLabel(profileData, currentLabels).catch((e) => {
          const op: OperationsResult = {
            create: [],
            remove: [],
          }
          return op
        }),
      )

      promArray.push(
        getExpiringLabels({
          labels: currentLabels,
          labeller: agentDid,
          watchedFrom: handleExpiryThreshold,
          handlesToExpire: ['newhandle', 'newaccount'],
        }).catch((e) => {
          const op: OperationsResult = {
            create: [],
            remove: [],
          }
          return op
        }),
      )

      let opsResults: any[]

      opsResults = await Promise.all(promArray)

      const labelOperations = opsResults.reduce(
        (ops, op) => {
          ops.create = [...ops.create, ...op.create]
          ops.remove = [...ops.remove, ...op.remove]
          return ops
        },
        {
          create: [],
          remove: [],
        },
      )

      allLabelOperations.forEach((operations) => {
        labelOperations.create = [
          ...labelOperations.create,
          ...(operations.create ? operations.create : []),
        ]

        labelOperations.remove = [
          ...labelOperations.remove,
          ...(operations.remove ? operations.remove : []),
        ]
      })

      const handlesToReapply = ['newhandle']

      labelOperations.create = labelOperations.create.filter((label) => {
        if (!currentLabels.map((curr) => curr.val).includes(label)) {
          // only create labels that are not already on the account
          // UNLESS they are in handlesToReapply
          return false
        } else {
          if (handlesToReapply.includes(label)) return true
          return false
        }
      })

      labelOperations.remove = labelOperations.remove.filter((label) => {
        if (currentLabels.map((curr) => curr.val).includes(label)) {
          // only remove labels that are already on the account
          return true
        } else {
          return false
        }
      })

      const operations: operationType[] = []

      if (labelOperations.remove.length > 0) {
        for (const newLabel of labelOperations.remove) {
          logger.debug(`${seq}: unlabel ${did} ${newLabel}`)
          operations.push({
            label: newLabel,
            action: 'remove',
            did: did,
            comment: `removing ${newLabel} from ${did}`,
          })
        }
      }
      if (labelOperations.create.length > 0) {
        for (const newLabel of labelOperations.create) {
          logger.debug(`${seq}: label ${did} ${newLabel}`)
          operations.push({
            label: newLabel,
            action: 'create',
            did: did,
            comment: `creating ${newLabel} for ${did}`,
          })
        }
      }

      if (
        labelOperations.create.length > 0 ||
        labelOperations.remove.length > 0
      ) {
        await insertOperations(operations)
      }

      clearTimeout(failTimeout)
      resolve()
      return
    } catch (e) {
      clearTimeout(failTimeout)
      reject(e)
    } finally {
      clearTimeout(failTimeout)
      resolve()
    }
  })
}

const processQueue = new Denque<Commit>()

const maxActiveTasks = env.limits.MAX_CONCURRENT_PROCESSCOMMITS
const taskBuffer = maxActiveTasks * 2
let runningCommits = new Set<number>()

const knownBadCommits = new Set<number>()

async function queueManager() {
  do {
    while (!processQueue.isEmpty()) {
      const commits = processQueue.splice(
        0,
        maxActiveTasks - runningCommits.size,
      )
      if (!commits || commits.length === 0) continue

      const commitsPromises: Promise<any>[] = []
      for (const commit of commits) {
        const seq = Number.parseInt(commit.meta['seq'])
        if (runningCommits.has(seq)) continue

        runningCommits.add(seq)
        commitsPromises.push(
          _processCommit(commit)
            .then(() => runningCommits.delete(seq))
            .catch(() => runningCommits.delete(seq))
            .finally(() => runningCommits.delete(seq)),
        )
      }

      await Promise.allSettled(commitsPromises)
      commitsPromises.length = 0
    }
    knownBadCommits.clear()
    runningCommits.clear()
  } while (await wait(10))
}

export async function processCommit(commit: Commit): Promise<boolean> {
  const isValidCommit = validateCommit(commit)
  if (!(isValidCommit.did && isValidCommit.seq)) return false
  if (knownBadCommits.has(isValidCommit.seq)) return false

  while (processQueue.length >= taskBuffer) {
    await wait(10)
  }

  processQueue.push(commit)

  return isValidCommit.did ? true : false
}

export function resetQueue() {
  const count = processQueue.size()

  processQueue.clear()
  knownBadCommits.clear()
  runningCommits.clear()
  return count
}

queueManager()
