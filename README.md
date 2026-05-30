# @chenyingxian/mysql-readonly-mcp

Read-only MySQL MCP server for safe schema inspection and SELECT-style queries.

This package is intended for MCP clients that need controlled access to MySQL metadata and sample data. It rejects common write and DDL statements, but you should still run it with a dedicated read-only MySQL account.

## Documentation

- [Configuration](https://github.com/a1030307996-hash/mysql-mcp/blob/main/CONFIG.md)
- [MCP Tools](https://github.com/a1030307996-hash/mysql-mcp/blob/main/MCP_TOOLS.md)
- [中文文档](https://github.com/a1030307996-hash/mysql-mcp/blob/main/README.zh-CN.md)
- [GitHub Repository](https://github.com/a1030307996-hash/mysql-mcp)

## Installation

```bash
npm install -g @chenyingxian/mysql-readonly-mcp
```

You can also run it without a global install:

```bash
npx @chenyingxian/mysql-readonly-mcp
```

## Quick Configuration

Put credentials in a local config file:

```bash
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=readonly_user
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=your_database
MYSQL_MCP_MAX_LIMIT=500
MYSQL_MCP_QUERY_TIMEOUT_MS=10000
MYSQL_MCP_CONNECTION_LIMIT=5
```

Then expose only the file path to your MCP client:

```json
{
  "mcpServers": {
    "mysql-readonly": {
      "command": "npx",
      "args": ["-y", "@chenyingxian/mysql-readonly-mcp@latest"],
      "env": {
        "MYSQL_CONFIG_FILE": "/path/to/mysql-readonly.env"
      }
    }
  }
}
```

Environment variables override values from `MYSQL_CONFIG_FILE`.

## Tools

- `list_tables`: List tables and views.
- `describe_table`: Read column and index metadata.
- `sample_table`: Read a limited sample from one table.
- `execute_readonly_sql`: Execute a read-only `SELECT`, `SHOW`, `DESCRIBE`, `DESC`, `EXPLAIN`, or `WITH` statement.

## Safety Notes

- Use a dedicated MySQL account with only the minimum read permissions.
- Do not expose production credentials in MCP client config.
- Do not publish real `.env` files, internal hosts, database names, usernames, or passwords.

