# 配置说明

服务支持从环境变量读取配置，也支持从本地 dotenv 风格配置文件读取配置。

## 配置文件

推荐 MCP 客户端使用这种方式：

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
MYSQL_MCP_ENABLE_RAW_SQL=false
MYSQL_MCP_LOG_FILE=/path/to/mysql-readonly-audit.jsonl
```

MCP 客户端示例：

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

## 环境变量

必填：

- `MYSQL_USER`：MySQL 用户名。
- `MYSQL_DATABASE`：默认数据库 / schema。

可选：

- `MYSQL_HOST`：MySQL 主机，默认 `127.0.0.1`。
- `MYSQL_PORT`：MySQL 端口，默认 `3306`。
- `MYSQL_PASSWORD`：MySQL 密码，默认空字符串。
- `MYSQL_CONFIG_FILE`：本地配置文件路径。
- `MYSQL_MCP_MAX_LIMIT`：工具最大返回行数，默认 `500`，允许范围 `1` 到 `10000`。
- `MYSQL_MCP_QUERY_TIMEOUT_MS`：查询超时时间，默认 `10000`，允许范围 `100` 到 `300000`。
- `MYSQL_MCP_CONNECTION_LIMIT`：连接池数量，默认 `5`，允许范围 `1` 到 `100`。
- `MYSQL_MCP_ALLOW_SCHEMA_OVERRIDE`：是否允许工具读取 `MYSQL_DATABASE` 之外的 schema，默认 `false`。
- `MYSQL_MCP_ENABLE_RAW_SQL`：是否启用受信任的 `execute_readonly_sql` 工具，默认 `false`。
- `MYSQL_MCP_LOG_FILE`：可选 JSONL 审计日志文件路径。会记录执行的工具、SQL、耗时和状态，不记录查询结果。

环境变量会覆盖 `MYSQL_CONFIG_FILE` 文件里的同名配置。

整数和布尔配置如果填写非法，服务会在启动时直接报错，避免 MCP 客户端在异常限制下运行。

## 只读账号

建议创建专门的只读 MySQL 账号：

```sql
CREATE USER 'readonly_user'@'%' IDENTIFIED BY 'your_password';
GRANT SELECT, SHOW VIEW ON your_database.* TO 'readonly_user'@'%';
FLUSH PRIVILEGES;
```

实际使用时建议按环境收窄 host 和 database 权限。

