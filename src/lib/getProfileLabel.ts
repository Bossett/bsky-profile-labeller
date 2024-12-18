import { AppBskyActorDefs, ComAtprotoLabelDefs } from '@atproto/api'

import { OperationsResult } from '@/lib/insertOperations.js'
import { getPlcPDS } from '@/lib/getPlcRecord.js'
import { boolean } from 'drizzle-orm/mysql-core'

export async function getProfileLabel(
  profile: AppBskyActorDefs.ProfileViewDetailed,
  currentLabels: ComAtprotoLabelDefs.Label[],
): Promise<OperationsResult> {
  const operations: OperationsResult = {
    create: [],
    remove: [],
  }

  const pds = await getPlcPDS(profile.did)

  if (pds && new URL(pds).hostname === 'atproto.brid.gy') {
    operations.create.push('bridgy')

    const isNostr: boolean =
      profile.handle.toLowerCase().match(/^npub[0-9a-z]{59}\.[a-z\.]+$/) !==
      null

    if (isNostr) operations.create.push('nostr')
    else operations.remove.push('nostr')

    const isThreads: boolean =
      profile.handle.toLowerCase().match(/\.threads\.net\.ap\.brid\.gy$/) !==
      null

    if (isThreads) operations.create.push('threads')
    else operations.remove.push('threads')
  } else {
    operations.remove.push('bridgy')
    operations.remove.push('nostr')
    operations.remove.push('threads')
  }

  if (pds && new URL(pds).hostname === 'atproto.brid.gy') {
    operations.create.push('nostr')
  }

  if (!profile.did.startsWith('did:plc:')) {
    operations.create.push('nonplcdid')
  }

  const noavatar = profile.avatar === undefined || profile.avatar === ''
  const nodisplayname =
    profile.displayName === undefined || profile.displayName === ''

  if (noavatar && nodisplayname) {
    operations.create.push('incomplete')
  } else {
    operations.remove.push('incomplete')
  }

  operations.create.filter(
    (label) => !currentLabels.map((curr) => curr.val).includes(label),
    // remove when already labelled
  )

  operations.remove.filter(
    (label) => currentLabels.map((curr) => curr.val).includes(label),
    // remove when already not labelled
  )

  return operations
}
