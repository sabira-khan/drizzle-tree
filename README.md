# drizzle-tree

[![CI](https://github.com/sabira-khan/drizzle-tree/actions/workflows/ci.yml/badge.svg)](https://github.com/sabira-khan/drizzle-tree/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/drizzle-tree)](https://www.npmjs.com/package/drizzle-tree)

Recursive tree queries for [Drizzle ORM](https://orm.drizzle.team). Point it at a table with a `parent_id` column and get descendants, ancestors and whole forests back as typed rows, with `depth` and `path` added.

```ts
import { defineTree } from 'drizzle-tree/pg'

const categoryTree = defineTree(categories, {
  id: categories.id,
  parentId: categories.parentId,
})

const rows = await categoryTree.findDescendants(db, 1)
// [
//   { id: 2, parentId: 1, name: 'Shirts', ..., depth: 1, path: '1/2' },
//   { id: 3, parentId: 2, name: 'Linen shirts', ..., depth: 2, path: '1/2/3' },
// ]
```

Every query is a `WITH RECURSIVE` CTE that works with the normal query builder, so you can join it, filter it and paginate it like any other table:

```ts
const sub = categoryTree.descendants({ of: clothingId })

const products = await db
  .with(sub)
  .select({ title: productsTable.title, category: sub.name, depth: sub.depth })
  .from(sub)
  .innerJoin(productsTable, eq(productsTable.categoryId, sub.id))
  .where(eq(sub.visible, true))
  .orderBy(sub.depth)
  .limit(20)
```

Column types come from your schema. Timestamps come back as `Date`, JSON columns as objects, and camelCase keys map to snake_case columns as usual.

## Install

```bash
npm install drizzle-tree
```

`drizzle-orm` is a peer dependency. No database extensions or extra columns are needed.

## Compatibility

| | Tested in CI |
|---|---|
| Databases | PostgreSQL (`drizzle-tree/pg`), SQLite (`drizzle-tree/sqlite`), MySQL 8.0+ (`drizzle-tree/mysql`) |
| drizzle-orm | 0.40, 0.44, 0.45, 1.0.0-rc.6 |
| Node.js | 20, 22, 24 |

Tests run against PGlite, libSQL and MySQL 8.4. Any Drizzle driver for these databases should work, since the package only uses the public query builder.

MySQL needs version 8.0 or later, since earlier versions have no recursive CTEs. MySQL stops a recursive query after 1000 levels by default. For deeper trees, raise `cte_max_recursion_depth` for the session, or pass `maxDepth`.

## API

### `defineTree(table, config)`

Import it from the entry point for your database: `drizzle-tree/pg`, `drizzle-tree/sqlite` or `drizzle-tree/mysql`.

```ts
const tree = defineTree(table, {
  id: table.id,
  parentId: table.parentId,
  depthName: 'depth',     // optional, name of the added depth column
  pathName: 'path',       // optional, name of the added path column
  pathSeparator: '/',     // optional
  alias: 'nodes_tree',    // optional, CTE name, defaults to `${tableName}_tree`
})
```

`depth` is the distance from the starting node, so direct children and direct parents are `1`. `path` is the chain of ids from the starting node, joined with the separator.

### Subqueries you can compose

Each of these returns a CTE for `db.with(...)`:

| Method | Returns |
|---|---|
| `tree.descendants({ of, includeSelf?, maxDepth?, where? })` | Children, grandchildren and so on |
| `tree.ancestors({ of, includeSelf?, maxDepth?, where? })` | Parent, grandparent and so on, up to the root |
| `tree.forest({ maxDepth?, where? })` | Every tree, starting from rows whose parent is `null` |

- `of` is one id or an array of ids.
- `includeSelf` adds the starting node with `depth: 0`. It is `false` by default, except for `forest`, where the roots are always included.
- `maxDepth` stops the walk after that many levels.
- `where` is applied at every level, for example to stay inside one tenant: `where: eq(categories.tenantId, tenantId)`.

Each method takes an optional second argument to override the CTE name, which lets you use two trees in one query:

```ts
const down = tree.descendants({ of: 2 }, 'down')
const up = tree.ancestors({ of: 2 }, 'up')
await db.with(down, up).select({ child: down.id, parent: up.id }).from(down).innerJoin(up, eq(up.depth, 1))
```

### Shortcuts that run the query

```ts
await tree.findDescendants(db, id, { includeSelf, maxDepth, where })
await tree.findAncestors(db, id, { includeSelf, maxDepth, where })
await tree.findForest(db, { maxDepth, where })
```

These return rows ordered by `depth`, then `path`.

### Nesting rows

```ts
const nested = tree.nest(await tree.findDescendants(db, rootId, { includeSelf: true }))
// [{ id: 1, ..., children: [{ id: 2, ..., children: [...] }] }]
```

`nest` builds the nested structure in memory from any rows that have the id and parent id fields. Pass a second argument to use a key other than `children`.

## Cycles

Bad data can create a loop, for example a row that is its own grandparent. Every query checks the path it has walked so far and stops before visiting a node twice, so a cycle never makes a query run forever.

## Why a package

Drizzle has no recursive CTE builder yet. The request has been open since 2023 ([drizzle-orm#209](https://github.com/drizzle-team/drizzle-orm/issues/209)), and there is a community branch for it. This package works on current releases, and goes beyond plain recursive CTEs. It adds the tree-specific parts you would otherwise write by hand: depth and path columns, cycle protection, scoping at every level, typed results, and nesting. If Drizzle adds `withRecursive`, these helpers still save you writing the same recursive query in every project.

The idea comes from [staudenmeir/laravel-adjacency-list](https://github.com/staudenmeir/laravel-adjacency-list), which does the same for Laravel's Eloquent.

## License

MIT
