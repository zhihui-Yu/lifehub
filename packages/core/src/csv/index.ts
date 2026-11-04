/**
 * CSV 解析模块 barrel。
 *
 * 说明：统一从这里导出，避免上层出现深层相对路径（系统设计 §8.1 导入路径约定）。
 */
export { ColumnMapper, normalizeTableHeaders } from './column-mapper';
export type { MappedRow, MappingValidation, NormalizedTable } from './column-mapper';
export { DirectionResolver } from './direction';
export type { DirectionResult } from './direction';
export { UTF8_BOM, decodeBytes, decodeChunks, detectEncoding, hasBom, stripBom } from './encoding';
export { CsvParser } from './parser';
export type { CsvParserOptions, CsvRow, CsvTable, ParseOptions } from './parser';
export { ParseRowError, RowMapper } from './row-mapper';
export type { PreviewRow, RowContext } from './row-mapper';
