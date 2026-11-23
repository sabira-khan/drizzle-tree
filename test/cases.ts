import { and, eq, getTableColumns } from 'drizzle-orm'
import { describe, expect, expectTypeOf, it } from 'vitest'

export interface Harness {
  name: string
  setup: () => Promise<any>
  categories: any
  products: any
  defineTree: (table: any, config: any) => any
  rawInsertCycle: (db: any) => Promise<void>
}

export function treeSuite(h: Harness) {
  const seed = async () => {
    const db = await h.setup()
    await db.insert(h.categories).values([
      { id: 1, parentId: null, displayName: 'Clothing', tenantId: 1, meta: { color: 'red' } },
      { id: 2, parentId: 1, displayName: 'Shirts', tenantId: 1, meta: null },
      { id: 3, parentId: 2, displayName: 'Linen shirts', tenantId: 1, meta: null },
      { id: 4, parentId: 1, displayName: 'Trousers', tenantId: 1, meta: null },
      { id: 5, parentId: null, displayName: 'Shoes', tenantId: 1, meta: null },
      { id: 6, parentId: 5, displayName: 'Boots', tenantId: 2, meta: null },
      { id: 7, parentId: 3, displayName: 'Short sleeve', tenantId: 1, meta: null },
    ])
    await db.insert(h.products).values([
      { id: 1, categoryId: 3, title: 'Linen shirt' },
      { id: 2, categoryId: 4, title: 'Chinos' },
      { id: 3, categoryId: 6, title: 'Chelsea boot' },
    ])
    const tree = h.defineTree(h.categories, { id: h.categories.id, parentId: h.categories.parentId })
    return { db, tree }
  }

  describe(h.name, () => {
    it('returns descendants with depth, path and mapped column values', async () => {
      const { db, tree } = await seed()
      const rows = await tree.findDescendants(db, 1)
      expect(rows.map((r: any) => [r.id, r.depth, r.path])).toEqual([
        [2, 1, '1/2'],
        [4, 1, '1/4'],
        [3, 2, '1/2/3'],
        [7, 3, '1/2/3/7'],
      ])
      expect(rows[0].displayName).toBe('Shirts')
      expect(rows[0].createdAt).toBeInstanceOf(Date)
      expect(Object.keys(rows[0])).toEqual([...Object.keys(getTableColumns(h.categories)), 'depth', 'path'])
    })

    it('includes the starting node when asked', async () => {
      const { db, tree } = await seed()
      const rows = await tree.findDescendants(db, 1, { includeSelf: true })
      expect(rows[0]).toMatchObject({ id: 1, depth: 0, path: '1', meta: { color: 'red' } })
    })

    it('stops at maxDepth', async () => {
      const { db, tree } = await seed()
      const rows = await tree.findDescendants(db, 1, { maxDepth: 1 })
      expect(rows.map((r: any) => r.id)).toEqual([2, 4])
    })

    it('returns ancestors nearest first', async () => {
      const { db, tree } = await seed()
      const rows = await tree.findAncestors(db, 7)
      expect(rows.map((r: any) => [r.id, r.depth, r.path])).toEqual([
        [3, 1, '7/3'],
        [2, 2, '7/3/2'],
        [1, 3, '7/3/2/1'],
      ])
    })

    it('walks the whole forest from the roots', async () => {
      const { db, tree } = await seed()
      const rows = await tree.findForest(db)
      expect(rows.filter((r: any) => r.depth === 0).map((r: any) => r.id)).toEqual([1, 5])
      expect(rows).toHaveLength(7)
    })

    it('accepts several starting nodes', async () => {
      const { db, tree } = await seed()
      const rows = await tree.findDescendants(db, [2, 5])
      expect(rows.map((r: any) => r.id).sort()).toEqual([3, 6, 7])
      expect(await tree.findDescendants(db, [])).toEqual([])
    })

    it('composes with where, joins and limit', async () => {
      const { db, tree } = await seed()
      const sub = tree.descendants({ of: 1 })
      const rows = await db.with(sub)
        .select({ title: h.products.title, category: sub.displayName, depth: sub.depth })
        .from(sub)
        .innerJoin(h.products, eq(h.products.categoryId, sub.id))
        .where(and(eq(sub.tenantId, 1)))
        .orderBy(h.products.title)
        .limit(5)
      expect(rows).toEqual([
        { title: 'Chinos', category: 'Trousers', depth: 1 },
        { title: 'Linen shirt', category: 'Linen shirts', depth: 2 },
      ])
    })

    it('applies a where condition to every level', async () => {
      const { db, tree } = await seed()
      const rows = await tree.findDescendants(db, 5, { where: eq(h.categories.tenantId, 1) })
      expect(rows).toEqual([])
      const all = await tree.findForest(db, { where: eq(h.categories.tenantId, 1) })
      expect(all.map((r: any) => r.id).sort()).toEqual([1, 2, 3, 4, 5, 7])
    })

    it('terminates on cycles', async () => {
      const { db, tree } = await seed()
      await h.rawInsertCycle(db)
      const rows = await tree.findDescendants(db, 100)
      expect(rows.map((r: any) => r.path)).toEqual(['100/101'])
      const up = await tree.findAncestors(db, 100)
      expect(up.map((r: any) => r.path)).toEqual(['100/101'])
    })

    it('supports custom names and two trees in one query', async () => {
      const { db } = await seed()
      const tree = h.defineTree(h.categories, { id: h.categories.id, parentId: h.categories.parentId, depthName: 'level', pathName: 'trail', pathSeparator: '>' })
      const down = tree.descendants({ of: 2 }, 'down')
      const up = tree.ancestors({ of: 2 }, 'up')
      const rows = await db.with(down, up).select({ child: down.id, parent: up.id, trail: down.trail, level: up.level }).from(down).innerJoin(up, eq(up.level, 1))
      expect(rows.sort((a: any, b: any) => a.child - b.child)).toEqual([
        { child: 3, parent: 1, trail: '2>3', level: 1 },
        { child: 7, parent: 1, trail: '2>3>7', level: 1 },
      ])
    })

    it('nests flat rows into children arrays', async () => {
      const { db, tree } = await seed()
      const nested = tree.nest(await tree.findDescendants(db, 1, { includeSelf: true }))
      expect(nested).toHaveLength(1)
      expect(nested[0].children.map((c: any) => c.id)).toEqual([2, 4])
      expect(nested[0].children[0].children[0].children[0].id).toBe(7)
    })

    it('rejects a table that already has a depth column', () => {
      expect(() => h.defineTree(h.categories, { id: h.categories.id, parentId: h.categories.parentId, depthName: 'display_name' })).toThrow(/depthName or pathName/)
    })

    it('rejects columns from another table', () => {
      expect(() => h.defineTree(h.categories, { id: h.products.id, parentId: h.categories.parentId })).toThrow(/columns of the table/)
    })
  })
}

export { expectTypeOf }
