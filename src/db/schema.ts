import { integer, pgTable, serial, text, index } from 'drizzle-orm/pg-core'

export const new_handles = pgTable(
  'new_handles',
  {
    id: serial('id').primaryKey(),
    did: text('did').unique().notNull(),
    handle: text('handle'),
    unixtimeofchange: integer('unixtimeofchange'),
    unixtimeoffirstpost: integer('unixtimeoffirstpost'),
  },
  (table) => {
    return {
      didIdx: index('did_idx').on(table.did),
    }
  },
)

export const label_actions = pgTable('label_actions', {
  id: serial('id').primaryKey(),
  label: text('label').notNull(),
  action: text('action').$type<'create' | 'remove'>().notNull(),
  did: text('did').notNull(),
  comment: text('comment'),
  unixtimescheduled: integer('unixtimescheduled').default(0),
})

export const subscription_status = pgTable('subscription_status', {
  id: serial('id').primaryKey(),
  last_sequence: integer('last_sequence').default(-1).notNull(),
})
