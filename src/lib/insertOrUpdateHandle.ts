import logger from '@/lib/logger.js'
import db, { schema } from '@/db/db.js'

export default async function insertOrUpdateHandle(
  did: string,
  handle: string,
  unixtimeofchange: number,
) {
  await db
    .insert(schema.new_handles)
    .values({
      did: did,
      handle: handle,
      unixtimeofchange: unixtimeofchange,
    })
    .onConflictDoUpdate({
      target: schema.new_handles.did,
      set: {
        handle: handle,
        unixtimeofchange: unixtimeofchange,
        unixtimeoffirstpost: null,
      },
    })

  const time = new Date(unixtimeofchange * 1000).toISOString()
  // logger.info(`handle change ${handle} from ${did} at ${time}`)
}
