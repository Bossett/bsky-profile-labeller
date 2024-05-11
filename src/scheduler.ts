import wait from '@/helpers/wait.js'
import db, { schema, eq, lte, isNotNull, and } from '@/db/db.js'
import env from '@/env/env.js'
import logger from '@/helpers/logger.js'

export default async function scheduler() {
  do {
    logger.debug('scheduler fired')
  } while (await wait(60000))
}
