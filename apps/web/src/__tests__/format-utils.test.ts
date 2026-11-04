/**
 * 格式化与文件工具单测。
 *
 * 覆盖需求：A-09 ③（组头日期 + 星期 + 相对时间）、A-08（文件类型校验）、
 * 以及 UI-04 交互要点 3（盐值备份文件名含日期）。
 */
import { describe, expect, it } from 'vitest';
import { buildDatedFileName } from '@/utils/download';
import { isSupportedFileType } from '@/utils/file';
import {
  formatAmount,
  formatAmountWithDirection,
  formatBytes,
  formatLocalDate,
  formatRelativeTime,
  formatWeekday,
} from '@/utils/format';

/** 固定的时间基准：2024-01-15T08:12:00.000Z。 */
const NOW = new Date('2024-01-15T08:12:00.000Z').getTime();

describe('formatAmount（分为单位整数 → 展示字符串）', () => {
  it('按两位小数格式化', () => {
    expect(formatAmount(1234)).toBe('12.34');
    expect(formatAmount(0)).toBe('0.00');
    expect(formatAmount(5)).toBe('0.05');
    expect(formatAmount(100)).toBe('1.00');
    expect(formatAmount(123456)).toBe('1234.56');
  });

  it('负数保留负号', () => {
    expect(formatAmount(-1234)).toBe('-12.34');
  });
});

describe('formatAmountWithDirection', () => {
  it('按方向拼出中文标识 + 金额', () => {
    expect(formatAmountWithDirection(1234, 'expense')).toBe('支出 ¥12.34');
    expect(formatAmountWithDirection(1234, 'income')).toBe('收入 ¥12.34');
    expect(formatAmountWithDirection(1234, 'refund')).toBe('退款 ¥12.34');
  });
});

describe('formatLocalDate / formatWeekday', () => {
  it('本地日历日转成中文可读形式', () => {
    expect(formatLocalDate('2024-01-15')).toBe('2024年1月15日');
    expect(formatLocalDate('2024-12-31')).toBe('2024年12月31日');
  });

  it('本地日历日转成星期中文名', () => {
    expect(formatWeekday('2024-01-15')).toBe('星期一');
    expect(formatWeekday('2024-01-16')).toBe('星期二');
    expect(formatWeekday('2024-01-21')).toBe('星期日');
  });
});

describe('formatRelativeTime', () => {
  it('一分钟内显示「刚刚」', () => {
    expect(formatRelativeTime('2024-01-15T08:11:30.000Z', NOW)).toBe('刚刚');
  });

  it('小时级显示「N 分钟前 / 后」', () => {
    expect(formatRelativeTime('2024-01-15T08:02:00.000Z', NOW)).toBe('10 分钟前');
    expect(formatRelativeTime('2024-01-15T08:22:00.000Z', NOW)).toBe('10 分钟后');
  });

  it('天级显示「N 小时前 / 后」', () => {
    expect(formatRelativeTime('2024-01-15T06:12:00.000Z', NOW)).toBe('2 小时前');
    expect(formatRelativeTime('2024-01-15T10:12:00.000Z', NOW)).toBe('2 小时后');
  });

  it('超过一天显示「N 天前 / 后」', () => {
    expect(formatRelativeTime('2024-01-13T08:12:00.000Z', NOW)).toBe('2 天前');
    expect(formatRelativeTime('2024-01-17T08:12:00.000Z', NOW)).toBe('2 天后');
  });

  it('超过 30 天退化为具体日期', () => {
    expect(formatRelativeTime('2023-11-01T08:12:00.000Z', NOW)).toBe('2023年11月1日');
  });

  it('时间戳非法时返回空串', () => {
    expect(formatRelativeTime('不是时间', NOW)).toBe('');
  });
});

describe('formatBytes', () => {
  it('按量级给出可读体积', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(1024 * 1024 * 3)).toBe('3.0 MB');
  });
});

describe('isSupportedFileType（A-08 文件类型校验）', () => {
  /**
   * 构造一个只有名字与类型的假文件。
   *
   * @param name 文件名
   * @param type MIME 类型
   * @returns File 实例
   */
  function fakeFile(name: string, type: string): File {
    return new File([''], name, { type });
  }

  it('.csv 文件受支持', () => {
    expect(isSupportedFileType(fakeFile('微信支付.csv', 'text/csv'))).toBe(true);
    expect(isSupportedFileType(fakeFile('BILLS.CSV', ''))).toBe(true);
  });

  it('Excel / PDF / TSV / TXT / ZIP 等账单文件受支持', () => {
    expect(isSupportedFileType(fakeFile('微信支付.xlsx', ''))).toBe(true);
    expect(isSupportedFileType(fakeFile('微信支付.xls', ''))).toBe(true);
    expect(isSupportedFileType(fakeFile('兴业银行.pdf', 'application/pdf'))).toBe(true);
    expect(isSupportedFileType(fakeFile('流水.tsv', ''))).toBe(true);
    expect(isSupportedFileType(fakeFile('流水.txt', 'text/plain'))).toBe(true);
    expect(isSupportedFileType(fakeFile('支付宝交易明细.zip', 'application/zip'))).toBe(true);
  });

  it('非账单文件不受支持', () => {
    expect(isSupportedFileType(fakeFile('照片.png', 'image/png'))).toBe(false);
    expect(isSupportedFileType(fakeFile('文档.docx', 'application/msword'))).toBe(false);
    expect(isSupportedFileType(fakeFile('程序.exe', 'application/octet-stream'))).toBe(false);
  });
});

describe('buildDatedFileName（UI-04 交互要点 3）', () => {
  it('文件名带日期前缀', () => {
    const name = buildDatedFileName('lifehub-salt-backup', '.salt.json', new Date(2024, 0, 5));
    expect(name).toBe('lifehub-salt-backup-2024-01-05.salt.json');
  });
});
