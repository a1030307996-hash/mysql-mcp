# @chenyingxian/mysql-readonly-mcp

只读 MySQL MCP Server，用于让 MCP 客户端安全读取 MySQL 表结构、索引信息和少量样例数据。

服务会拒绝常见写入和 DDL SQL，但仍建议使用专门的只读 MySQL 账号运行。

## 文档

- [配置说明](./CONFIG.zh-CN.md)
- [工具说明](./MCP_TOOLS.zh-CN.md)
- [English README](./README.md)

## 安装

```bash
npm install -g @chenyingxian/mysql-readonly-mcp
```

也可以不全局安装，直接通过 `npx` 运行：

```bash
npx @chenyingxian/mysql-readonly-mcp
```

## 快速配置

把真实数据库配置写到本地配置文件：

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

然后 MCP 客户端只配置文件路径：

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

环境变量会覆盖 `MYSQL_CONFIG_FILE` 文件里的同名配置。

## 工具

- `list_tables`：列出数据库表和视图。
- `describe_table`：读取表字段和索引元数据。
- `sample_table`：按限制数量读取表样例数据。
- `execute_readonly_sql`：执行只读 `SELECT`、`SHOW`、`DESCRIBE`、`DESC`、`EXPLAIN` 或 `WITH` 语句。

## 安全说明

- 建议使用专门的只读 MySQL 账号。
- 不要在 MCP 客户端配置中直接暴露生产数据库密码。
- 不要发布真实 `.env` 文件、内部主机、数据库名、用户名或密码。

