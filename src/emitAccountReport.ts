import { agent } from '@/lib/bskyAgent.js'
import { ToolsOzoneModerationEmitEvent } from '@atproto/api'

export default async function emitAccountReport({
  label,
  action,
  did,
  comment,
}: {
  label: string
  action: 'create' | 'remove'
  did: string
  comment: string | null | undefined
}): Promise<boolean> {
  const eventInput: ToolsOzoneModerationEmitEvent.InputSchema = {
    event: {
      $type: 'tools.ozone.moderation.defs#modEventLabel',
      createLabelVals: action === 'create' ? [label] : [],
      negateLabelVals: action === 'remove' ? [label] : [],
      comment: `${comment}`,
    },
    subject: {
      $type: 'com.atproto.admin.defs#repoRef',
      did: did,
    },
    createdBy: agent.session!.did,
  }

  try {
    await agent
      .withProxy('atproto_labeler', agent.session!.did)
      .api.tools.ozone.moderation.emitEvent(eventInput)
  } catch (e) {
    return false
  }
  return true
}
