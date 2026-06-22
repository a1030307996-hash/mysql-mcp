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
- `columns`: Optional column names to read. Defaults to all non-large columns.
- `includeLargeColumns`: Include `TEXT`, `BLOB`, `JSON`, and geometry columns in samples. Default: `false`.
- `limit`: Rows to return. Capped by `MYSQL_MCP_MAX_LIMIT`.
- `offset`: Rows to skip. Default: `0`.

By default, `sample_table` avoids large columns to keep sample reads lightweight. Set `columns` and `includeLargeColumns=true` when those fields are intentionally needed.

## `execute_readonly_sql`

Execute a trusted read-only SQL statement.

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

The server rejects multiple statements, MySQL executable comments, and common write, DDL, transaction, lock, file-output, and administrative keywords.

It also strips SQL comments and string literals before keyword checks, blocks common DoS or side-effect functions such as `SLEEP`, `BENCHMARK`, `GET_LOCK`, and `LOAD_FILE`, and disables schema overrides by default.

By default, `execute_readonly_sql` executes the SQL as provided and truncates only the MCP response payload with `maxRows`, preserving old behavior. Set `MYSQL_MCP_LIMIT_RAW_SQL_AT_DB=true` only when you want database-side `LIMIT` wrapping for `SELECT` / `WITH` result transfer.

If `MYSQL_MCP_LOG_FILE` is configured, each tool call writes one JSON line with timestamp, tool name, status, duration, and SQL metadata. Query result rows are not logged.

