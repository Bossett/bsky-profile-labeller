import {
  primaryKey,
  pgTable,
  bigint,
  bigserial,
  text,
  index,
} from 'drizzle-orm/pg-core'

export const label_actions = pgTable(
  'label_actions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    label: text('label').notNull(),
    action: text('action').$type<'create' | 'remove'>().notNull(),
    did: text('did').notNull(),
    comment: text('comment'),
    unixtimescheduled: bigint('unixtimescheduled', { mode: 'number' }).default(
      0,
    ),
  },
  (table) => [index('time_idx').on(table.unixtimescheduled)],
)

export const subscription_status = pgTable('subscription_status', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  last_sequence: bigint('last_sequence', { mode: 'number' })
    .default(-1)
    .notNull(),
})

export const lists = pgTable('lists', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  label: text('label').notNull(),
  listURL: text('listURL').notNull(),
})

export const listItems = pgTable(
  'listItems',
  {
    id: bigserial('id', { mode: 'number' }).unique(),
    did: text('did').notNull(),
    listURLId: bigint('listURLId', { mode: 'number' })
      .references(() => lists.id)
      .notNull(),
    listItemURL: text('listItemURL'),
    unixtimeDeleted: bigint('unixtimeDeleted', { mode: 'number' }),
  },
  (table) => {
    return {
      pk: primaryKey({ columns: [table.did, table.listURLId] }),
      didIdx: index('did_idx').on(table.did),
      idIdx: index('id_idx').on(table.id),
    }
  },
)
