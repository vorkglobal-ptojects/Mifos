/**
 * Mifos Automated Full Backup Script
 *
 * Exports:
 *  1. Complete PostgreSQL SQL dump (schema DDL + topological FK-ordered INSERTs + sequence sync)
 *  2. Multi-sheet Excel workbook (.xlsx) summary for human inspection (safe cell truncation for large blobs)
 *  3. All database-embedded base64 images (NIC front/back JSON or raw strings, signatures, weight photos)
 *  4. All Supabase Storage bucket files recursively (avatars, pawn_images, etc.)
 *  5. Supabase Auth user accounts metadata + verification manifest.json
 *
 * Usage:
 *   node scripts/backup-database.js [--out-dir <path>]
 */

const { createClient } = require('@supabase/supabase-js');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const KNOWN_FALLBACK_TABLES = [
  'account',
  'audit_logs',
  'bank_accounts',
  'branch_status',
  'branches',
  'cash_dispatches',
  'cash_receipts',
  'cash_requests',
  'cash_tills',
  'cash_transfer_denominations',
  'cash_transfers',
  'cctv_audit_logs',
  'cctv_cameras',
  'cctv_recordings',
  'cctv_settings',
  'clients',
  'daily_ledger_expenses',
  'daily_ledger_transactions',
  'daily_ledgers',
  'journal_entry',
  'journal_entry_line',
  'pawn_items',
  'pawns',
  'profiles',
  'rejected_evaluations',
  'sms_logs',
  'stock_customers',
  'stock_interests',
  'stock_items',
  'system_settings',
  'till_denominations',
  'till_sessions',
  'transaction',
  'vault_transfer',
];

const EXCEL_MAX_CELL_LEN = 32000;
const PAGE_SIZE = 1000;
const HEAVY_TABLE_PAGE_SIZE = 200;
const IMAGE_HEAVY_TABLES = new Set(['clients', 'rejected_evaluations', 'pawns', 'audit_logs']);
const SQL_INSERT_BATCH_SIZE = 50;

/** Loads frontend/.env.local when running locally without overwriting existing env vars. */
function loadLocalEnv() {
  const dotenvPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(dotenvPath)) return;
  try {
    require('dotenv').config({ path: dotenvPath, quiet: true });
  } catch {
    const content = fs.readFileSync(dotenvPath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
      }
    }
  }
}

/** Parses `--out-dir <val>` or `--out-dir=<val>` from CLI arguments. */
function parseArgs(argv) {
  const opts = { outDir: process.env.BACKUP_OUT_DIR || '' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--out-dir=')) {
      opts.outDir = arg.slice('--out-dir='.length);
    } else if (arg === '--out-dir' && argv[i + 1]) {
      opts.outDir = argv[++i];
    }
  }
  return opts;
}

/** Returns current Sri Lanka (Asia/Colombo, UTC+5:30) formatted date/time tokens. */
function getColomboTimestamps(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Colombo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const yearMonth = `${parts.year}-${parts.month}`;
  const time = `${parts.hour}-${parts.minute}-${parts.second}`;
  return {
    isoUtc: now.toISOString(),
    istDisplay: `${date} ${parts.hour}:${parts.minute}:${parts.second} +05:30`,
    date,
    yearMonth,
    fileStamp: `${date}_${time}-IST`,
  };
}

/** Retries an async operation up to `attempts` times on transient failures. */
async function withRetry(label, fn, attempts = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < attempts) {
        const delayMs = 750 * attempt;
        console.warn(`[!] ${label} failed (attempt ${attempt}/${attempts}): ${err.message}. Retrying...`);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastErr;
}

/**
 * Queries Supabase PostgREST OpenAPI spec to discover all exposed public tables,
 * column types, primary keys, and foreign keys.
 */
async function discoverSchema(supabaseUrl, serviceKey) {
  return withRetry('OpenAPI schema discovery', async () => {
    const res = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/`, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Accept: 'application/openapi+json',
      },
    });
    if (!res.ok) {
      throw new Error(`OpenAPI schema request returned HTTP ${res.status}`);
    }
    const spec = await res.json();
    const definitions = spec.definitions || {};
    const openApiSet = new Set(Object.keys(definitions));
    const allNames = new Set([...openApiSet, ...KNOWN_FALLBACK_TABLES]);
    return {
      openApiSet,
      definitions,
      allTableNames: [...allNames].sort(),
    };
  });
}

/** Parses PK columns and FK dependencies from OpenAPI property descriptions. */
function inspectTableMeta(definition) {
  const pkCols = [];
  const fkDeps = new Set();
  const props = definition?.properties || {};
  for (const [colName, colMeta] of Object.entries(props)) {
    const desc = colMeta.description || '';
    if (desc.includes('<pk/>')) {
      pkCols.push(colName);
    }
    const fkRegex = /<fk\s+table=['"]([^'"]+)['"]\s+column=['"]([^'"]+)['"]\s*\/>/g;
    let m;
    while ((m = fkRegex.exec(desc)) !== null) {
      const targetTable = m[1].replace(/^public\./, '');
      fkDeps.add(targetTable);
    }
  }
  return { pkCols, fkDeps: [...fkDeps] };
}

/** Sorts tables so referenced parent tables precede dependent child tables in SQL output. */
function sortTablesByDependencies(tableNames, definitions) {
  const tableSet = new Set(tableNames);
  const depsMap = new Map();
  for (const name of tableNames) {
    const { fkDeps } = inspectTableMeta(definitions[name]);
    depsMap.set(
      name,
      fkDeps.filter((dep) => dep !== name && tableSet.has(dep))
    );
  }

  const visited = new Set();
  const visiting = new Set();
  const ordered = [];

  function visit(node) {
    if (visited.has(node)) return;
    if (visiting.has(node)) return; // Break any cycle safely
    visiting.add(node);
    for (const dep of depsMap.get(node) || []) {
      visit(dep);
    }
    visiting.delete(node);
    visited.add(node);
    ordered.push(node);
  }

  for (const name of tableNames) {
    visit(name);
  }
  return ordered;
}

/** Determines whether a Supabase error indicates a missing fallback table vs real outage. */
function isMissingTableError(error) {
  if (!error) return false;
  const msg = String(error.message || '').toLowerCase();
  const code = String(error.code || '');
  return (
    code === 'PGRST205' ||
    code === '42P01' ||
    msg.includes('could not find the table') ||
    msg.includes('does not exist')
  );
}

/** Fetches all rows from a single table using deterministic pagination. */
async function fetchTableRows(supabase, tableName, pkCols, isKnownInOpenApi) {
  const allRows = [];
  let from = 0;
  const pageSize = IMAGE_HEAVY_TABLES.has(tableName) ? HEAVY_TABLE_PAGE_SIZE : PAGE_SIZE;
  const orderCol = pkCols.length > 0 ? pkCols[0] : null;

  while (true) {
    const pageData = await withRetry(`fetch ${tableName} [${from}]`, async () => {
      let query = supabase.from(tableName).select('*').range(from, from + pageSize - 1);
      if (orderCol) {
        query = query.order(orderCol, { ascending: true });
      }
      const { data, error } = await query;
      if (error) {
        if (!isKnownInOpenApi && isMissingTableError(error)) {
          return null;
        }
        throw new Error(`${error.code || ''} ${error.message}`.trim());
      }
      return data || [];
    });

    if (pageData === null) {
      return { exists: false, rows: [] };
    }

    allRows.push(...pageData);
    if (pageData.length < pageSize) {
      break;
    }
    from += pageSize;
  }

  return { exists: true, rows: allRows };
}

/** Maps OpenAPI column definition to a valid PostgreSQL type string. */
function mapOpenApiTypeToPg(colMeta) {
  const fmt = (colMeta?.format || '').toLowerCase();
  const typ = (colMeta?.type || '').toLowerCase();

  if (fmt === 'jsonb' || fmt === 'json') return fmt.toUpperCase();
  if (fmt === 'uuid') return 'UUID';
  if (fmt === 'timestamp with time zone' || fmt === 'timestamptz') return 'TIMESTAMPTZ';
  if (fmt === 'timestamp without time zone') return 'TIMESTAMP';
  if (fmt === 'date') return 'DATE';
  if (fmt === 'boolean') return 'BOOLEAN';
  if (fmt === 'bigint' || fmt === 'int8') return 'BIGINT';
  if (fmt === 'integer' || fmt === 'int4' || typ === 'integer') return 'INTEGER';
  if (fmt === 'numeric' || fmt === 'decimal') return 'NUMERIC';
  if (fmt === 'double precision' || fmt === 'float8' || typ === 'number') return 'DOUBLE PRECISION';
  if (fmt === 'character varying' || fmt === 'varchar') return 'VARCHAR';
  if (fmt.endsWith('[]') || typ === 'array') return 'JSONB';
  return 'TEXT';
}

/** Formats an OpenAPI default annotation cleanly for DDL. */
function formatDefaultSql(rawDefault, pgType) {
  if (rawDefault === undefined || rawDefault === null) return '';
  const str = String(rawDefault).trim();
  if (!str) return '';
  if (
    pgType === 'TEXT' ||
    pgType === 'VARCHAR'
  ) {
    if (!str.startsWith("'") && !str.includes('(')) {
      return ` DEFAULT '${str.replace(/'/g, "''")}'`;
    }
  }
  return ` DEFAULT ${str}`;
}

/** Generates idempotent CREATE TABLE DDL and sequence sync statements from OpenAPI metadata. */
function buildTableDdlAndSeqSync(tableName, definition) {
  const props = definition?.properties || {};
  const required = new Set(definition?.required || []);
  const { pkCols } = inspectTableMeta(definition);
  const propEntries = Object.entries(props);

  if (propEntries.length === 0) {
    return { ddl: `-- Schema metadata unavailable for public."${tableName}"\n`, sequenceSyncs: [] };
  }

  const colDefs = [];
  const sequenceSyncs = [];

  for (const [colName, colMeta] of propEntries) {
    const pgType = mapOpenApiTypeToPg(colMeta);
    const notNull = required.has(colName) && !pkCols.includes(colName) ? ' NOT NULL' : '';
    const rawDef = colMeta.default;
    if (typeof rawDef === 'string' && rawDef.startsWith('nextval(')) {
      sequenceSyncs.push(
        `SELECT CASE WHEN pg_get_serial_sequence('public."${tableName}"', '${colName}') IS NOT NULL THEN setval(pg_get_serial_sequence('public."${tableName}"', '${colName}'), COALESCE((SELECT MAX("${colName}") FROM public."${tableName}"), 1), TRUE) END;`
      );
    }
    const defSql = formatDefaultSql(rawDef, pgType);
    colDefs.push(`  "${colName}" ${pgType}${notNull}${defSql}`);
  }

  if (pkCols.length > 0) {
    colDefs.push(`  PRIMARY KEY (${pkCols.map((c) => `"${c}"`).join(', ')})`);
  }

  const ddl = `CREATE TABLE IF NOT EXISTS public."${tableName}" (\n${colDefs.join(',\n')}\n);\n`;
  return { ddl, sequenceSyncs };
}

/** Formats a single JS value safely as a PostgreSQL SQL literal according to column schema. */
function formatSqlLiteral(val, colMeta) {
  if (val === null || val === undefined) return 'NULL';

  const fmt = (colMeta?.format || '').toLowerCase();
  const isJsonCol = fmt === 'jsonb' || fmt === 'json';
  const isArrayCol = colMeta?.type === 'array' || fmt.endsWith('[]');

  if (isJsonCol) {
    const serialized = JSON.stringify(val).replace(/'/g, "''");
    return `'${serialized}'::${fmt}`;
  }

  if (isArrayCol && Array.isArray(val)) {
    const elemType = fmt.replace(/\[\]$/, '') || 'text';
    if (val.length === 0) return `'{}'::${elemType}[]`;
    const items = val.map((item) => formatSqlLiteral(item, { format: elemType })).join(', ');
    return `ARRAY[${items}]::${elemType}[]`;
  }

  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  if (typeof val === 'number') return Number.isFinite(val) ? String(val) : 'NULL';

  if (typeof val === 'object') {
    if (val instanceof Date) return `'${val.toISOString()}'`;
    const serialized = JSON.stringify(val).replace(/'/g, "''");
    return `'${serialized}'::jsonb`;
  }

  const escaped = String(val).replace(/\0/g, '').replace(/'/g, "''");
  return `'${escaped}'`;
}

/** Writes text chunk cleanly to a Node WriteStream while respecting backpressure. */
function writeChunk(stream, chunk) {
  if (stream.write(chunk)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onDrain = () => {
      stream.off('error', onError);
      resolve();
    };
    const onError = (err) => {
      stream.off('drain', onDrain);
      reject(err);
    };
    stream.once('drain', onDrain);
    stream.once('error', onError);
  });
}

/**
 * Generates the full standalone `.sql` dump (DDL, FK-ordered INSERT batches, sequence resets,
 * and Auth users manifest comment block).
 */
async function writeSqlBackup(sqlPath, meta, tableRecords, definitions, authUsers) {
  const stream = fs.createWriteStream(sqlPath, { encoding: 'utf8' });

  try {
    await writeChunk(
      stream,
      [
        '-- ============================================================================',
        '-- MIFOS COMPLETE DATABASE BACKUP (.sql)',
        `-- Backup Timestamp (IST): ${meta.istDisplay}`,
        `-- Backup Timestamp (UTC): ${meta.isoUtc}`,
        `-- Source Supabase URL:    ${meta.sourceUrl}`,
        `-- Public Tables Exported: ${tableRecords.length}`,
        `-- Auth Users Captured:    ${authUsers.length}`,
        '-- ============================================================================',
        '',
        'BEGIN;',
        "SET client_encoding = 'UTF8';",
        'SET standard_conforming_strings = on;',
        '',
      ].join('\n')
    );

    const allSeqSyncs = [];

    for (const record of tableRecords) {
      const { tableName, rows } = record;
      const def = definitions[tableName];
      const { ddl, sequenceSyncs } = buildTableDdlAndSeqSync(tableName, def);
      allSeqSyncs.push(...sequenceSyncs);

      await writeChunk(
        stream,
        `\n-- ----------------------------------------------------------------------------\n-- Table: public."${tableName}" (${rows.length} rows)\n-- ----------------------------------------------------------------------------\n${ddl}\n`
      );

      if (rows.length === 0) continue;

      const props = def?.properties || {};
      const colNames = Object.keys(props).length > 0 ? Object.keys(props) : Object.keys(rows[0]);
      const quotedCols = colNames.map((c) => `"${c}"`).join(', ');

      for (let i = 0; i < rows.length; i += SQL_INSERT_BATCH_SIZE) {
        const batch = rows.slice(i, i + SQL_INSERT_BATCH_SIZE);
        const valueLines = batch.map((row) => {
          const vals = colNames.map((col) => formatSqlLiteral(row[col], props[col]));
          return `  (${vals.join(', ')})`;
        });
        await writeChunk(
          stream,
          `INSERT INTO public."${tableName}" (${quotedCols})\nVALUES\n${valueLines.join(',\n')}\nON CONFLICT DO NOTHING;\n\n`
        );
      }
    }

    if (allSeqSyncs.length > 0) {
      await writeChunk(
        stream,
        '\n-- Reset serial sequences\n' + allSeqSyncs.join('\n') + '\n'
      );
    }

    await writeChunk(
      stream,
      [
        '',
        `-- Note: ${authUsers.length} Supabase Auth user records exported to database/auth_users.json`,
        'COMMIT;',
        '',
      ].join('\n')
    );

    await new Promise((resolve, reject) => {
      stream.on('finish', resolve);
      stream.on('error', reject);
      stream.end();
    });
  } catch (err) {
    stream.destroy();
    throw err;
  }
}

/** Sanitizes a path segment for safe cross-platform filesystem filenames. */
function safeSegment(raw) {
  return String(raw || 'unknown')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64) || 'item';
}

/** Maps image MIME subtype or base64 magic prefix to a standard file extension. */
function detectImageExtension(mimeSubtype, b64Data) {
  if (mimeSubtype) {
    const sub = mimeSubtype.toLowerCase().split('+')[0];
    if (sub === 'jpeg') return 'jpg';
    if (['jpg', 'png', 'webp', 'gif', 'bmp', 'svg'].includes(sub)) return sub;
  }
  if (b64Data.startsWith('/9j/')) return 'jpg';
  if (b64Data.startsWith('iVBORw0KGgo')) return 'png';
  if (b64Data.startsWith('UklGR')) return 'webp';
  if (b64Data.startsWith('R0lGOD')) return 'gif';
  return 'jpg';
}

/** Decodes a data:image/...;base64,... string to disk and returns relative path + byte size. */
function saveDataUriImage(dataUri, destBasePath) {
  const match = dataUri.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);
  if (!match) return null;
  const cleanB64 = match[2].replace(/\s+/g, '');
  if (!cleanB64) return null;
  const ext = detectImageExtension(match[1], cleanB64);
  const fullPath = `${destBasePath}.${ext}`;
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  const buf = Buffer.from(cleanB64, 'base64');
  fs.writeFileSync(fullPath, buf);
  return { fullPath, bytes: buf.length };
}

/**
 * Recursively inspects any DB cell value (direct data URI, JSON string like {front, back}, or object)
 * to extract embedded base64 images to `images/db_images/<table>/` and return clean Excel summary refs.
 */
function extractDbImagesAndFormatForExcel(tableName, rowKey, colName, rawVal, dbImagesRoot, backupRoot, stats) {
  if (rawVal === null || rawVal === undefined) return '';

  const saveLeaf = (val, suffix) => {
    if (typeof val !== 'string') return null;
    if (val.startsWith('data:image/')) {
      const destBase = path.join(dbImagesRoot, tableName, `${safeSegment(rowKey)}_${safeSegment(colName)}${suffix}`);
      const saved = saveDataUriImage(val, destBase);
      if (saved) {
        stats.count += 1;
        stats.bytes += saved.bytes;
        return path.relative(backupRoot, saved.fullPath).replace(/\\/g, '/');
      }
    }
    return null;
  };

  // Case 1: Direct data URI
  if (typeof rawVal === 'string') {
    const trimmed = rawVal.trim();
    if (trimmed.startsWith('data:image/')) {
      const rel = saveLeaf(trimmed, '');
      if (rel) return `[IMAGE -> ${rel}]`;
    }

    // Case 2: JSON-encoded object containing image fields (e.g., clients.nic_image { front, back })
    if (trimmed.startsWith('{') && trimmed.includes('data:image/')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object') {
          const refs = [];
          for (const [k, v] of Object.entries(parsed)) {
            const rel = saveLeaf(v, `_${safeSegment(k)}`);
            if (rel) refs.push(`${k}: ${rel}`);
          }
          if (refs.length > 0) return `[IMAGES -> ${refs.join(' | ')}]`;
        }
      } catch {
        // Not valid JSON; fall through to length guard
      }
    }

    if (rawVal.length > EXCEL_MAX_CELL_LEN) {
      return `${rawVal.slice(0, EXCEL_MAX_CELL_LEN - 40)} ...[TRUNCATED ${rawVal.length} chars; SEE SQL]`;
    }
    return rawVal;
  }

  if (typeof rawVal === 'object') {
    if (rawVal instanceof Date) return rawVal.toISOString();
    const str = JSON.stringify(rawVal);
    if (str.includes('data:image/')) {
      const refs = [];
      for (const [k, v] of Object.entries(rawVal)) {
        const rel = saveLeaf(v, `_${safeSegment(k)}`);
        if (rel) refs.push(`${k}: ${rel}`);
      }
      if (refs.length > 0) return `[IMAGES -> ${refs.join(' | ')}]`;
    }
    if (str.length > EXCEL_MAX_CELL_LEN) {
      return `${str.slice(0, EXCEL_MAX_CELL_LEN - 40)} ...[TRUNCATED ${str.length} chars; SEE SQL]`;
    }
    return str;
  }

  return rawVal;
}

/** Generates a safe, unique Excel worksheet name within Excel's 31-character limit. */
function makeUniqueSheetName(rawName, usedNames) {
  const cleaned = String(rawName).replace(/[\\/*?:\[\]]/g, '_');
  let candidate = cleaned.slice(0, 31) || 'Sheet';
  let idx = 1;
  while (usedNames.has(candidate.toLowerCase())) {
    const suffix = `_${idx++}`;
    candidate = cleaned.slice(0, 31 - suffix.length) + suffix;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

/**
 * Generates the multi-sheet Excel summary workbook and extracts any embedded DB base64 images
 * into `dbImagesRoot`.
 */
async function buildExcelAndExtractDbImages(xlsxPath, meta, tableRecords, definitions, dbImagesRoot, backupRoot, storageStats) {
  const dbImageStats = { count: 0, bytes: 0 };
  const workbook = XLSX.utils.book_new();

  const usedSheetNames = new Set();
  const summarySheetName = makeUniqueSheetName('_BACKUP_SUMMARY', usedSheetNames);
  const perTableSheets = [];

  for (const record of tableRecords) {
    const { tableName, rows } = record;
    const sheetName = makeUniqueSheetName(tableName, usedSheetNames);

    const propCols = Object.keys(definitions[tableName]?.properties || {});
    const colNames = propCols.length > 0 ? propCols : (rows.length > 0 ? Object.keys(rows[0]) : ['info']);

    const aoa = [colNames];
    for (let rIdx = 0; rIdx < rows.length; rIdx++) {
      const row = rows[rIdx];
      const rowKey = row.id ?? row.bill_number ?? row.key ?? `row_${rIdx + 1}`;
      aoa.push(
        colNames.map((col) =>
          extractDbImagesAndFormatForExcel(tableName, rowKey, col, row[col], dbImagesRoot, backupRoot, dbImageStats)
        )
      );
    }

    const sheet = XLSX.utils.aoa_to_sheet(aoa);
    sheet['!cols'] = colNames.map((col) => ({
      wch: Math.min(42, Math.max(14, col.length + 4)),
    }));
    if (rows.length > 0) {
      sheet['!autofilter'] = {
        ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: colNames.length - 1 } }),
      };
    }

    perTableSheets.push({ tableName, sheetName, rows: rows.length, sheet });
  }

  const totalRows = tableRecords.reduce((acc, r) => acc + r.rows.length, 0);
  const summaryAoa = [
    ['Item / Table Name', 'Excel Sheet', 'Row Count / Value'],
    ['Backup Timestamp (IST)', '-', meta.istDisplay],
    ['Backup Timestamp (UTC)', '-', meta.isoUtc],
    ['Total Public Tables', '-', tableRecords.length],
    ['Total Database Rows', '-', totalRows],
    ['Auth Users Captured', '-', meta.authUsersCount],
    ['Storage Bucket Files', '-', storageStats.count],
    ['DB Embedded Images Extracted', '-', dbImageStats.count],
    ['', '', ''],
    ...perTableSheets.map((info) => [info.tableName, info.sheetName, info.rows]),
  ];

  const summarySheet = XLSX.utils.aoa_to_sheet(summaryAoa);
  summarySheet['!cols'] = [{ wch: 34 }, { wch: 32 }, { wch: 32 }];
  XLSX.utils.book_append_sheet(workbook, summarySheet, summarySheetName);

  for (const info of perTableSheets) {
    XLSX.utils.book_append_sheet(workbook, info.sheet, info.sheetName);
  }

  XLSX.writeFile(workbook, xlsxPath, { compression: true });
  return dbImageStats;
}

/** Recursively collects all object paths inside a Supabase Storage bucket. */
async function listBucketObjectsRecursive(supabase, bucketName, prefix = '') {
  const files = [];
  let offset = 0;

  while (true) {
    const entries = await withRetry(`list storage ${bucketName}/${prefix}`, async () => {
      const { data, error } = await supabase.storage
        .from(bucketName)
        .list(prefix, { limit: PAGE_SIZE, offset, sortBy: { column: 'name', order: 'asc' } });
      if (error) throw new Error(error.message);
      return data || [];
    });

    for (const item of entries) {
      if (!item.name || item.name === '.emptyFolderPlaceholder') continue;
      const itemPath = prefix ? `${prefix}/${item.name}` : item.name;
      // Supabase list() returns folders with id === null and metadata === null
      if (!item.id) {
        const nested = await listBucketObjectsRecursive(supabase, bucketName, itemPath);
        files.push(...nested);
      } else {
        files.push(itemPath);
      }
    }

    if (entries.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return files;
}

/** Downloads every object across every Supabase Storage bucket cleanly. */
async function backupAllStorageBuckets(supabase, storageRoot) {
  const buckets = await withRetry('list storage buckets', async () => {
    const { data, error } = await supabase.storage.listBuckets();
    if (error) throw new Error(error.message);
    return data || [];
  });

  const stats = { buckets: {}, count: 0, bytes: 0 };

  for (const bucket of buckets) {
    const objectPaths = await listBucketObjectsRecursive(supabase, bucket.name);
    stats.buckets[bucket.name] = objectPaths.length;

    for (const objPath of objectPaths) {
      const buf = await withRetry(`download ${bucket.name}/${objPath}`, async () => {
        const { data, error } = await supabase.storage.from(bucket.name).download(objPath);
        if (error) throw new Error(error.message);
        const ab = await data.arrayBuffer();
        return Buffer.from(ab);
      });

      const localDest = path.join(storageRoot, bucket.name, ...objPath.split('/'));
      fs.mkdirSync(path.dirname(localDest), { recursive: true });
      fs.writeFileSync(localDest, buf);
      stats.count += 1;
      stats.bytes += buf.length;
    }
  }

  return stats;
}

/** Fetches all Supabase Auth user records cleanly via paginated Admin API. */
async function fetchAllAuthUsers(supabase) {
  const users = [];
  let page = 1;

  while (true) {
    const batch = await withRetry(`list auth users page ${page}`, async () => {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
      if (error) throw new Error(error.message);
      return data?.users || [];
    });

    users.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    page += 1;
  }

  return users;
}

/** Orchestrates complete Supabase database, Excel, image, storage, and auth backup. */
async function runBackup() {
  loadLocalEnv();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.error('Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
    process.exit(1);
  }

  const cli = parseArgs(process.argv.slice(2));
  const ts = getColomboTimestamps();
  const backupDir = cli.outDir
    ? path.resolve(cli.outDir)
    : path.join(__dirname, '..', '..', 'backups', `backup_${ts.fileStamp}`);

  const dbDir = path.join(backupDir, 'database');
  const excelDir = path.join(backupDir, 'excel');
  const storageDir = path.join(backupDir, 'images', 'storage');
  const dbImagesDir = path.join(backupDir, 'images', 'db_images');

  fs.mkdirSync(dbDir, { recursive: true });
  fs.mkdirSync(excelDir, { recursive: true });
  fs.mkdirSync(storageDir, { recursive: true });
  fs.mkdirSync(dbImagesDir, { recursive: true });

  console.log('======================================================================');
  console.log(' Starting Mifos Complete Supabase Backup (SQL + Excel + Images)');
  console.log(` IST Timestamp: ${ts.istDisplay}`);
  console.log(` Output Folder: ${backupDir}`);
  console.log('======================================================================');

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  // 1. Discover tables & dependency order
  const { openApiSet, definitions, allTableNames } = await discoverSchema(supabaseUrl, serviceKey);
  const orderedTables = sortTablesByDependencies(allTableNames, definitions);

  // 2. Fetch all public table rows
  const tableRecords = [];
  const tableCounts = {};
  for (const tableName of orderedTables) {
    const { pkCols } = inspectTableMeta(definitions[tableName]);
    const isKnown = openApiSet.has(tableName);
    const { exists, rows } = await fetchTableRows(supabase, tableName, pkCols, isKnown);
    if (!exists) {
      continue;
    }
    tableRecords.push({ tableName, rows });
    tableCounts[tableName] = rows.length;
    console.log(`[✔] Table ${tableName.padEnd(28)} -> ${rows.length} rows`);
  }

  // 3. Fetch Auth users
  const authUsers = await fetchAllAuthUsers(supabase);
  const authUsersPath = path.join(dbDir, 'auth_users.json');
  fs.writeFileSync(authUsersPath, JSON.stringify(authUsers, null, 2), 'utf8');
  console.log(`[✔] Auth Users                       -> ${authUsers.length} users`);

  // 4. Backup all Supabase Storage buckets
  const storageStats = await backupAllStorageBuckets(supabase, storageDir);
  console.log(
    `[✔] Storage Buckets                  -> ${storageStats.count} files (${(storageStats.bytes / 1024).toFixed(1)} KB)`
  );

  // 5. Write complete SQL dump
  const meta = {
    ...ts,
    sourceUrl: supabaseUrl,
    authUsersCount: authUsers.length,
  };
  const sqlPath = path.join(dbDir, `mifos_backup_${ts.fileStamp}.sql`);
  await writeSqlBackup(sqlPath, meta, tableRecords, definitions, authUsers);
  const sqlSizeBytes = fs.statSync(sqlPath).size;
  console.log(`[✔] SQL Dump                         -> ${path.basename(sqlPath)} (${(sqlSizeBytes / (1024 * 1024)).toFixed(2)} MB)`);

  // 6. Write Excel workbook + extract DB-embedded base64 images
  const xlsxPath = path.join(excelDir, `mifos_data_${ts.fileStamp}.xlsx`);
  const dbImageStats = await buildExcelAndExtractDbImages(
    xlsxPath,
    meta,
    tableRecords,
    definitions,
    dbImagesDir,
    backupDir,
    storageStats
  );
  const xlsxSizeBytes = fs.statSync(xlsxPath).size;
  console.log(
    `[✔] Excel Summary                    -> ${path.basename(xlsxPath)} (${(xlsxSizeBytes / 1024).toFixed(1)} KB)`
  );
  console.log(
    `[✔] DB Embedded Images Extracted     -> ${dbImageStats.count} images (${(dbImageStats.bytes / (1024 * 1024)).toFixed(2)} MB)`
  );

  // 7. Write backup manifest
  const totalRows = tableRecords.reduce((sum, r) => sum + r.rows.length, 0);
  const manifest = {
    backupTimestampIst: ts.istDisplay,
    backupTimestampUtc: ts.isoUtc,
    fileStamp: ts.fileStamp,
    yearMonth: ts.yearMonth,
    sourceUrl: supabaseUrl,
    totalTables: tableRecords.length,
    totalRows,
    authUsersCount: authUsers.length,
    storageBuckets: storageStats.buckets,
    storageFilesCount: storageStats.count,
    storageFilesBytes: storageStats.bytes,
    dbExtractedImagesCount: dbImageStats.count,
    dbExtractedImagesBytes: dbImageStats.bytes,
    sqlFile: path.relative(backupDir, sqlPath).replace(/\\/g, '/'),
    sqlFileBytes: sqlSizeBytes,
    excelFile: path.relative(backupDir, xlsxPath).replace(/\\/g, '/'),
    excelFileBytes: xlsxSizeBytes,
    tables: tableCounts,
  };

  fs.writeFileSync(path.join(backupDir, 'backup_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  console.log('======================================================================');
  console.log(' BACKUP COMPLETED CLEANLY!');
  console.log('======================================================================');
}

runBackup().catch((err) => {
  console.error('[FATAL] Backup failed:', err);
  process.exit(1);
});
