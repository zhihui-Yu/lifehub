/**
 * 日期时间工具单测。
 *
 * 覆盖需求：A-03 ③④；系统设计 §7 T02 验收「UTC 20:30 在 Asia/Shanghai 下 localDate 为次日」。
 */
import { describe, expect, it } from 'vitest';
import { addDays, diffDays, formatIsoUtc, parseFlexibleDate, toLocalDate, toWallClock } from '../../src/time/datetime';
import { isExcelSerialDate } from '../../src/time/date-formats';
import { isValidTimeZone, resolveTimeZone } from '../../src/time/time-zone';

describe('parseFlexibleDate', () => {
  it('解析 20240115 紧凑格式', () => {
    const result = parseFlexibleDate('20240115', { timeZone: 'UTC' });
    expect(result.occurredAt).toBe('2024-01-15T00:00:00.000Z');
    expect(result.localDate).toBe('2024-01-15');
    expect(result.matchedFormat).toBe('ymdCompact');
  });

  it('解析 2024-01-15 短横线格式', () => {
    const result = parseFlexibleDate('2024-01-15', { timeZone: 'UTC' });
    expect(result.localDate).toBe('2024-01-15');
  });

  it('解析 2024/01/15 08:30:00 斜杠格式', () => {
    const result = parseFlexibleDate('2024/01/15 08:30:00', { timeZone: 'UTC' });
    expect(result.occurredAt).toBe('2024-01-15T08:30:00.000Z');
    expect(result.matchedFormat).toBe('ymdSlash');
  });

  it('解析 2024年01月15日 中文格式', () => {
    const result = parseFlexibleDate('2024年01月15日', { timeZone: 'UTC' });
    expect(result.localDate).toBe('2024-01-15');
    expect(result.matchedFormat).toBe('ymdCn');
  });

  it('解析带时区偏移的 ISO 格式', () => {
    const result = parseFlexibleDate('2024-01-15T08:30:00+08:00', { timeZone: 'UTC' });
    expect(result.occurredAt).toBe('2024-01-15T00:30:00.000Z');
    expect(result.localDate).toBe('2024-01-15');
    expect(result.matchedFormat).toBe('iso');
  });

  it('解析 Excel 日期序列号', () => {
    // 45306 对应 2024-01-15。
    const result = parseFlexibleDate('45306', { timeZone: 'UTC' });
    expect(result.localDate).toBe('2024-01-15');
    expect(result.matchedFormat).toBe('excelSerial');
  });

  it('UTC 20:30 在 Asia/Shanghai 下 localDate 为次日（PRD A-03 ④）', () => {
    const result = parseFlexibleDate('2024-01-15T20:30:00Z', { timeZone: 'Asia/Shanghai' });
    expect(result.occurredAt).toBe('2024-01-15T20:30:00.000Z');
    expect(result.localDate).toBe('2024-01-16');
  });

  it('无时区偏移时间（Naive Datetime）在 Asia/Shanghai 下 16:00 后绝不跨天变成次日（T-Date-Timezone-And-BackToTop-1）', () => {
    const bocFirst = parseFlexibleDate('2026-10-27 16:14:57', { timeZone: 'Asia/Shanghai' });
    expect(bocFirst.localDate).toBe('2026-10-27');
    expect(bocFirst.occurredAt).toBe('2026-10-27T08:14:57.000Z');
    expect(bocFirst.sourceTimeZone).toBe('Asia/Shanghai');
    expect(toWallClock(new Date(bocFirst.occurredAt), 'Asia/Shanghai')).toBe('16:14');

    const evening1 = parseFlexibleDate('2026-10-24 16:37:16', { timeZone: 'Asia/Shanghai' });
    expect(evening1.localDate).toBe('2026-10-24');
    expect(evening1.occurredAt).toBe('2026-10-24T08:37:16.000Z');

    const evening2 = parseFlexibleDate('2026-10-17 23:56:10', { timeZone: 'Asia/Shanghai' });
    expect(evening2.localDate).toBe('2026-10-17');
    expect(evening2.occurredAt).toBe('2026-10-17T15:56:10.000Z');
  });

  it('非法日期抛出 LIFEHUB_E_DATE_INVALID', () => {
    expect(() => parseFlexibleDate('not-a-date')).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_DATE_INVALID' }),
    );
    expect(() => parseFlexibleDate('2024-02-31')).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_DATE_INVALID' }),
    );
  });

  it('优先尝试 dateFormatHints 中记录的格式', () => {
    const result = parseFlexibleDate('20240115', { timeZone: 'UTC', dateFormatHints: ['ymdCompact'] });
    expect(result.matchedFormat).toBe('ymdCompact');
  });
});

describe('toLocalDate', () => {
  it('按目标时区换算日历日', () => {
    const instant = new Date('2024-06-03T08:12:00.000Z');
    expect(toLocalDate(instant, 'UTC')).toBe('2024-06-03');
    expect(toLocalDate(instant, 'Asia/Shanghai')).toBe('2024-06-03');
    expect(toLocalDate(instant, 'America/New_York')).toBe('2024-06-03');
  });

  it('跨天场景返回次日', () => {
    const instant = new Date('2024-06-03T20:30:00.000Z');
    expect(toLocalDate(instant, 'Asia/Shanghai')).toBe('2024-06-04');
  });
});

describe('formatIsoUtc / toWallClock', () => {
  it('输出毫秒精度的 ISO UTC', () => {
    expect(formatIsoUtc(new Date('2024-06-03T08:12:00Z'))).toBe('2024-06-03T08:12:00.000Z');
  });

  it('按时区输出墙钟时间', () => {
    expect(toWallClock(new Date('2024-06-03T08:12:00Z'), 'Asia/Shanghai')).toBe('16:12');
    expect(toWallClock(new Date('2024-06-03T08:12:00Z'), 'UTC')).toBe('08:12');
  });
});

describe('addDays / diffDays', () => {
  it('按日历日加减', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2024-01-01', -1)).toBe('2023-12-31');
    expect(addDays('2024-12-31', 1)).toBe('2025-01-01');
  });

  it('计算天数差', () => {
    expect(diffDays('2024-01-01', '2024-01-31')).toBe(30);
    expect(diffDays('2024-01-31', '2024-01-01')).toBe(-30);
  });

  it('拒绝非法日历日', () => {
    expect(() => addDays('2024-1-1', 1)).toThrow();
  });
});

describe('time-zone', () => {
  it('识别合法与非法时区', () => {
    expect(isValidTimeZone('Asia/Shanghai')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });

  it('能解析出运行环境时区', () => {
    expect(typeof resolveTimeZone()).toBe('string');
  });
});

describe('date-formats', () => {
  it('识别 Excel 序列号区间', () => {
    expect(isExcelSerialDate('45306')).toBe(true);
    expect(isExcelSerialDate('20240115')).toBe(false);
    expect(isExcelSerialDate('abc')).toBe(false);
  });
});
