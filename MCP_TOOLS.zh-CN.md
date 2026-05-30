# MCP 工具说明

所有工具都返回 JSON 文本。

## `list_tables`

列出配置数据库中的表。

参数：

- `schema`：可选数据库 / schema 名称，默认使用 `MYSQL_DATABASE`。
- `includeViews`：是否包含视图，默认 `true`。

## `describe_table`

读取指定表的字段和索引元数据。

参数：

- `table`：表名。
- `schema`：可选数据库 / schema 名称，默认使用 `MYSQL_DATABASE`。

## `sample_table`

按受限的 `LIMIT/OFFSET` 读取表数据样例。

参数：

- `table`：表名。
- `schema`：可选数据库 / schema 名称，默认使用 `MYSQL_DATABASE`。
- `limit`：返回行数，会被 `MYSQL_MCP_MAX_LIMIT` 限制。
- `offset`：跳过行数，默认 `0`。

## `execute_readonly_sql`

执行只读 SQL。

允许的语句前缀：

- `SELECT`
- `SHOW`
- `DESCRIBE`
- `DESC`
- `EXPLAIN`
- `WITH`

参数：

- `sql`：只读 SQL。
- `params`：可选 `?` 占位参数。
- `maxRows`：最大返回行数，会被 `MYSQL_MCP_MAX_LIMIT` 限制。

服务会拒绝多语句，以及常见写入、DDL、事务、锁、文件输出和管理类关键字。

服务会先去除 SQL 注释再检查关键字，并阻止 `SLEEP`、`BENCHMARK`、`GET_LOCK`、`LOAD_FILE` 等常见 DoS 或副作用函数；默认也不允许通过工具参数切换到其它 schema。

如果配置了 `MYSQL_MCP_LOG_FILE`，每次工具调用会写入一行 JSON 日志，包含时间、工具名、状态、耗时和 SQL 元信息，不记录查询结果行。

