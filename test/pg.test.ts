import { PGlite } from '@electric-sql/pglite'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { expectTypeOf, it } from 'vitest'
import { defineTree } from '../src/pg.js'
import { treeSuite } from './cases.js'

const categories = pgTable('categories', {
  id: integer('id').primaryKey(),
  parentId: integer('parent_id'),
  displayName: text('display_name').notNull(),
  tenantId: integer('tenant_id').notNull(),
  meta: jsonb('meta').$type<{ color: string }>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

const products = pgTable('products', {
  id: integer('id').primaryKey(),
  categoryId: integer('category_id').notNull(),
  title: text('title').notNull(),
})

treeSuite({
  name: 'postgres',
  categories,
  products,
  defineTree,
  setup: async () => {
    const db = drizzle({ client: new PGlite() })
    await db.execute(sql`create table categories (id integer primary key, parent_id integer, display_name text not null, tenant_id integer not null, meta jsonb, created_at timestamp not null default now())`)
    await db.execute(sql`create table products (id integer primary key, category_id integer not null, title text not null)`)
    return db
  },
  rawInsertCycle: async (db) => {
    await db.execute(sql`insert into categories (id, parent_id, display_name, tenant_id) values (100, 101, 'loop a', 1), (101, 100, 'loop b', 1)`)
  },
})

it('infers row and subquery types', async () => {
  const tree = defineTree(categories, { id: categories.id, parentId: categories.parentId })
  const db = drizzle({ client: new PGlite() })
  type Rows = Awaited<ReturnType<typeof tree.findDescendants>>
  expectTypeOf<Rows[number]['createdAt']>().toEqualTypeOf<Date>()
  expectTypeOf<Rows[number]['meta']>().toEqualTypeOf<{ color: string } | null>()
  expectTypeOf<Rows[number]['depth']>().toEqualTypeOf<number>()
  expectTypeOf<Rows[number]['path']>().toEqualTypeOf<string>()
  const sub = tree.descendants({ of: 1 })
  const query = db.with(sub).select({ name: sub.displayName, depth: sub.depth }).from(sub)
  expectTypeOf<Awaited<typeof query>[number]>().toEqualTypeOf<{ name: string, depth: number }>()
  const renamed = defineTree(categories, { id: categories.id, parentId: categories.parentId, depthName: 'level' })
  expectTypeOf<Awaited<ReturnType<typeof renamed.findAncestors>>[number]['level']>().toEqualTypeOf<number>()
})
