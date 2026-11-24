import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/mysql2'
import { int, json, mysqlTable, text, timestamp, varchar } from 'drizzle-orm/mysql-core'
import { createPool } from 'mysql2/promise'
import { afterAll, describe, expect, it } from 'vitest'
import { defineTree } from '../src/mysql.js'
import { treeSuite } from './cases.js'

const url = process.env.MYSQL_URL

const categories = mysqlTable('categories', {
  id: int('id').primaryKey(),
  parentId: int('parent_id'),
  displayName: varchar('display_name', { length: 255 }).notNull(),
  tenantId: int('tenant_id').notNull(),
  meta: json('meta').$type<{ color: string }>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

const products = mysqlTable('products', {
  id: int('id').primaryKey(),
  categoryId: int('category_id').notNull(),
  title: text('title').notNull(),
})

const pool = url ? createPool({ uri: url, connectionLimit: 1 }) : undefined

afterAll(async () => {
  await pool?.end()
})

describe.skipIf(!url)('mysql', () => {
  treeSuite({
    name: 'mysql',
    categories,
    products,
    defineTree,
    setup: async () => {
      const db = drizzle({ client: pool! })
      await db.execute(sql`drop table if exists categories, products`)
      await db.execute(sql`create table categories (id int primary key, parent_id int, display_name varchar(255) not null, tenant_id int not null, meta json, created_at timestamp not null default current_timestamp)`)
      await db.execute(sql`create table products (id int primary key, category_id int not null, title text not null)`)
      return db
    },
    rawInsertCycle: async (db) => {
      await db.execute(sql`insert into categories (id, parent_id, display_name, tenant_id) values (100, 101, 'loop a', 1), (101, 100, 'loop b', 1)`)
    },
  })

  it('keeps long paths intact', async () => {
    const db = drizzle({ client: pool! })
    await db.execute(sql`drop table if exists categories, products`)
    await db.execute(sql`create table categories (id int primary key, parent_id int, display_name varchar(255) not null, tenant_id int not null, meta json, created_at timestamp not null default current_timestamp)`)
    const rows = Array.from({ length: 300 }, (_, i) => ({ id: 100000 + i, parentId: i === 0 ? null : 100000 + i - 1, displayName: `n${i}`, tenantId: 1 }))
    await db.insert(categories).values(rows)
    const tree = defineTree(categories, { id: categories.id, parentId: categories.parentId })
    const result = await tree.findDescendants(db, 100000)
    expect(result).toHaveLength(299)
    expect(result.at(-1)!.path.split('/')).toHaveLength(300)
  })
})
