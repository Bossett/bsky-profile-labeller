import { OperationsResult } from '@/lib/insertOperations.js'
import { AppBskyActorDefs } from '@atproto/api'
import getUserDetails from '@/lib/getUserDetails.js'
import { agentDid } from '@/lib/bskyAgent.js'

export async function insertListItemOperation(
  did: string,
  labelOperations: OperationsResult,
) {
  const tmpData: AppBskyActorDefs.ProfileViewDetailed | { error: string } =
    await getUserDetails(did)

  if (tmpData.error) {
    return
  }

  const profileData = tmpData as AppBskyActorDefs.ProfileViewDetailed
  const currentLabels = (
    profileData.labels
      ? profileData.labels.filter((label) => {
          return label.src === agentDid && !label.neg
        })
      : []
  ).map((label) => label.val)

  if (
    currentLabels.length > 0 ||
    labelOperations.remove.length > 0 ||
    labelOperations.create.length > 0
  ) {
    // should be on ${currentLabels}
    // to be removed from ${labelOperations.remove}
    // to be added to ${labelOperations.create}
  }
}
