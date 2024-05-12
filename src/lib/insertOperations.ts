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

  if (insertTimeout === null) {
    logger.debug(`new insert called, setting timer...`)
    insertTimeout = setTimeout(
      async () => await insertOperations([], true),
      PENDING_INTERVAL,
    )
  }

  if (pendingOperations.length < MAX_PENDING && !force) return

  clearTimeout(insertTimeout!)
  insertTimeout = null

  const activeOps: operationType[] = []

  while (pendingOperations.length > 0) {
    const operation = pendingOperations.pop()
    if (operation) {
      activeOps.push(operation)
    }
  }

  if (activeOps.length > 0) {
    await db
      .insert(schema.label_actions)
      .values(activeOps)
      .then(() => {
        logger.debug(`inserted ${activeOps.length} operations`)
      })
  }
}
