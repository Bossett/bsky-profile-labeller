import db, {
  schema,
  isNotNull,
  and,
  lte,
  isNull,
  eq,
  inArray,
} from '@/db/db.js'

interface listOperations {
  [listUrl: string]: {
    [did: string]: {
      ids: number[]
      listItemURL: string | null
    }
  }
}

export const lists: {
  listUrl: string
  id: number
  alternateIds: number[]
  labels: string[]
}[] = []
await updateLists()

function listUrlFromId(id: number): string {
  const url = lists.find((list) => list.alternateIds.includes(id))?.listUrl
  if (url) return url
  throw new Error(`List URL not found for id ${id}`)
}

export async function updateLists() {
  const dbLists = await db.query.lists.findMany({
    columns: {
      id: true,
      label: true,
      listURL: true,
    },
  })

  lists.length = 0
  lists.push(
    ...dbLists.reduce((acc, list) => {
      const idx = acc.findIndex(
        (existingList) => existingList.listUrl === list.listURL,
      )
      if (idx === -1)
        acc.push({
          listUrl: list.listURL,
          id: list.id,
          alternateIds: [list.id],
          labels: [list.label],
        })
      else {
        if (!acc[idx].labels.includes(list.label))
          acc[idx].labels.push(list.label)
        if (!acc[idx].alternateIds.includes(list.id))
          acc[idx].alternateIds.push(list.id)
      }
      return acc
    }, [] as { listUrl: string; id: number; alternateIds: number[]; labels: string[] }[]),
  )
}

export async function getAllPending() {
  const pendingCreates = await getPendingCreates()
  const pendingRemoval = await getPendingRemoval()

  return {
    creates: pendingCreates,
    removals: pendingRemoval,
  }
}

async function getPendingCreates(): Promise<listOperations> {
  const pendingCreates = await db.query.listItems.findMany({
    where: and(
      isNull(schema.listItems.listItemURL),
      isNull(schema.listItems.unixtimeDeleted),
    ),
    columns: {
      id: true,
      did: true,
      listURLId: true,
      listItemURL: true,
    },
  })

  return pendingCreates
    .map((create) => {
      return {
        id: create.id,
        did: create.did,
        listURL: listUrlFromId(create.listURLId),
        listItemURL: create.listItemURL,
      }
    })
    .reduce((acc, create) => {
      if (!acc[create.listURL]) acc[create.listURL] = {}
      if (!acc[create.listURL][create.did])
        acc[create.listURL][create.did] = {
          ids: [],
          listItemURL: create.listItemURL,
        }

      acc[create.listURL][create.did].ids.push(create.id)

      return acc
    }, {} as { [listUrl: string]: { [did: string]: { ids: number[]; listItemURL: string | null } } })
}

async function getPendingRemoval(): Promise<listOperations> {
  const pendingRemoval = await db.query.listItems.findMany({
    where: and(
      isNotNull(schema.listItems.unixtimeDeleted),
      lte(schema.listItems.unixtimeDeleted, Math.floor(Date.now() / 1000)),
      isNotNull(schema.listItems.listItemURL),
    ),
    columns: {
      id: true,
      did: true,
      listURLId: true,
      listItemURL: true,
    },
  })

  return pendingRemoval
    .map((remove) => {
      return {
        id: remove.id,
        did: remove.did,
        listURL: listUrlFromId(remove.listURLId),
        listItemURL: remove.listItemURL,
      }
    })
    .reduce((acc, remove) => {
      if (!acc[remove.listURL]) acc[remove.listURL] = {}
      if (!acc[remove.listURL][remove.did])
        acc[remove.listURL][remove.did] = {
          ids: [],
          listItemURL: remove.listItemURL,
        }

      acc[remove.listURL][remove.did].ids.push(remove.id)

      return acc
    }, {} as { [listUrl: string]: { [did: string]: { ids: number[]; listItemURL: string | null } } })
}

export async function updateListItemURLs(
  groupedItems: { listItemURL: string | null; ids: number[] }[],
) {
  const updatedIds: { updatedId: number }[] = []
  await db.transaction(async (tx) => {
    for (const { listItemURL, ids } of groupedItems) {
      updatedIds.push(
        ...(await tx
          .update(schema.listItems)
          .set({
            listItemURL: listItemURL,
          })
          .where(inArray(schema.listItems.id, ids))
          .returning({ updatedId: schema.listItems.id })),
      )
    }
    tx.delete(schema.listItems).where(
      and(
        lte(schema.listItems.unixtimeDeleted, Math.floor(Date.now() / 1000)),
        isNull(schema.listItems.listItemURL),
      ),
    )
  })

  return updatedIds.length
}

export default lists
