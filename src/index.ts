#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { appendFileSync, readFileSync } from "node:fs";
import mysql, { type RowDataPacket } from "mysql2/promise";
import * as z from "zod/v4";

loadConfigFile();

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = Number.parseInt(process.env.MYSQL_MCP_MAX_LIMIT ?? "500", 10);
const QUERY_TIMEOUT_MS = Number.parseInt(process.env.MYSQL_MCP_QUERY_TIMEOUT_MS ?? "10000", 10);
const ALLOW_SCHEMA_OVERRIDE = process.env.MYSQL_MCP_ALLOW_SCHEMA_OVERRIDE === "true";
const LOG_FILE = process.env.MYSQL_MCP_LOG_FILE || "";

type QueryValue = string | number | boolean | null;
type MysqlPool = ReturnType<typeof mysql.createPool>;

type TableRow = RowDataPacket & {
  TABLE_SCHEMA: string;
  TABLE_NAME: string;
  TABLE_TYPE: string;
  TABLE_COMMENT: string;
  TABLE_ROWS: number | null;
};

type ColumnRow = RowDataPacket & {
  COLUMN_NAME: string;
  ORDINAL_POSITION: number;
  COLUMN_TYPE: string;
  IS_NULLABLE: "YES" | "NO";
  COLUMN_DEFAULT: string | null;
  COLUMN_KEY: string;
  EXTRA: string;
  COLUMN_COMMENT: string;
};

type IndexRow = RowDataPacket & {
  INDEX_NAME: string;
  NON_UNIQUE: number;
  SEQ_IN_INDEX: number;
  COLUMN_NAME: string;
  INDEX_TYPE: string;
};

/**
 * Load a dotenv-like config file before reading MySQL environment variables.
 */
function loadConfigFile(): void {
  const configFile = process.env.MYSQL_CONFIG_FILE;
  if (!configFile) return;
  const entries = parseEnvFile(readFileSync(configFile, "utf8"));
  for (const [key, value] of Object.entries(entries)) {
    if (process.env[key] === undefined || process.env[key] === "") process.env[key] = value;
  }
}

/**
 * Parse simple KEY=value config text.
 */
function parseEnvFile(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    result[match[1]] = unquoteEnvValue(match[2].trim());
  }
  return result;
}

/**
 * Remove simple quotes from dotenv values.
 */
function unquoteEnvValue(value: string): string {
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) return value.slice(1, -1);
  return value;
}

function getEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getDatabase(): string {
  return getEnv("MYSQL_DATABASE");
}

function createPool(): MysqlPool {
  return mysql.createPool({
    host: getEnv("MYSQL_HOST", "127.0.0.1"),
    port: Number.parseInt(getEnv("MYSQL_PORT", "3306"), 10),
    user: getEnv("MYSQL_USER"),
    password: getEnv("MYSQL_PASSWORD", ""),
    database: getDatabase(),
    waitForConnections: true,
    connectionLimit: Number.parseInt(process.env.MYSQL_MCP_CONNECTION_LIMIT ?? "5", 10),
    namedPlaceholders: false,
    multipleStatements: false,
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true
  });
}

function clampLimit(limit: number | undefined): number {
  const requested = limit ?? DEFAULT_LIMIT;
  return Math.max(1, Math.min(requested, MAX_LIMIT));
}

function escapeIdentifier(identifier: string): string {
  if (!/^[A-Za-z0-9_$]+$/.test(identifier)) {
    throw new Error(`Invalid identifier: ${identifier}`);
  }
  return `\`${identifier.replace(/`/g, "``")}\``;
}

function normalizeSql(sql: string): string {
  return sql.trim().replace(/;+\s*$/, "").trim();
}

function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*![\s\S]*?\*\//g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n\r]*(?:\r?\n|$)/g, " ")
    .replace(/#[^\n\r]*(?:\r?\n|$)/g, " ");
}

function compactSqlForKeywordChecks(sql: string): string {
  return stripSqlComments(sql).replace(/\s+/g, " ").trim();
}

function assertReadOnlySql(sql: string): string {
  const normalized = normalizeSql(sql);
  if (!normalized) {
    throw new Error("SQL cannot be empty.");
  }

  if (normalized.includes(";")) {
    throw new Error("Multiple SQL statements are not allowed.");
  }

  const checkedSql = compactSqlForKeywordChecks(normalized);

  if (!/^(select|show|describe|desc|explain|with)\b/i.test(checkedSql)) {
    throw new Error("Only read-only SQL is allowed: SELECT, SHOW, DESCRIBE, DESC, EXPLAIN, or WITH.");
  }

  const blockedPatterns = [
    /\b(insert|update|delete|replace|merge|upsert)\b/i,
    /\b(create|alter|drop|truncate|rename)\b/i,
    /\b(grant|revoke|commit|rollback|savepoint|start\s+transaction)\b/i,
    /\b(call|do|handler|load\s+data|load\s+xml)\b/i,
    /\b(set|reset|flush|kill|lock|unlock|optimize|repair|analyze)\b/i,
    /\binto\s+(out|dump)file\b/i,
    /\bfor\s+update\b/i,
    /\block\s+in\s+share\s+mode\b/i,
    /\b(sleep|benchmark|get_lock|release_lock|is_free_lock|is_used_lock|load_file)\s*\(/i
  ];

  for (const pattern of blockedPatterns) {
    if (pattern.test(checkedSql)) {
      throw new Error("SQL contains a blocked keyword or clause for a read-only server.");
    }
  }

  return normalized;
}

function resolveSchema(schema: string | undefined): string {
  const configured = getDatabase();
  if (!schema || schema === configured) return configured;
  if (!ALLOW_SCHEMA_OVERRIDE) {
    throw new Error("Schema override is disabled. Set MYSQL_MCP_ALLOW_SCHEMA_OVERRIDE=true to allow it.");
  }
  return schema;
}

function writeAuditLog(entry: Record<string, unknown>): void {
  if (!LOG_FILE) return;
  const payload = { timestamp: new Date().toISOString(), ...entry };
  appendFileSync(LOG_FILE, `${JSON.stringify(payload)}\n`, "utf8");
}

async function auditTool<T>(tool: string, details: Record<string, unknown>, action: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await action();
    writeAuditLog({ tool, status: "success", durationMs: Date.now() - startedAt, ...details });
    return result;
  } catch (error) {
    writeAuditLog({ tool, status: "error", durationMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error), ...details });
    throw error;
  }
}

function asText(data: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2)
      }
    ]
  };
}

const LIST_TABLES_SQL = `SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE, TABLE_COMMENT, TABLE_ROWS
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_TYPE IN (?)
     ORDER BY TABLE_NAME`;
const DESCRIBE_COLUMNS_SQL = `SELECT COLUMN_NAME, ORDINAL_POSITION, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT,
            COLUMN_KEY, EXTRA, COLUMN_COMMENT
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
     ORDER BY ORDINAL_POSITION`;
const DESCRIBE_INDEXES_SQL = `SELECT INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME, INDEX_TYPE
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
     ORDER BY INDEX_NAME, SEQ_IN_INDEX`;

async function listTables(pool: MysqlPool, schema: string, includeViews: boolean) {
  const tableTypes = includeViews ? ["BASE TABLE", "VIEW"] : ["BASE TABLE"];
  const [rows] = await pool.query<TableRow[]>(
    LIST_TABLES_SQL,
    [schema, tableTypes]
  );
  return rows;
}

async function getColumns(pool: MysqlPool, schema: string, table: string) {
  const [rows] = await pool.query<ColumnRow[]>(
    DESCRIBE_COLUMNS_SQL,
    [schema, table]
  );
  return rows;
}

async function getIndexes(pool: MysqlPool, schema: string, table: string) {
  const [rows] = await pool.query<IndexRow[]>(
    DESCRIBE_INDEXES_SQL,
    [schema, table]
  );
  return rows;
}

async function main() {
  const pool = createPool();
  const server = new McpServer({
    name: "mysql-readonly-mcp",
    version: "0.1.0"
  });

  server.registerTool(
    "list_tables",
    {
      title: "List MySQL Tables",
      description: "List tables in the configured MySQL database.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        schema: z.string().optional().describe("Database/schema name. Defaults to MYSQL_DATABASE."),
        includeViews: z.boolean().optional().default(true).describe("Include views in the result.")
      }
    },
    async ({ schema, includeViews }) => {
      const database = resolveSchema(schema);
      const rows = await auditTool("list_tables", { schema: database, includeViews: includeViews ?? true, sql: LIST_TABLES_SQL, paramCount: 2 }, () => listTables(pool, database, includeViews ?? true));
      return asText({ count: rows.length, tables: rows });
    }
  );

  server.registerTool(
    "describe_table",
    {
      title: "Describe MySQL Table",
      description: "Read column and index metadata for a table.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        table: z.string().min(1).describe("Table name."),
        schema: z.string().optional().describe("Database/schema name. Defaults to MYSQL_DATABASE.")
      }
    },
    async ({ table, schema }) => {
      const database = resolveSchema(schema);
      const [columns, indexes] = await auditTool("describe_table", { schema: database, table, sql: [DESCRIBE_COLUMNS_SQL, DESCRIBE_INDEXES_SQL], paramCount: 4 }, async () => {
        const result = await Promise.all([
          getColumns(pool, database, table),
          getIndexes(pool, database, table)
        ]);
        if (result[0].length === 0) throw new Error(`Table not found or has no visible columns: ${database}.${table}`);
        return result;
      });

      return asText({
        schema: database,
        table,
        columns,
        indexes
      });
    }
  );

  server.registerTool(
    "sample_table",
    {
      title: "Sample MySQL Table Data",
      description: "Read rows from a table with a capped LIMIT.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        table: z.string().min(1).describe("Table name."),
        schema: z.string().optional().describe("Database/schema name. Defaults to MYSQL_DATABASE."),
        limit: z.number().int().positive().max(MAX_LIMIT).optional().describe(`Rows to return. Max ${MAX_LIMIT}.`),
        offset: z.number().int().nonnegative().optional().default(0).describe("Rows to skip.")
      }
    },
    async ({ table, schema, limit, offset }) => {
      const database = resolveSchema(schema);
      const tableName = `${escapeIdentifier(database)}.${escapeIdentifier(table)}`;
      const finalLimit = clampLimit(limit);
      const finalOffset = offset ?? 0;
      const sampleSql = `SELECT * FROM ${tableName} LIMIT ? OFFSET ?`;
      const [rows] = await auditTool("sample_table", { schema: database, table, limit: finalLimit, offset: finalOffset, sql: sampleSql, paramCount: 2 }, () => pool.query<RowDataPacket[]>(
        sampleSql,
        [finalLimit, finalOffset]
      ));

      return asText({
        schema: database,
        table,
        limit: finalLimit,
        offset: finalOffset,
        rows
      });
    }
  );

  server.registerTool(
    "execute_readonly_sql",
    {
      title: "Execute Read-Only MySQL SQL",
      description: "Execute a read-only SELECT/SHOW/DESCRIBE/EXPLAIN statement. Results are capped by maxRows.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        sql: z.string().min(1).describe("Read-only SQL statement."),
        params: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional().describe("? placeholder values."),
        maxRows: z.number().int().positive().max(MAX_LIMIT).optional().describe(`Maximum rows to return. Max ${MAX_LIMIT}.`)
      }
    },
    async ({ sql, params, maxRows }) => {
      const readonlySql = assertReadOnlySql(sql);
      const [rows] = await auditTool("execute_readonly_sql", { sql: readonlySql, paramCount: (params ?? []).length, maxRows: maxRows ?? null }, () => pool.query<RowDataPacket[]>({
        sql: readonlySql,
        values: (params ?? []) as QueryValue[],
        rowsAsArray: false,
        timeout: QUERY_TIMEOUT_MS
      }));

      const rowArray = Array.isArray(rows) ? rows : [];
      const finalMaxRows = clampLimit(maxRows);

      return asText({
        rowCount: rowArray.length,
        returnedRows: Math.min(rowArray.length, finalMaxRows),
        truncated: rowArray.length > finalMaxRows,
        rows: rowArray.slice(0, finalMaxRows)
      });
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.on("SIGINT", async () => {
    await pool.end();
    await server.close();
    process.exit(0);
  });
}

main().catch((error: unknown) => {
  console.error("mysql-readonly-mcp failed:", error);
  process.exit(1);
});
