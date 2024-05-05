import { AppBskyActorDefs, ComAtprotoLabelDefs } from '@atproto/api'

export async function getProfileLabel(
  profile: AppBskyActorDefs.ProfileViewDetailed,
  currentLabels: ComAtprotoLabelDefs.Label[],
): Promise<{ create?: string[]; remove?: string[] }> {
  const operations: { create: string[]; remove: string[] } = {
    create: [],
    remove: [],
  }

  if (!profile.did.startsWith('did:plc:')) {
    operations.create.push('nonplcdid')
  }

  if (profile.avatar === undefined || profile.avatar === '') {
    operations.create.push('noavatar')
  } else {
    operations.remove.push('noavatar')
  }

  if (profile.displayName === undefined || profile.displayName === '') {
    operations.create.push('nodisplayname')
  } else {
    operations.remove.push('nodisplayname')
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
