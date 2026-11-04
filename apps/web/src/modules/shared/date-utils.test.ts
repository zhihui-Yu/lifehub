/**
 * 共享日期工具测试。
 *
 * 覆盖需求：S4 跨天 / 连续天数只比 `localDate` 字符串的契约；提供测试左移夹具。
 *
 * 说明：纯函数，无需数据库；重点验证星期换算与时区无关、区间枚举边界。
 */
import { describe, expect, it } from 'vitest';
import {
  getMonthRange,
  getTodayLocalDate,
  getWeekRange,
  listLocalDates,
  weekdayOf,
} from '@/modules/shared/date-utils';

describe('weekdayOf', () => {
  it('把日历日当作 UTC 零点换算星期，与用户时区无关', () => {
    // 2024-06-03 是星期一。
    expect(weekdayOf('2024-06-03')).toBe(1);
    // 2024-06-09 是星期日。
    expect(weekdayOf('2024-06-09')).toBe(0);
    // 2024-06-08 是星期六。
    expect(weekdayOf('2024-06-08')).toBe(6);
  });
});

describe('listLocalDates', () => {
  it('枚举闭区间 [from, to] 内的全部日历日（含两端）', () => {
    expect(listLocalDates('2024-06-01', '2024-06-03')).toEqual([
      '2024-06-01',
      '2024-06-02',
      '2024-06-03',
    ]);
  });

  it('跨月也能正确推进', () => {
    expect(listLocalDates('2024-01-30', '2024-02-02')).toEqual([
      '2024-01-30',
      '2024-01-31',
      '2024-02-01',
      '2024-02-02',
    ]);
  });

  it('to 早于 from 时返回空数组', () => {
    expect(listLocalDates('2024-06-05', '2024-06-01')).toEqual([]);
  });
});

describe('getWeekRange（周一为一周起点）', () => {
  it('返回包含该天的自然周 [周一, 周日]', () => {
    // 2024-06-05 是星期三，所在周周一为 06-03、周日为 06-09。
    expect(getWeekRange('2024-06-05')).toEqual(['2024-06-03', '2024-06-09']);
    // 星期一本身。
    expect(getWeekRange('2024-06-03')).toEqual(['2024-06-03', '2024-06-09']);
    // 星期日。
    expect(getWeekRange('2024-06-09')).toEqual(['2024-06-03', '2024-06-09']);
  });
});

describe('getMonthRange', () => {
  it('返回该月 [1 日, 月末日]，含闰年二月', () => {
    expect(getMonthRange('2024-06-15')).toEqual(['2024-06-01', '2024-06-30']);
    expect(getMonthRange('2024-02-10')).toEqual(['2024-02-01', '2024-02-29']);
  });
});

describe('getTodayLocalDate', () => {
  it('返回的字符串符合 YYYY-MM-DD', () => {
    expect(getTodayLocalDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
