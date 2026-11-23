import { getTableColumns, type InferSelectModel, type SQL } from 'drizzle-orm'
import { QueryBuilder, integer, text, sqliteTable, type SQLiteTable } from 'drizzle-orm/sqlite-core'
import type { WithSubqueryWithSelection } from 'drizzle-orm/sqlite-core/subquery'
import { ancestorsSql, descendantsSql, nestRows, propertyKey, resolveTree, type Nested, type TraversalOptions, type TreeConfig } from './core.js'

export type { Nested, TraversalOptions, TreeConfig }

export interface TreeDatabase {
  with: (...queries: any[]) => any
}

const depthColumn = <N extends string>(name: N) => integer(name).notNull()
const pathColumn = <N extends string>(name: N) => text(name).notNull()

const extraTable = <TDepth extends string, TPath extends string>(depthName: TDepth, pathName: TPath) => sqliteTable('drizzle_tree', {
  [depthName]: depthColumn(depthName),
  [pathName]: pathColumn(pathName),
} as { [K in TDepth]: ReturnType<typeof depthColumn<K>> } & { [K in TPath]: ReturnType<typeof pathColumn<K>> })

type ExtraColumns<TDepth extends string, TPath extends string> = ReturnType<typeof extraTable<TDepth, TPath>>['_']['columns']

type TreeSelection<TTable extends SQLiteTable, TDepth extends string, TPath extends string> =
  TTable['_']['columns'] & ExtraColumns<TDepth, TPath>

type TreeRow<TTable extends SQLiteTable, TDepth extends string, TPath extends string> =
  InferSelectModel<TTable> & { [K in TDepth]: number } & { [K in TPath]: string }

export interface SQLiteTreeConfig<TTable extends SQLiteTable, TAlias extends string, TDepth extends string, TPath extends string> extends TreeConfig<TTable> {
  alias?: TAlias
  depthName?: TDepth
  pathName?: TPath
}

export function defineTree<
  TTable extends SQLiteTable,
  TAlias extends string = `${TTable['_']['name']}_tree`,
  TDepth extends string = 'depth',
  TPath extends string = 'path',
>(table: TTable, config: SQLiteTreeConfig<TTable, TAlias, TDepth, TPath>) {
  const tree = resolveTree(table, config, 'sqlite')
  const qb = new QueryBuilder()
  const extra = getTableColumns(extraTable(tree.depthName as TDepth, tree.pathName as TPath))
  const selection = { ...getTableColumns(table), ...extra } as unknown as TreeSelection<TTable, TDepth, TPath>
  const idKey = propertyKey(table, tree.id)
  const parentKey = propertyKey(table, tree.parentId)

  type Cte = WithSubqueryWithSelection<TreeSelection<TTable, TDepth, TPath>, TAlias>
  type Row = TreeRow<TTable, TDepth, TPath>

  const cte = (body: SQL, alias: string = tree.alias): Cte =>
    qb.$with(alias as TAlias, selection).as(body) as Cte

  const run = async (db: TreeDatabase, source: Cte): Promise<Row[]> => {
    const depth = (source as any)[tree.depthName]
    const path = (source as any)[tree.pathName]
    return await db.with(source).select().from(source as any).orderBy(depth, path) as Row[]
  }

  return {
    descendants: (options: TraversalOptions & { of: unknown }, alias?: string) => cte(descendantsSql(tree, options), alias),
    ancestors: (options: TraversalOptions & { of: unknown }, alias?: string) => cte(ancestorsSql(tree, options), alias),
    forest: (options: Omit<TraversalOptions, 'of'> = {}, alias?: string) => cte(descendantsSql(tree, { ...options, of: undefined }), alias),
    findDescendants: (db: TreeDatabase, of: unknown, options: Omit<TraversalOptions, 'of'> = {}) => run(db, cte(descendantsSql(tree, { ...options, of }))),
    findAncestors: (db: TreeDatabase, of: unknown, options: Omit<TraversalOptions, 'of'> = {}) => run(db, cte(ancestorsSql(tree, { ...options, of }))),
    findForest: (db: TreeDatabase, options: Omit<TraversalOptions, 'of'> = {}) => run(db, cte(descendantsSql(tree, { ...options, of: undefined }))),
    nest: <TRow extends Record<string, unknown>, TChildren extends string = 'children'>(rows: TRow[], childrenKey?: TChildren): Nested<TRow, TChildren>[] =>
      nestRows(rows, idKey as keyof TRow, parentKey as keyof TRow, childrenKey),
  }
}
