# MCP Tools

All tools return JSON text.

## `list_tables`

List tables in the configured MySQL database.

Parameters:

- `schema`: Optional database/schema name. Defaults to `MYSQL_DATABASE`.
- `includeViews`: Include views in the result. Default: `true`.

## `describe_table`

Read column and index metadata for one table.

Parameters:

- `table`: Table name.
- `schema`: Optional database/schema name. Defaults to `MYSQL_DATABASE`.

## `sample_table`

Read rows from a table with capped `LIMIT/OFFSET`.

Parameters:

- `table`: Table name.
- `schema`: Optional database/schema name. Defaults to `MYSQL_DATABASE`.
- `limit`: Rows to return. Capped by `MYSQL_MCP_MAX_LIMIT`.
- `offset`: Rows to skip. Default: `0`.

## `execute_readonly_sql`

Execute a read-only SQL statement.

Allowed statement prefixes:

- `SELECT`
- `SHOW`
- `DESCRIBE`
- `DESC`
- `EXPLAIN`
- `WITH`

Parameters:

- `sql`: Read-only SQL statement.
- `params`: Optional `?` placeholder values.
- `maxRows`: Maximum rows to return. Capped by `MYSQL_MCP_MAX_LIMIT`.

The server rejects multiple statements and common write, DDL, transaction, lock, file-output, and administrative keywords.

It also strips SQL comments before keyword checks, blocks common DoS or side-effect functions such as `SLEEP`, `BENCHMARK`, `GET_LOCK`, and `LOAD_FILE`, and disables schema overrides by default.

If `MYSQL_MCP_LOG_FILE` is configured, each tool call writes one JSON line with timestamp, tool name, status, duration, and SQL metadata. Query result rows are not logged.

