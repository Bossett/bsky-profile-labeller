import { integer, pgTable, serial, text } from 'drizzle-orm/pg-core'

export const new_handles = pgTable('new_handles', {
  id: serial('id').primaryKey(),
  did: text('name').unique().notNull(),
  handle: text('handle'),
  unixtimeofchange: integer('unixtimeofchange'),
  unixtimeoffirstpost: integer('unixtimeoffirstpost'),
})

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
