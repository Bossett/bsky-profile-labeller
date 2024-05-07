import logger from '@/helpers/logger.js'
import db, { schema } from '@/db/db.js'

export default async function insertOrUpdateHandle(
  did: string,
  handle: string,
  unixtimeofchange: number,
  label: 'newaccount' | 'newhandle',
) {
  await db
    .insert(schema.new_handles)
    .values({
      did: did,
      handle: handle,
      unixtimeofchange: unixtimeofchange,
      label: label,
    })
    .onConflictDoUpdate({
      target: schema.new_handles.did,
      set: {
        handle: handle,
        unixtimeofchange: unixtimeofchange,
        unixtimeoffirstpost: null,
        label: label,
      },
    })

  const time = new Date(unixtimeofchange * 1000).toISOString()
  // logger.info(`handle change ${handle} from ${did} at ${time}`)
}
