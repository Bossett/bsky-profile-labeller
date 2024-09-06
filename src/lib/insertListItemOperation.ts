import { OperationsResult } from '@/lib/insertOperations.js'
import db, { schema, eq, and, notInArray } from '@/db/db.js'
import lists from '@/lib/listManager.js'

export async function insertListItemOperation(
  did: string,
  labelOperations: OperationsResult,
) {
  if (labelOperations.remove.length > 0 || labelOperations.create.length > 0) {
    const currentLabels = new Set<string>(labelOperations.create)
    await syncListChangeToDb(did, currentLabels)
  }
}

async function syncListChangeToDb(did: string, currentLabels: Set<string>) {
  const unixNow = Math.floor(Date.now() / 1000)

  const listURLIds: number[] = []
  for (const { id: listURLId, labels: listLabels } of lists) {
    if (listLabels.every((label) => currentLabels.has(label))) {
      listURLIds.push(listURLId)
    }
  }

  const valueMap = listURLIds.map((id) => {
    return {
      did: did,
      listURLId: id,
      unixtimeDeleted: null,
    }
  })

  const allValidIds = new Set<number>([0])

  const checkExisting = await db
    .select({
      did: schema.listItems.did,
      listURLId: schema.listItems.listURLId,
      unixtimeDeleted: schema.listItems.unixtimeDeleted,
    })
    .from(schema.listItems)
    .where(eq(schema.listItems.did, did))

  const isValueMapAndExistingEqual =
    valueMap.length === checkExisting.length &&
    valueMap.every(
      (value) =>
        checkExisting.find(
          (existing) =>
            existing.did === value.did &&
            existing.listURLId === value.listURLId &&
            existing.unixtimeDeleted === value.unixtimeDeleted,
        ) !== undefined,
    )

  if (!isValueMapAndExistingEqual) {
    db.transaction(async (tx) => {
      if (valueMap.length > 0) {
        const validIds = await tx
          .insert(schema.listItems)
          .values(valueMap)
          .returning({
            id: schema.listItems.id,
          })
          .onConflictDoUpdate({
            target: [schema.listItems.did, schema.listItems.listURLId],
            set: { unixtimeDeleted: null },
          })

        validIds.forEach(({ id }) => allValidIds.add(id))
      }

      await tx
        .update(schema.listItems)
        .set({
          unixtimeDeleted: unixNow,
        })
        .where(
          and(
            eq(schema.listItems.did, did),
            notInArray(schema.listItems.id, Array.from(allValidIds)),
          ),
        )
    })
  }
}
