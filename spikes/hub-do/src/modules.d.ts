declare module '*.sql' {
  const sql: string;
  export default sql;
}
declare module '*/migrations.js' {
  const m: { migrations: Record<string, string> };
  export default m;
}
