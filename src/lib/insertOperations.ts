import db, { schema } from '@/db/db.js'
import logger from '@/helpers/logger.js'
import env from '@/env/env.js'

const MAX_PENDING = env.limits.MAX_PENDING_INSERTS
const PENDING_INTERVAL = env.limits.MAX_PENDING_INSERTS_WAIT_MS

export type operationType = typeof schema.label_actions.$inferInsert

const pendingOperations: operationType[] = []

let insertTimeout: NodeJS.Timeout | null = null

export interface OperationsResult {
  create: string[]
  remove: string[]
}

export async function insertOperations(
  operations: operationType[],
  force = false,
) {
  pendingOperations.push(...operations)
  logger.debug(
    `pendingOperations length: ${pendingOperations.length}, MAX_PENDING: ${MAX_PENDING}`,
  )

  if (insertTimeout === null && !force) {
    logger.debug(`new insert called, setting timer...`)
    insertTimeout = setTimeout(async () => {
      try {
        logger.debug(`timer triggered, forcing insert...`)
        await insertOperations([], true)
      } catch (error) {
        logger.error(`error in scheduled insert: ${error.message}`)
      }
    }, PENDING_INTERVAL)
  }

  if (pendingOperations.length < MAX_PENDING && !force) {
    logger.debug(`not enough operations to insert yet.`)
    return
  }

  clearTimeout(insertTimeout!)
  insertTimeout = null

  const activeOps = pendingOperations.splice(0, pendingOperations.length)
  logger.debug(`processing ${activeOps.length} operations...`)

  if (activeOps.length > 0) {
    try {
      const batchSize = 100
      while (activeOps.length > 0) {
        const batch = activeOps.splice(0, batchSize)
        logger.debug(`inserting batch of ${batch.length} operations...`)
        const retBatch = await db
          .insert(schema.label_actions)
          .values(batch)
          .returning()
        logger.debug(`inserted ${retBatch.length} operations.`)
      }
    } catch (error) {
      logger.error(`failed to insert operations: ${error.message}`, {
        error,
        activeOps,
      })
    }
  }
}
