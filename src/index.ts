#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { appendFileSync, readFileSync } from "node:fs";
import mysql, { type RowDataPacket } from "mysql2/promise";
import * as z from "zod/v4";

loadConfigFile();

const PACKAGE_VERSION = "0.1.2";
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = readIntEnv("MYSQL_MCP_MAX_LIMIT", 500, 1, 10000);
const QUERY_TIMEOUT_MS = readIntEnv("MYSQL_MCP_QUERY_TIMEOUT_MS", 10000, 100, 300000);
const CONNECTION_LIMIT = readIntEnv("MYSQL_MCP_CONNECTION_LIMIT", 5, 1, 100);
const ALLOW_SCHEMA_OVERRIDE = readBooleanEnv("MYSQL_MCP_ALLOW_SCHEMA_OVERRIDE", false);
const LIMIT_RAW_SQL_AT_DB = readBooleanEnv("MYSQL_MCP_LIMIT_RAW_SQL_AT_DB", false);
const LOG_FILE = process.env.MYSQL_MCP_LOG_FILE || "";
const LARGE_COLUMN_TYPES = new Set([
  "tinytext",
  "text",
  "mediumtext",
  "longtext",
  "tinyblob",
  "blob",
  "mediumblob",
  "longblob",
  "json",
  "geometry"
]);

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
  DATA_TYPE: string;
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

function readIntEnv(name: string, fallback: number, min: number, max: number): number {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue === "") return fallback;
  if (!/^\d+$/.test(rawValue)) throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  const value = Number.parseInt(rawValue, 10);
  if (value < min || value > max) throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  return value;
}

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue === "") return fallback;
  if (rawValue === "true") return true;
  if (rawValue === "false") return false;
  throw new Error(`${name} must be true or false.`);
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
    connectionLimit: CONNECTION_LIMIT,
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

function getDataType(column: ColumnRow): string {
  return column.DATA_TYPE.toLowerCase();
}

function isLargeColumn(column: ColumnRow): boolean {
  return LARGE_COLUMN_TYPES.has(getDataType(column));
}

function normalizeSql(sql: string): string {
  return sql.trim().replace(/;+\s*$/, "").trim();
}

function stripSqlCommentsAndStrings(sql: string): string {
  let result = "";
  for (let i = 0; i < sql.length; i += 1) {
    const current = sql[i];
    const next = sql[i + 1] ?? "";
    if (current === "/" && next === "*") {
      if (sql[i + 2] === "!") throw new Error("MySQL executable comments are not allowed.");
      const end = sql.indexOf("*/", i + 2);
      if (end === -1) throw new Error("Unclosed SQL block comment.");
      result += " ";
      i = end + 1;
      continue;
    }
    if (current === "-" && next === "-" && /\s/.test(sql[i + 2] ?? "")) {
      const end = sql.slice(i + 2).search(/[\r\n]/);
      if (end === -1) break;
      result += " ";
      i += end + 1;
      continue;
    }
    if (current === "#") {
      const end = sql.slice(i + 1).search(/[\r\n]/);
      if (end === -1) break;
      result += " ";
      i += end;
      continue;
    }
    if (current === "'" || current === "\"") {
      const quote = current;
      result += " ";
      for (i += 1; i < sql.length; i += 1) {
        if (sql[i] === "\\") {
          i += 1;
          continue;
        }
        if (sql[i] === quote) break;
      }
      if (i >= sql.length) throw new Error("Unclosed SQL string literal.");
      continue;
    }
    if (current === "`") {
      result += " ";
      for (i += 1; i < sql.length; i += 1) {
        if (sql[i] === "`" && sql[i + 1] === "`") {
          i += 1;
          continue;
        }
        if (sql[i] === "`") break;
      }
      if (i >= sql.length) throw new Error("Unclosed SQL quoted identifier.");
      continue;
    }
    result += current;
  }
  return result;
}

function compactSqlForKeywordChecks(sql: string): string {
  return stripSqlCommentsAndStrings(sql).replace(/\s+/g, " ").trim();
}

function assertReadOnlySql(sql: string): string {
  const normalized = normalizeSql(sql);
  if (!normalized) {
    throw new Error("SQL cannot be empty.");
  }

  const checkedSql = compactSqlForKeywordChecks(normalized);

  if (checkedSql.includes(";")) {
    throw new Error("Multiple SQL statements are not allowed.");
  }

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

/**
 * Check whether a read-only SQL statement should be wrapped with a database-side row cap.
 */
function shouldApplyRawSqlLimit(sql: string): boolean {
  return LIMIT_RAW_SQL_AT_DB && /^(select|with)\b/i.test(compactSqlForKeywordChecks(sql));
}

/**
 * Optionally wrap SELECT/WITH SQL with LIMIT maxRows + 1 so truncation can be detected.
 */
function buildLimitedRawSql(sql: string, maxRows: number): { sql: string; extraParams: QueryValue[]; limited: boolean } {
  if (!shouldApplyRawSqlLimit(sql)) return { sql, extraParams: [], limited: false };
  return {
    sql: `SELECT * FROM (${sql}) AS mcp_limited_result LIMIT ?`,
    extraParams: [maxRows + 1],
    limited: true
  };
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
const DESCRIBE_COLUMNS_SQL = `SELECT COLUMN_NAME, ORDINAL_POSITION, COLUMN_TYPE, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT,
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

function selectSampleColumns(columns: ColumnRow[], requestedColumns: string[] | undefined, includeLargeColumns: boolean): ColumnRow[] {
  const requested = requestedColumns ? new Set(requestedColumns) : null;
  const missing = requestedColumns?.filter((column) => !columns.some((item) => item.COLUMN_NAME === column)) ?? [];
  if (missing.length > 0) throw new Error(`Unknown column(s): ${missing.join(", ")}`);
  const selected = columns.filter((column) => requested === null || requested.has(column.COLUMN_NAME));
  const safeColumns = includeLargeColumns ? selected : selected.filter((column) => !isLargeColumn(column));
  if (safeColumns.length === 0 && selected.length > 0) throw new Error("Only large columns were selected. Set includeLargeColumns=true to read them.");
  if (safeColumns.length === 0) throw new Error("Table has no sampleable columns.");
  return safeColumns;
}

async function main() {
  const pool = createPool();
  const server = new McpServer({
    name: "mysql-readonly-mcp",
    version: PACKAGE_VERSION
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
        columns: z.array(z.string().min(1)).min(1).max(100).optional().describe("Optional column names to read. Defaults to all non-large columns."),
        includeLargeColumns: z.boolean().optional().default(false).describe("Include TEXT/BLOB/JSON/geometry columns in samples. Default: false."),
        limit: z.number().int().positive().max(MAX_LIMIT).optional().describe(`Rows to return. Max ${MAX_LIMIT}.`),
        offset: z.number().int().nonnegative().optional().default(0).describe("Rows to skip.")
      }
    },
    async ({ table, schema, columns, includeLargeColumns, limit, offset }) => {
      const database = resolveSchema(schema);
      const tableColumns = await getColumns(pool, database, table);
      if (tableColumns.length === 0) throw new Error(`Table not found or has no visible columns: ${database}.${table}`);
      const selectedColumns = selectSampleColumns(tableColumns, columns, includeLargeColumns ?? false);
      const tableName = `${escapeIdentifier(database)}.${escapeIdentifier(table)}`;
      const columnList = selectedColumns.map((column) => escapeIdentifier(column.COLUMN_NAME)).join(", ");
      const finalLimit = clampLimit(limit);
      const finalOffset = offset ?? 0;
      const sampleSql = `SELECT ${columnList} FROM ${tableName} LIMIT ? OFFSET ?`;
      const [rows] = await auditTool("sample_table", { schema: database, table, columns: selectedColumns.map((column) => column.COLUMN_NAME), includeLargeColumns: includeLargeColumns ?? false, limit: finalLimit, offset: finalOffset, sql: sampleSql, paramCount: 2 }, () => pool.query<RowDataPacket[]>(
        sampleSql,
        [finalLimit, finalOffset]
      ));

      return asText({
        schema: database,
        table,
        columns: selectedColumns.map((column) => column.COLUMN_NAME),
        omittedLargeColumns: tableColumns.filter((column) => isLargeColumn(column) && !selectedColumns.some((selected) => selected.COLUMN_NAME === column.COLUMN_NAME)).map((column) => column.COLUMN_NAME),
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
      description: "Execute a trusted read-only SELECT/SHOW/DESCRIBE/EXPLAIN statement.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        sql: z.string().min(1).describe("Read-only SQL statement."),
        params: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional().describe("? placeholder values."),
        maxRows: z.number().int().positive().max(MAX_LIMIT).optional().describe(`Maximum rows to return. Max ${MAX_LIMIT}.`)
      }
    },
    async ({ sql, params, maxRows }) => {
      const readonlySql = assertReadOnlySql(sql);
      const finalMaxRows = clampLimit(maxRows);
      const limitedSql = buildLimitedRawSql(readonlySql, finalMaxRows);
      const queryParams = [...((params ?? []) as QueryValue[]), ...limitedSql.extraParams];
      const auditDetails: Record<string, unknown> = { sql: limitedSql.sql, paramCount: queryParams.length, maxRows: maxRows ?? null };
      if (limitedSql.limited) auditDetails.limitApplied = finalMaxRows;
      const [rows] = await auditTool("execute_readonly_sql", auditDetails, () => pool.query<RowDataPacket[]>({
        sql: limitedSql.sql,
        values: queryParams,
        rowsAsArray: false,
        timeout: QUERY_TIMEOUT_MS
      }));
      const rowArray = Array.isArray(rows) ? rows : [];
      const payload: Record<string, unknown> = {
        rowCount: rowArray.length,
        returnedRows: Math.min(rowArray.length, finalMaxRows),
        truncated: rowArray.length > finalMaxRows,
        rows: rowArray.slice(0, finalMaxRows)
      };
      if (limitedSql.limited) payload.limitApplied = finalMaxRows;
      return asText(payload);
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = async () => {
    await pool.end();
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((error: unknown) => {
  console.error("mysql-readonly-mcp failed:", error);
  process.exit(1);
});
