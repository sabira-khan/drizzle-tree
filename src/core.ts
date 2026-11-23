import { getTableColumns, getTableName, sql, type Column, type SQL, type Table } from 'drizzle-orm'

export type Dialect = 'pg' | 'sqlite'

export interface TreeConfig<TTable extends Table> {
  id: Column
  parentId: Column
  depthName?: string
  pathName?: string
  pathSeparator?: string
  alias?: string
}

export interface TraversalOptions {
  of?: unknown
  includeSelf?: boolean
  maxDepth?: number
  where?: SQL
}

export interface ResolvedTree {
  table: Table
  id: Column
  parentId: Column
  depthName: string
  pathName: string
  separator: string
  alias: string
  dialect: Dialect
}

export function resolveTree(table: Table, config: TreeConfig<Table>, dialect: Dialect): ResolvedTree {
  const columns = Object.values(getTableColumns(table))
  const names = new Set(columns.map(column => column.name))
  const depthName = config.depthName ?? 'depth'
  const pathName = config.pathName ?? 'path'
  for (const name of [depthName, pathName]) {
    if (names.has(name)) {
      throw new Error(`drizzle-tree: the table already has a column named "${name}". Pass depthName or pathName to use a different name.`)
    }
  }
  if (!columns.includes(config.id) || !columns.includes(config.parentId)) {
    throw new Error('drizzle-tree: id and parentId must be columns of the table passed to defineTree.')
  }
  const separator = config.pathSeparator ?? '/'
  if (separator.length === 0) {
    throw new Error('drizzle-tree: pathSeparator must not be empty.')
  }
  return {
    table,
    id: config.id,
    parentId: config.parentId,
    depthName,
    pathName,
    separator,
    alias: config.alias ?? `${getTableName(table)}_tree`,
    dialect,
  }
}

function asText(value: SQL | Column): SQL {
  return sql`cast(${value} as text)`
}

function contains(dialect: Dialect, haystack: SQL, needle: SQL): SQL {
  return dialect === 'pg' ? sql`strpos(${haystack}, ${needle}) > 0` : sql`instr(${haystack}, ${needle}) > 0`
}

function anchorCondition(tree: ResolvedTree, options: TraversalOptions): SQL {
  if (Array.isArray(options.of)) {
    if (options.of.length === 0) {
      return sql`1 = 0`
    }
    return sql`${tree.id} in (${sql.join(options.of.map(value => sql`${value}`), sql`, `)})`
  }
  return sql`${tree.id} = ${options.of}`
}

function traversal(tree: ResolvedTree, options: TraversalOptions, direction: 'down' | 'up'): SQL {
  const columns = Object.values(getTableColumns(tree.table))
  const columnList = sql.join(columns.map(column => sql`${tree.table}.${sql.identifier(column.name)}`), sql`, `)
  const r = sql.identifier('r')
  const depth = sql.identifier(tree.depthName)
  const path = sql.identifier(tree.pathName)
  const separator = sql`${tree.separator}`
  const where = options.where ? sql` and (${options.where})` : sql``
  const anchor = direction === 'down' && options.of === undefined
    ? sql`${tree.parentId} is null`
    : anchorCondition(tree, options)
  const join = direction === 'down'
    ? sql`${tree.parentId} = ${r}.${sql.identifier(tree.id.name)}`
    : sql`${tree.id} = ${r}.${sql.identifier(tree.parentId.name)}`
  const visited = sql`(${separator} || ${r}.${path} || ${separator})`
  const current = sql`(${separator} || ${asText(tree.id)} || ${separator})`
  const depthLimit = options.maxDepth === undefined ? sql`` : sql` and ${r}.${depth} < ${options.maxDepth}`
  const keepSelf = options.includeSelf ?? options.of === undefined
  const outerFilter = keepSelf ? sql`` : sql` where ${depth} > 0`

  return sql`with recursive ${r} as (select ${columnList}, 0 as ${depth}, ${asText(tree.id)} as ${path} from ${tree.table} where ${anchor}${where} union all select ${columnList}, ${r}.${depth} + 1, ${r}.${path} || ${separator} || ${asText(tree.id)} from ${tree.table} join ${r} on ${join} where not ${contains(tree.dialect, visited, current)}${depthLimit}${where}) select * from ${r}${outerFilter}`
}

export function descendantsSql(tree: ResolvedTree, options: TraversalOptions): SQL {
  return traversal(tree, options, 'down')
}

export function ancestorsSql(tree: ResolvedTree, options: TraversalOptions): SQL {
  if (options.of === undefined) {
    throw new Error('drizzle-tree: ancestors() needs an "of" value.')
  }
  return traversal(tree, options, 'up')
}

export function propertyKey(table: Table, column: Column): string {
  const entry = Object.entries(getTableColumns(table)).find(([, value]) => value === column)
  if (!entry) {
    throw new Error(`drizzle-tree: column "${column.name}" is not part of the table.`)
  }
  return entry[0]
}

export type Nested<TRow, TChildren extends string = 'children'> = TRow & { [K in TChildren]: Nested<TRow, TChildren>[] }

export function nestRows<TRow extends Record<string, unknown>, TChildren extends string = 'children'>(
  rows: TRow[],
  idKey: keyof TRow,
  parentKey: keyof TRow,
  childrenKey: TChildren = 'children' as TChildren,
): Nested<TRow, TChildren>[] {
  const nodes = new Map<unknown, Nested<TRow, TChildren>>()
  for (const row of rows) {
    nodes.set(row[idKey], { ...row, [childrenKey]: [] } as Nested<TRow, TChildren>)
  }
  const roots: Nested<TRow, TChildren>[] = []
  for (const node of nodes.values()) {
    const parent = nodes.get(node[parentKey])
    if (parent && parent !== node) {
      (parent[childrenKey] as Nested<TRow, TChildren>[]).push(node)
    }
    else {
      roots.push(node)
    }
  }
  return roots
}
