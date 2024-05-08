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
    const { seq, did } = validateCommit(commit)
    if (!(seq && did)) {
      resolve()
      return
    }

    let debugString = ``
    const getDebugString = () => debugString

    const fail = () => {
      reject(new Error(`ProcessCommitTimeout`))
    }

    const warnTimeout = setTimeout(async () => {
      logger.debug(`${seq}: taking too long ${getDebugString()}...`)
    }, env.limits.MAX_PROCESSING_TIME_MS / 2)

    const failTimeout = setTimeout(async () => {
      logger.warn(`${seq}: took too long ${getDebugString()}, failing...`)
      fail()
    }, env.limits.MAX_PROCESSING_TIME_MS)

    const time: number = commit.meta['time']
      ? new Date(commit.meta['time']).getTime()
      : 0

    if (commit.meta['$type'] == 'com.atproto.sync.subscribeRepos#identity') {
      if (purgePlcDirectoryCache(did, time)) {
        logger.debug(`got identity change, refreshing plc cache of ${did}`)
        getPlcRecord(did)
      }
    }
    if (commit.record['$type'] === 'app.bsky.actor.profile') {
      if (purgeDetailsCache(did, time)) {
        logger.debug(`got profile change, refreshing profile cache of ${did}`)
        getUserDetails(did)
      }
    }
    if (commit.record['$type'] === 'app.bsky.feed.post') {
      if (purgeAuthorFeedCache(did, time)) {
        logger.debug(`got post, refreshing feed cache of ${did}`)
        getAuthorFeed(did)
      }
    }

    debugString = `getting userDetails for ${did}`
    const tmpData: AppBskyActorDefs.ProfileViewDetailed | { error: string } =
      await getUserDetails(did)

    if (tmpData.error) {
      logger.debug(`${seq}: error ${tmpData.error} retreiving ${did}`)
      clearTimeout(warnTimeout)
      clearTimeout(failTimeout)
      resolve()
      return
    }

    const profileData = tmpData as AppBskyActorDefs.ProfileViewDetailed
    const labelOperations: OperationsResult = {
      create: [],
      remove: [],
    }
    const allLabelOperations: OperationsResult[] = []

    const currentLabels = profileData.labels
      ? profileData.labels.filter((label) => {
          return label.src === agentDid && !label.neg
        })
      : []

    const handleExpiryThreshold = Date.now() - env.NEWHANDLE_EXPIRY * 1000

    switch (commit.record['$type']) {
      case 'app.bsky.feed.post':
        const regex =
          /at:\/\/(did:[^:]+:[^\/]+)\/app\.bsky\.feed\.post\/([^\/]+)/
        const match = commit.atURL.match(regex)
        if (!match) {
          logger.debug(`${seq}: invalid commit URL ${commit.atURL}`)
          clearTimeout(warnTimeout)
          clearTimeout(failTimeout)
          resolve()
          return
        }
        const [, commit_did, commit_rkey] = match

        debugString = `getting newLabels`
        allLabelOperations.push(
          await getNewLabel({
            did: commit_did,
            rkey: commit_rkey,
            watchedFrom: handleExpiryThreshold,
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
        clearTimeout(warnTimeout)
        clearTimeout(failTimeout)
        return
    }

    debugString = `getting profileLabels`
    allLabelOperations.push(await getProfileLabel(profileData, currentLabels))

    debugString = `getting expiringLabels`
    allLabelOperations.push(
      await getExpiringLabels({
        labels: currentLabels,
        labeller: agentDid,
        watchedFrom: handleExpiryThreshold,
        handlesToExpire: ['newhandle', 'newaccount'],
      }),
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

    debugString = `inserting operations`

    if (
      labelOperations.create.length > 0 ||
      labelOperations.remove.length > 0
    ) {
      await insertOperations(operations)
    }

    clearTimeout(warnTimeout)
    clearTimeout(failTimeout)
    resolve()
    return
  })
}

const processQueue = new Denque<Commit>()
const knownBadCommits = new Map<number, number>()
let activeTasks = 0

async function queueManager() {
  do {
    while (
      !processQueue.isEmpty() &&
      activeTasks < env.limits.MAX_CONCURRENT_PROCESSCOMMITS
    ) {
      const commit = processQueue.shift()
      if (commit === undefined) break

      activeTasks++
      _processCommit(commit)
        .then(() => {
          const seq = Number.parseInt(commit.meta['seq'])
          knownBadCommits.delete(seq)
        })
        .catch(() => {
          const seq = Number.parseInt(commit.meta['seq'])
          const retries = knownBadCommits.get(seq)

          if (retries && retries >= env.limits.MAX_RETRIES) {
            knownBadCommits.delete(seq)
            logger.warn(
              `${seq} failed to process after ${env.limits.MAX_RETRIES} retries`,
            )
          } else {
            if (!retries) knownBadCommits.set(seq, 1)
            else knownBadCommits.set(seq, retries + 1)
            processCommit(commit)
          }
        })
        .finally(() => {
          activeTasks--
        })
    }
  } while (await wait(1))
}

queueManager()

export async function processCommit(commit: Commit): Promise<boolean> {
  while (
    processQueue.length >=
    env.limits.MAX_CONCURRENT_PROCESSCOMMITS * 1.2
  ) {
    await wait(1)
  }

  const isValidCommit = validateCommit(commit)
  if (isValidCommit.did && isValidCommit.seq) {
    processQueue.push(commit)
  }

  return isValidCommit.did ? true : false
}
