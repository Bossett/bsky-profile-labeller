import { agent } from '@/lib/bskyAgent.js'

export default async function emitAccountReport(
  label: string,
  did: string,
  comment: string | null | undefined,
): Promise<boolean> {
  try {
    await agent
      .withProxy('atproto_labeler', agent.session!.did)
      .api.tools.ozone.moderation.emitEvent({
        event: {
          $type: 'tools.ozone.moderation.defs#modEventReport',
          comment: `${comment}`,
          reportType: 'com.atproto.moderation.defs#reasonOther',
        },
        subject: {
          $type: 'com.atproto.admin.defs#repoRef',
          did: did,
        },
        createdBy: agent.session!.did,
      })
  } catch (e) {
    return false
  }
  return true
}
