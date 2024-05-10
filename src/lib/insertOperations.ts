import db, { schema } from '@/db/db.js'
import logger from '@/helpers/logger.js'
import env from '@/env/env.js'

const MAX_PENDING = env.limits.MAX_PENDING_INSERTS
const PENDING_INTERVAL = env.limits.MAX_PENDING_INSERTS_WAIT_MS

export type operationType = typeof schema.label_actions.$inferInsert

const pendingOperations: operationType[] = []
const operationsSet = new Set()

let insertTimeout: NodeJS.Timeout | null = null

export interface OperationsResult {
  create: string[]
  remove: string[]
}

function getOpKey(operation: operationType) {
  return JSON.stringify({
    label: operation.label,
    action: operation.action,
    did: operation.did,
  })
}

export async function insertOperations(
  operations: operationType[],
  force = false,
) {
  for (const operation of operations) {
    const operationKey = getOpKey(operation)
    if (!operationsSet.has(operationKey)) {
      operationsSet.add(operationKey)
      pendingOperations.push(operation)
    }
  }

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
      const operationKey = getOpKey(operation)
      if (operationsSet.has(operationKey)) {
        operationsSet.delete(operationKey)
        activeOps.push(operation)
      }
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
