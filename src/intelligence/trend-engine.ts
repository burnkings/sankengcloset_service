// src/intelligence/trend-engine.ts — stub (no trend tables in 12-table schema)

export function buildTrendSummary(): { brandTrends: never[]; productTrends: never[]; generatedAt: string } {
  return { brandTrends: [], productTrends: [], generatedAt: new Date().toISOString() };
}
