# Configuration

The server can read configuration from environment variables or a local dotenv-like config file.

## Config File

Recommended for MCP clients:

```bash
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=readonly_user
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=your_database
MYSQL_MCP_MAX_LIMIT=500
MYSQL_MCP_QUERY_TIMEOUT_MS=10000
MYSQL_MCP_CONNECTION_LIMIT=5
MYSQL_MCP_ALLOW_SCHEMA_OVERRIDE=false
MYSQL_MCP_LIMIT_RAW_SQL_AT_DB=false
MYSQL_MCP_LOG_FILE=/path/to/mysql-readonly-audit.jsonl
```

MCP client example:

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

## Environment Variables

Required:

- `MYSQL_USER`: MySQL username.
- `MYSQL_DATABASE`: Default database/schema.

Optional:

- `MYSQL_HOST`: MySQL host. Default: `127.0.0.1`.
- `MYSQL_PORT`: MySQL port. Default: `3306`.
- `MYSQL_PASSWORD`: MySQL password. Default: empty string.
- `MYSQL_CONFIG_FILE`: Path to a local config file.
- `MYSQL_MCP_MAX_LIMIT`: Maximum rows returned by tools. Default: `500`. Allowed range: `1` to `10000`.
- `MYSQL_MCP_QUERY_TIMEOUT_MS`: Query timeout. Default: `10000`. Allowed range: `100` to `300000`.
- `MYSQL_MCP_CONNECTION_LIMIT`: Pool connection limit. Default: `5`. Allowed range: `1` to `100`.
- `MYSQL_MCP_ALLOW_SCHEMA_OVERRIDE`: Allow tool calls to read schemas other than `MYSQL_DATABASE`. Default: `false`.
- `MYSQL_MCP_LIMIT_RAW_SQL_AT_DB`: Wrap `execute_readonly_sql` `SELECT` / `WITH` statements with a database-side `LIMIT`. Default: `false`, preserving the old behavior of executing SQL as provided and truncating only the MCP response payload. Enable it to reduce database result transfer for large queries.
- `MYSQL_MCP_LOG_FILE`: Optional JSONL audit log file path. Logs executed tool, SQL, timing, and status; query results are not logged.

Environment variables override values from `MYSQL_CONFIG_FILE`.

Invalid integer or boolean values fail fast during startup so MCP clients do not run with surprising limits.

## Read-Only User

Create a dedicated read-only MySQL account:

```sql
CREATE USER 'readonly_user'@'%' IDENTIFIED BY 'your_password';
GRANT SELECT, SHOW VIEW ON your_database.* TO 'readonly_user'@'%';
FLUSH PRIVILEGES;
```

Use the narrowest host and database permissions that fit your environment.

