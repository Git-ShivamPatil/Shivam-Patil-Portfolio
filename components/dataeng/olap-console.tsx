"use client";

import { useCallback, useRef, useState } from "react";
import "./dataeng.css";

/**
 * P20 — DuckDB, in the browser.
 *
 * **The query runs on the visitor's machine.** The warehouse export is fetched
 * once as JSON, registered as a DuckDB table, and every query after that is
 * executed locally — there is no query endpoint, so there is no SQL injection
 * surface, no way to make the database do expensive work, and nothing to rate
 * limit. Someone can write `SELECT * FROM facts ORDER BY views DESC` and it
 * costs this project nothing.
 *
 * That is not a trick to avoid building a backend. It is the actual argument
 * for client-side OLAP: analytical queries over a dataset small enough to move
 * are cheaper to run where the user is than to round-trip, and it removes an
 * entire class of security problem by removing the endpoint.
 *
 * ~30MB of WASM, so it loads on a click and never before.
 */

interface QueryResult {
  columns: string[];
  rows: unknown[][];
  ms: number;
}

const EXAMPLES = [
  {
    label: "Busiest pages",
    sql: "SELECT path, SUM(views) AS views, SUM(uniques) AS uniques\nFROM facts\nGROUP BY path\nORDER BY views DESC\nLIMIT 10;",
  },
  {
    label: "Traffic by device",
    sql: "SELECT device, SUM(views) AS views, ROUND(AVG(avgScroll), 1) AS avg_scroll\nFROM facts\nGROUP BY device\nORDER BY views DESC;",
  },
  {
    label: "Reading time by page",
    sql: "SELECT path, ROUND(AVG(avgDurationMs) / 1000, 1) AS seconds\nFROM facts\nWHERE avgDurationMs > 0\nGROUP BY path\nORDER BY seconds DESC\nLIMIT 10;",
  },
  {
    label: "Daily trend",
    sql: "SELECT day, SUM(views) AS views\nFROM facts\nGROUP BY day\nORDER BY day DESC\nLIMIT 14;",
  },
];

// Structural typing: pulling @duckdb/duckdb-wasm's types into the app build for
// a lazily-loaded console would defeat the point of loading it lazily.
interface Connection {
  query(sql: string): Promise<{
    numRows: number;
    schema: { fields: { name: string }[] };
    toArray(): { toJSON(): Record<string, unknown> }[];
  }>;
}
interface Database {
  connect(): Promise<Connection>;
  registerFileText(name: string, content: string): Promise<void>;
}

let database: Database | null = null;

/**
 * Boot DuckDB and load the export.
 *
 * The bundle is selected at runtime rather than pinned: DuckDB ships an
 * exception-handling build and a fallback, and choosing the wrong one is a
 * runtime crash on older browsers rather than a graceful degradation.
 */
async function boot(onStatus: (text: string) => void): Promise<Database> {
  if (database) return database;

  onStatus("Loading DuckDB…");
  const duckdb = await import("@duckdb/duckdb-wasm");
  const bundles = duckdb.getJsDelivrBundles();
  const bundle = await duckdb.selectBundle(bundles);

  // The worker is created from a blob URL because the bundle lives on a CDN and
  // a cross-origin worker script cannot be loaded directly. This is why the CSP
  // permits `worker-src blob:` — added in P16 for WebLLM, reused here.
  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}");`], { type: "text/javascript" }),
  );
  const worker = new Worker(workerUrl);
  const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
  const instance = new duckdb.AsyncDuckDB(logger, worker);
  await instance.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(workerUrl);

  onStatus("Fetching the warehouse export…");
  const response = await fetch("/api/data/warehouse");
  if (!response.ok) throw new Error(`export unavailable (HTTP ${response.status})`);
  const warehouse = (await response.json()) as { facts: unknown[]; events: unknown[] };

  onStatus("Registering tables…");
  const db = instance as unknown as Database;
  await db.registerFileText("facts.json", JSON.stringify(warehouse.facts));
  await db.registerFileText("events.json", JSON.stringify(warehouse.events));

  const connection = await db.connect();
  // Materialised as tables rather than queried as files each time: read_json_auto
  // re-parses on every query, which turns a 30ms query into a 300ms one.
  await connection.query(`CREATE TABLE facts AS SELECT * FROM read_json_auto('facts.json')`);
  await connection.query(`CREATE TABLE events AS SELECT * FROM read_json_auto('events.json')`);

  database = db;
  return db;
}

export function OlapConsole() {
  const [sql, setSql] = useState(EXAMPLES[0].sql);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const connectionRef = useRef<Connection | null>(null);

  const run = useCallback(async () => {
    setError(null);
    try {
      if (!connectionRef.current) {
        const db = await boot(setStatus);
        connectionRef.current = await db.connect();
        setReady(true);
      }
      setStatus("Running…");

      const started = performance.now();
      const table = await connectionRef.current.query(sql);
      const ms = performance.now() - started;

      const columns = table.schema.fields.map((field) => field.name);
      const rows = table.toArray().map((row) => {
        const record = row.toJSON();
        return columns.map((column) => {
          const value = record[column];
          // DuckDB returns BigInt for integer aggregates, and BigInt has no
          // JSON representation — rendering it directly throws.
          return typeof value === "bigint" ? Number(value) : value;
        });
      });

      setResult({ columns, rows: rows.slice(0, 100), ms });
      setStatus(null);
    } catch (caught) {
      setStatus(null);
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [sql]);

  return (
    <div className="olap">
      <div className="olap-examples">
        {EXAMPLES.map((example) => (
          <button key={example.label} type="button" onClick={() => setSql(example.sql)}>
            {example.label}
          </button>
        ))}
      </div>

      <label htmlFor="olap-sql" className="jd-label">
        SQL — runs entirely in your browser
      </label>
      <textarea
        id="olap-sql"
        value={sql}
        rows={7}
        spellCheck={false}
        onChange={(event) => setSql(event.target.value)}
      />

      <div className="olap-actions">
        <button type="button" className="button button-solid" onClick={() => void run()} data-ripple>
          {ready ? "Run query" : "Load DuckDB and run"}
        </button>
        <span className="ask-note">
          {ready
            ? "Querying a local table. Nothing is sent anywhere."
            : "First run downloads ~30MB of WebAssembly. Nothing loads until you press this."}
        </span>
      </div>

      {status && <p className="olap-status">{status}</p>}
      {error && (
        <p className="ask-error" role="alert">
          {error}
        </p>
      )}

      {result && (
        <div className="olap-result">
          <p className="ask-note">
            {result.rows.length} row{result.rows.length === 1 ? "" : "s"} in {result.ms.toFixed(1)}{" "}
            ms{result.rows.length === 100 ? " (showing the first 100)" : ""}.
          </p>
          <div className="olap-table-wrap">
            <table>
              <thead>
                <tr>
                  {result.columns.map((column) => (
                    <th key={column} scope="col">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, index) => (
                  <tr key={index}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex}>{cell === null ? "—" : String(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
