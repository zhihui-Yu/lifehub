/**
 * 金额解析与格式化单测。
 *
 * 覆盖需求：A-02 ①③④、Q3；系统设计 §7 T02 验收「100 次累加结果恒等于精确分值」。
 */
import { describe, expect, it } from 'vitest';
import { LifeHubError } from '../../src/errors';
import { formatMinor, parseAmountToMinor, sumMinor } from '../../src/money/amount';
import { getExponent, isCurrencyCode } from '../../src/money/currency';

describe('parseAmountToMinor', () => {
  it('把普通十进制金额解析为整数分', () => {
    expect(parseAmountToMinor('12.34')).toBe(1234);
    expect(parseAmountToMinor('0.01')).toBe(1);
    expect(parseAmountToMinor('100')).toBe(10_000);
  });

  it('剥离千分位与货币符号', () => {
    expect(parseAmountToMinor('1,234.56')).toBe(123_456);
    expect(parseAmountToMinor('¥12.34')).toBe(1234);
    expect(parseAmountToMinor('￥12.34')).toBe(1234);
    expect(parseAmountToMinor('12.34 元')).toBe(1234);
    expect(parseAmountToMinor('RMB 12.34')).toBe(1234);
  });

  it('支持全角数字与全角空格', () => {
    expect(parseAmountToMinor('１２.３４')).toBe(1234);
    expect(parseAmountToMinor('　12.34　')).toBe(1234);
  });

  it('识别括号负数并按选项决定是否允许', () => {
    // 注意：断言抛错必须写成 `expect(() => fn()).toThrow(...)`，
    // 直接写 `expect(fn()).toThrow(...)` 会先执行函数，异常会绕过断言直接让用例失败。
    expect(() => parseAmountToMinor('(35.00)')).toThrow(LifeHubError);
    expect(parseAmountToMinor('(35.00)', { allowNegative: true })).toBe(-3500);
    expect(parseAmountToMinor('-35.00', { allowNegative: true })).toBe(-3500);
  });

  it('按币种小数位解析（JPY 为 0 位）', () => {
    expect(parseAmountToMinor('1234', { currency: 'JPY' })).toBe(1234);
    // 小数位超出币种精度即判非法（PRD A-02 ①），不做静默截断。
    expect(() => parseAmountToMinor('12.34', { currency: 'JPY' })).toThrow(LifeHubError);
  });

  it('拒绝非法输入并抛出 LIFEHUB_E_AMOUNT_INVALID', () => {
    for (const bad of ['', 'abc', '12.3.4', '.', '--1']) {
      expect(() => parseAmountToMinor(bad)).toThrowError(
        expect.objectContaining({ code: 'LIFEHUB_E_AMOUNT_INVALID' }),
      );
    }
  });
});

describe('formatMinor', () => {
  it('把整数分格式化为十进制字符串', () => {
    expect(formatMinor(1234)).toBe('12.34');
    expect(formatMinor(5)).toBe('0.05');
    expect(formatMinor(0)).toBe('0.00');
    expect(formatMinor(-1234)).toBe('-12.34');
  });

  it('按币种小数位格式化', () => {
    expect(formatMinor(1234, 'JPY')).toBe('1234');
    expect(formatMinor(1234, 'KWD')).toBe('1.234');
  });

  it('拒绝非整数输入', () => {
    expect(() => formatMinor(12.34)).toThrow(LifeHubError);
  });
});

describe('sumMinor', () => {
  it('整数分求和全程零浮点（PRD A-02 ③）', () => {
    // 100 次累加 12.34 元，若用浮点会得到 1233.9999...；整数分则恒为 123400。
    let total = 0;
    for (let index = 0; index < 100; index += 1) {
      total = sumMinor([total, 1234]);
    }
    expect(total).toBe(123_400);
  });

  it('拒绝非整数元素', () => {
    expect(() => sumMinor([1.5])).toThrow(LifeHubError);
  });

  it('空数组求和为 0', () => {
    expect(sumMinor([])).toBe(0);
  });
});

describe('currency', () => {
  it('返回正确的指数', () => {
    expect(getExponent('CNY')).toBe(2);
    expect(getExponent('JPY')).toBe(0);
    expect(getExponent('KWD')).toBe(3);
  });

  it('识别非法币种', () => {
    expect(isCurrencyCode('CNY')).toBe(true);
    expect(isCurrencyCode('USD')).toBe(false);
    expect(isCurrencyCode(123)).toBe(false);
  });
});
