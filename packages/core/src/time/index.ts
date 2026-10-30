/**
 * 时间处理模块 barrel。
 *
 * 说明：统一从这里导出，避免上层出现深层相对路径（系统设计 §8.1 导入路径约定）。
 */
export {
  addDays,
  diffDays,
  formatIsoUtc,
  isIsoUtc,
  parseFlexibleDate,
  toLocalDate,
  toWallClock,
} from './datetime';
export type { ParseDateOptions, ParsedDate } from './datetime';

export {
  DATE_FORMATS,
  EXCEL_EPOCH_UTC,
  buildUtcDate,
  excelSerialToDate,
  isExcelSerialDate,
  isValidDateParts,
  parseOffsetMinutes,
} from './date-formats';
export type { DateFormatDescriptor } from './date-formats';

export {
  DEFAULT_TIME_ZONE,
  TIMEZONE_CANDIDATES,
  assertTimeZone,
  guessSourceTimeZone,
  isValidTimeZone,
  resolveTimeZone,
} from './time-zone';
