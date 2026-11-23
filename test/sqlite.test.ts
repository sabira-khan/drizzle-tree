import { createClient } from '@libsql/client'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { defineTree } from '../src/sqlite.js'
import { treeSuite } from './cases.js'

const categories = sqliteTable('categories', {
  id: integer('id').primaryKey(),
  parentId: integer('parent_id'),
  displayName: text('display_name').notNull(),
  tenantId: integer('tenant_id').notNull(),
  meta: text('meta', { mode: 'json' }).$type<{ color: string }>(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
})

const products = sqliteTable('products', {
  id: integer('id').primaryKey(),
  categoryId: integer('category_id').notNull(),
  title: text('title').notNull(),
})

treeSuite({
  name: 'sqlite',
  categories,
  products,
  defineTree,
  setup: async () => {
    const db = drizzle({ client: createClient({ url: ':memory:' }) })
    await db.run(sql`create table categories (id integer primary key, parent_id integer, display_name text not null, tenant_id integer not null, meta text, created_at integer not null default (unixepoch()))`)
    await db.run(sql`create table products (id integer primary key, category_id integer not null, title text not null)`)
    return db
  },
  rawInsertCycle: async (db) => {
    await db.run(sql`insert into categories (id, parent_id, display_name, tenant_id) values (100, 101, 'loop a', 1), (101, 100, 'loop b', 1)`)
  },
})
