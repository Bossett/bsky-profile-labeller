import db, { schema, isNotNull, and, lte, isNull } from '@/db/db.js'
import limits from '@/env/limits.js'
import { sql } from 'drizzle-orm'

interface listOperations {
  [listUrl: string]: {
    [did: string]: {
      ids: number[]
      listItemURL: string | null
      did: string
      listURLId: number
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
    limit: 64,
  })

  return pendingCreates
    .map((create) => {
      return {
        id: create.id,
        did: create.did,
        listURL: listUrlFromId(create.listURLId),
        listURLId: create.listURLId,
        listItemURL: create.listItemURL,
      }
    })
    .reduce((acc, create) => {
      if (!acc[create.listURL]) acc[create.listURL] = {}
      if (!acc[create.listURL][create.did])
        acc[create.listURL][create.did] = {
          ids: [],
          listItemURL: create.listItemURL,
          listURLId: create.listURLId,
          did: create.did,
        }

      acc[create.listURL][create.did].ids.push(create.id)

      return acc
    }, {} as { [listUrl: string]: { [did: string]: { ids: number[]; listItemURL: string | null; listURLId: number; did: string } } })
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
    limit: 64,
  })

  return pendingRemoval
    .map((remove) => {
      return {
        id: remove.id,
        did: remove.did,
        listURL: listUrlFromId(remove.listURLId),
        listURLId: remove.listURLId,
        listItemURL: remove.listItemURL,
      }
    })
    .reduce((acc, remove) => {
      if (!acc[remove.listURL]) acc[remove.listURL] = {}
      if (!acc[remove.listURL][remove.did])
        acc[remove.listURL][remove.did] = {
          ids: [],
          listItemURL: remove.listItemURL,
          listURLId: remove.listURLId,
          did: remove.did,
        }

      acc[remove.listURL][remove.did].ids.push(remove.id)

      return acc
    }, {} as { [listUrl: string]: { [did: string]: { ids: number[]; listItemURL: string | null; listURLId: number; did: string } } })
}

export async function updateListItemURLs(
  items: {
    id: number
    listItemURL: string | null
    did: string
    listURLId: number
  }[],
) {
  if (items.length === 0) return 0
  const updatedIds: { updatedId: number }[] = []
  await db.transaction(async (tx) => {
    updatedIds.push(
      ...(await tx
        .insert(schema.listItems)
        .values(items)
        .onConflictDoUpdate({
          target: [schema.listItems.did, schema.listItems.listURLId],
          set: {
            listItemURL: sql.raw(
              `excluded."${schema.listItems.listItemURL.name}"`,
            ),
          },
        })
        .returning({ updatedId: schema.listItems.id })),
    )

    updatedIds.push(
      ...(await tx
        .delete(schema.listItems)
        .where(
          and(
            lte(
              schema.listItems.unixtimeDeleted,
              Math.floor(Date.now() / 1000),
            ),
            isNull(schema.listItems.listItemURL),
          ),
        )
        .returning({ updatedId: schema.listItems.id })),
    )
  })

  return updatedIds.length
}

export default lists
