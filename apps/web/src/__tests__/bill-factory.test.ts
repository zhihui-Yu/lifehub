/**
 * 手动账单构造工厂测试。
 *
 * 覆盖：buildManualBill / applyBillEdit 的金额解析、时区换算、字段归属与版本递增。
 */
import { describe, expect, it } from 'vitest';
import {
  buildManualBill,
  createManualBill,
  applyBillEdit,
  MANUAL_SOURCE_ID,
  LOCAL_DEVICE_ID,
} from '@/lib/bill-factory';
import { toLocalDate, toWallClock, type Bill } from '@lifehub/core';

const CLOCK = { nowIso: () => '2024-01-01T00:00:00.000Z' };
const CTX = { clock: CLOCK, deviceId: LOCAL_DEVICE_ID, timeZone: 'Asia/Shanghai' };

describe('buildManualBill', () => {
  it('把合法输入组装为带 localDate / 来源 / 版本的 Bill', () => {
    const bill = buildManualBill(
      {
        date: '2024-01-15',
        time: '08:00',
        amountText: '35.50',
        direction: 'expense',
        counterparty: '星巴克',
        categoryId: 'c1',
        note: '拿铁',
      },
      CTX,
    );

    expect(bill.amountMinor).toBe(3550);
    expect(bill.direction).toBe('expense');
    expect(bill.localDate).toBe('2024-01-15');
    expect(bill.sourceFileId).toBe(MANUAL_SOURCE_ID);
    expect(bill.sourceRowIndex).toBe(0);
    expect(bill.version).toBe(1);
    expect(bill.deviceId).toBe(LOCAL_DEVICE_ID);
    expect(bill.counterparty).toBe('星巴克');
    expect(bill.categoryId).toBe('c1');
    expect(bill.note).toBe('拿铁');
    // occurredAt 按 CTX.timeZone ('Asia/Shanghai', UTC+8) 将本地墙钟 08:00 反解为 UTC 00:00。
    expect(bill.occurredAt).toBe('2024-01-15T00:00:00.000Z');
  });

  it('省略时间时默认 00:00 且金额恒为正', () => {
    const bill = buildManualBill(
      { date: '2024-02-02', amountText: '100', direction: 'income', counterparty: '', categoryId: null, note: '' },
      CTX,
    );
    expect(bill.amountMinor).toBe(10000);
    expect(bill.localDate).toBe('2024-02-02');
    expect(bill.occurredAt).toBe('2024-02-01T16:00:00.000Z');
  });

  it('金额为空 / 零 / 负号都会抛中文校验错误', () => {
    expect(() => buildManualBill({ date: '2024-01-15', amountText: '', direction: 'expense', counterparty: '', categoryId: null, note: '' }, CTX)).toThrow('金额不能为空');
    expect(() => buildManualBill({ date: '2024-01-15', amountText: '0', direction: 'expense', counterparty: '', categoryId: null, note: '' }, CTX)).toThrow('金额必须大于 0');
    expect(() => buildManualBill({ date: '2024-01-15', amountText: '-5', direction: 'expense', counterparty: '', categoryId: null, note: '' }, CTX)).toThrow();
  });

  it('非法日期文本抛中文错误', () => {
    expect(() => buildManualBill({ date: '2024-13-99', amountText: '10', direction: 'expense', counterparty: '', categoryId: null, note: '' }, CTX)).toThrow('日期格式不正确');
  });

  it('跨时区墙钟时间解析恒等式：在 America/New_York 与 Asia/Tokyo 下新建账单绝不因宿主时区发生跨日偏移（T-Timezone-Unify-1）', () => {
    for (const tz of ['America/New_York', 'Asia/Tokyo', 'UTC', 'Europe/London', 'Asia/Shanghai']) {
      const bill = createManualBill(
        {
          date: '2026-10-20',
          time: '01:30',
          amountText: '56.78',
          direction: 'expense',
          counterparty: '跨时区商户',
          categoryId: null,
          note: '凌晨消费',
        },
        { clock: CLOCK, deviceId: LOCAL_DEVICE_ID, timeZone: tz },
      );

      expect(bill.sourceTimeZone).toBe(tz);
      expect(bill.localDate).toBe('2026-10-20');
      expect(toLocalDate(new Date(bill.occurredAt), tz)).toBe('2026-10-20');
      expect(toWallClock(new Date(bill.occurredAt), tz)).toBe('01:30');
    }
  });
});

describe('applyBillEdit', () => {
  const base: Bill = {
    id: 'b-1',
    amountMinor: 100,
    currency: 'CNY',
    direction: 'expense',
    occurredAt: '2024-01-15T00:00:00.000Z',
    localDate: '2024-01-15',
    sourceTimeZone: 'Asia/Shanghai',
    counterparty: '旧',
    categoryId: null,
    note: '旧备注',
    sourceFileId: MANUAL_SOURCE_ID,
    sourceRowIndex: 0,
    createdAt: '2024-01-15T00:00:00.000Z',
    updatedAt: '2024-01-15T00:00:00.000Z',
    version: 3,
    deviceId: LOCAL_DEVICE_ID,
  };

  it('保留 id / createdAt / deviceId / source 归属，仅递增版本并更新字段', () => {
    const updated = applyBillEdit(
      base,
      { date: '2024-03-03', amountText: '88.88', direction: 'refund', counterparty: '新', categoryId: 'c2', note: '改' },
      CTX,
    );
    expect(updated.id).toBe('b-1');
    expect(updated.createdAt).toBe(base.createdAt);
    expect(updated.deviceId).toBe(LOCAL_DEVICE_ID);
    expect(updated.sourceFileId).toBe(MANUAL_SOURCE_ID);
    expect(updated.version).toBe(4);
    expect(updated.amountMinor).toBe(8888);
    expect(updated.direction).toBe('refund');
    expect(updated.localDate).toBe('2024-03-03');
    expect(updated.updatedAt).toBe(CLOCK.nowIso());
  });
});
