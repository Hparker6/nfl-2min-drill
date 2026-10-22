/**
 * The part of Cloudflare D1's API the accounts code uses, typed here so the server needs no extra packages. The tests
 * run the same code against Node's built-in SQLite through an adapter with this shape (testing.ts).
 */
export type D1Value = string | number | null;

export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: { changes: number };
}

export interface D1PreparedStatement {
  bind(...values: D1Value[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}

export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  /** Runs the statements in one transaction: all of them apply, or none. */
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}
