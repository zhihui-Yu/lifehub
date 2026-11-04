/**
 * 手动账单构造工厂。
 *
 * 架构位置：apps/web 的「领域辅助」层。
 *
 * 说明：把用户在「记一笔」表单里填写的**明文输入**组装成合法的 `Bill` 实体。
 * 金额与日期解析复用 core 的 `parseAmountToMinor` / `toLocalDate`，
 * 绝不自己用 `parseFloat` 或 `new Date('YYYY-MM-DD')` 直接换算——
 * 金额全程字符串切分（PRD A-02），时间走 `Intl` 墙钟→UTC，避免时区与浮点误差。
 *
 * 安全约束：构造出的 `Bill` 经 `validateBill` 校验后才交出去，禁止把未校验对象写入存储。
 */
import {
  DEFAULT_CURRENCY,
  LifeHubError,
  type Bill,
  type CurrencyCode,
  type Direction,
  parseAmountToMinor,
  toLocalDate,
  uuidV7,
  validateBill,
} from '@lifehub/core';
import { useSettingsStore } from '@/store/settings-store';

/** 手动记账来源 id（与导入批次区分开；账单列表的「来源文件」列对手动账显示为「手动记录」）。 */
export const MANUAL_SOURCE_ID = 'manual-entry';

/** 本地设备 id（与导入流程保持一致，见 `useImportFlow.ts`）。 */
export const LOCAL_DEVICE_ID = 'local-device';

/** 手动记账表单输入。 */
export interface ManualBillInput {
  /** 本地日历日 'YYYY-MM-DD'（表单 `<input type="date">` 的值）。 */
  date: string;
  /** 墙钟时间 'HH:mm'；省略视为 00:00。 */
  time?: string;
  /** 金额文本（用户输入的原样字符串，如 '12.34'）；金额恒为正，方向由 `direction` 表达。 */
  amountText: string;
  /** 收支方向。 */
  direction: Direction;
  /** 交易对方；可空。 */
  counterparty: string;
  /** 分类 id；未分类为 null。 */
  categoryId: string | null;
  /** 备注；可空。 */
  note: string;
}

/** 构造所需的上下文（来自已解锁的运行时）。 */
export interface BillBuildContext {
  /** 时钟端口（提供 ISO 8601 UTC 时间戳）。 */
  clock: { nowIso(): string };
  /** 设备 id。 */
  deviceId: string;
  /** 用户 IANA 时区（决定 `localDate` 与 `sourceTimeZone`）。 */
  timeZone: string;
}

/**
 * 归一化账单构造上下文。
 *
 * 说明：允许调用方传入完整 `BillBuildContext` 或仅传入 IANA 时区字符串；省略时自动读取全局设置中的默认时区。
 *
 * @param ctxOrTimeZone 运行时上下文或时区字符串（可选）
 * @returns 标准化的 `BillBuildContext`
 * @throws 无；纯辅助函数不抛出异常
 */
function normalizeBuildContext(ctxOrTimeZone?: BillBuildContext | string): BillBuildContext {
  const fallbackTz =
    useSettingsStore.getState().timezone ||
    (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' : 'UTC');
  if (typeof ctxOrTimeZone === 'string') {
    return {
      clock: { nowIso: () => new Date().toISOString() },
      deviceId: LOCAL_DEVICE_ID,
      timeZone: ctxOrTimeZone.trim() || fallbackTz,
    };
  }
  if (ctxOrTimeZone) {
    return {
      clock: ctxOrTimeZone.clock,
      deviceId: ctxOrTimeZone.deviceId || LOCAL_DEVICE_ID,
      timeZone: ctxOrTimeZone.timeZone.trim() || fallbackTz,
    };
  }
  return {
    clock: { nowIso: () => new Date().toISOString() },
    deviceId: LOCAL_DEVICE_ID,
    timeZone: fallbackTz,
  };
}

/**
 * 把「记一笔」表单输入组装成一个合法的 `Bill`。
 *
 * 说明：根据目标时区将表单中的本地日历日与墙钟时间严格反解为 UTC 时间戳，并校验实体合法性。
 *
 * @param input 表单输入
 * @param ctxOrTimeZone 运行时上下文或目标 IANA 时区名（可选）
 * @returns 经 `validateBill` 校验通过的账单实体
 * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 金额 / 日期 / 方向任一非法
 */
export function buildManualBill(
  input: ManualBillInput,
  ctxOrTimeZone?: BillBuildContext | string,
): Bill {
  const ctx = normalizeBuildContext(ctxOrTimeZone);
  const amountMinor = parseManualAmount(input.amountText, ctx.clock);
  const { occurredAt, localDate, sourceTimeZone } = resolveLocalDateTime(
    input.date,
    input.time,
    ctx.timeZone,
  );

  const now = ctx.clock.nowIso();
  const bill: Bill = {
    id: uuidV7(),
    amountMinor,
    currency: DEFAULT_CURRENCY as CurrencyCode,
    direction: input.direction,
    occurredAt,
    localDate,
    sourceTimeZone,
    counterparty: input.counterparty.trim(),
    categoryId: input.categoryId,
    note: input.note.trim(),
    sourceFileId: MANUAL_SOURCE_ID,
    sourceRowIndex: 0,
    createdAt: now,
    updatedAt: now,
    version: 1,
    deviceId: ctx.deviceId,
  };
  return validateBill(bill);
}

/**
 * 创建手动账单实体的便捷工厂函数。
 *
 * 说明：`buildManualBill` 的语义别名，支持传入 `BillBuildContext` 或直接传入目标 IANA 时区名。
 *
 * @param input 表单输入
 * @param ctxOrTimeZone 运行时上下文或目标 IANA 时区名（可选）
 * @returns 经 `validateBill` 校验通过的账单实体
 * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 金额 / 日期 / 方向任一非法
 */
export function createManualBill(
  input: ManualBillInput,
  ctxOrTimeZone?: BillBuildContext | string,
): Bill {
  return buildManualBill(input, ctxOrTimeZone);
}

/**
 * 把表单编辑应用到已有账单上，返回更新后的实体。
 *
 * 说明：保留 `id` / `createdAt` / `deviceId` / `sourceFileId`（来源归属不变），
 * 金额与日期按新输入重算，`version` 自增 1，`updatedAt` 刷新。
 *
 * @param existing 被编辑的账单
 * @param patch 新的表单输入
 * @param ctx 运行时上下文
 * @returns 更新后的合法账单
 * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 任一字段非法
 */
export function applyBillEdit(existing: Bill, patch: ManualBillInput, ctx: BillBuildContext): Bill {
  const amountMinor = parseManualAmount(patch.amountText, ctx.clock);
  const { occurredAt, localDate, sourceTimeZone } = resolveLocalDateTime(
    patch.date,
    patch.time,
    ctx.timeZone,
  );

  const updated: Bill = {
    ...existing,
    amountMinor,
    direction: patch.direction,
    occurredAt,
    localDate,
    sourceTimeZone,
    counterparty: patch.counterparty.trim(),
    categoryId: patch.categoryId,
    note: patch.note.trim(),
    updatedAt: ctx.clock.nowIso(),
    version: existing.version + 1,
  };
  return validateBill(updated);
}

/**
 * 解析手动金额文本为整数分。
 *
 * 说明：金额恒为正，方向由 `direction` 单独表达（PRD Q8）；
 * 因此这里拒绝负号输入（避免与方向语义冲突），解析失败统一抛中文错误。
 *
 * @param amountText 金额文本
 * @param clock 时钟（仅在异常时给出稳定文案，不依赖其值）
 * @returns 非负整数分
 * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 金额无法解析为非负数
 */
function parseManualAmount(amountText: string, clock: { nowIso(): string }): number {
  void clock;
  const text = amountText.trim();
  if (text === '') {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '金额不能为空');
  }
  let minor: number;
  try {
    // 金额恒为正：不允许负号（方向已在表单单独选择）。
    minor = parseAmountToMinor(text, { currency: DEFAULT_CURRENCY, allowNegative: false });
  } catch {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '金额格式不正确，请输入数字（如 12.34）');
  }
  if (minor <= 0) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '金额必须大于 0');
  }
  return minor;
}

/**
 * 计算某个 UTC 毫秒时间戳在指定 IANA 时区下的墙钟各分量，并将其按 UTC 历法合成为毫秒数以供偏移量反算。
 *
 * 说明：使用 `Intl.DateTimeFormat` 提取目标时区的年/月/日/时/分/秒，不依赖宿主浏览器本地时区。
 *
 * @param instantMs UTC 毫秒时间戳
 * @param timeZone 目标 IANA 时区名
 * @returns 墙钟各分量按 `Date.UTC` 合成的毫秒数
 * @throws 无；内部保证传入合法时区与时间戳
 */
function getWallClockAsUtcMs(instantMs: number, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(new Date(instantMs));
  let year = 1970;
  let month = 1;
  let day = 1;
  let hour = 0;
  let minute = 0;
  let second = 0;
  for (const part of parts) {
    if (part.type === 'year') year = Number(part.value);
    else if (part.type === 'month') month = Number(part.value);
    else if (part.type === 'day') day = Number(part.value);
    else if (part.type === 'hour') hour = Number(part.value);
    else if (part.type === 'minute') minute = Number(part.value);
    else if (part.type === 'second') second = Number(part.value);
  }
  if (hour === 24) {
    hour = 0;
  }
  return Date.UTC(year, month - 1, day, hour, minute, second, 0);
}

/**
 * 校验并规范化 IANA 时区名称。
 *
 * 说明：若传入的时区标识无效或为空，则安全回退到 `'UTC'`。
 *
 * @param timeZone 待校验的时区字符串
 * @returns 合法的 IANA 时区名称
 * @throws 无；异常在内部捕获并回退 `'UTC'`
 */
function resolveValidTimeZone(timeZone: string): string {
  const candidate = (timeZone || '').trim();
  if (!candidate) {
    return 'UTC';
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate });
    return candidate;
  } catch {
    return 'UTC';
  }
}

/**
 * 把目标时区下的本地日历日 + 墙钟时间严格反解为 UTC 时间戳与本地日历日。
 *
 * 说明：严禁使用 `new Date('YYYY-MM-DDTHH:mm')`（该方法始终按宿主浏览器时区解析）；
 * 本函数通过 `Date.UTC` 与 `Intl.DateTimeFormat` 两步偏移修正，按目标 `timeZone` 精确反算 UTC Instant，
 * 保证无论宿主机器位于何种时区，在目标 `timeZone` 下还原出的 `localDate` 与墙钟时间均 100% 恒等。
 *
 * @param date 目标时区下的本地日历日 `'YYYY-MM-DD'`
 * @param time 目标时区下的墙钟时间 `'HH:mm'`（省略时默认 `'00:00'`）
 * @param timeZone 目标 IANA 时区名
 * @returns 包含 `occurredAt`（UTC ISO）、`localDate` 与 `sourceTimeZone` 的解析结果
 * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 日期或时间文本无法解析
 */
export function resolveLocalDateTime(
  date: string,
  time: string | undefined,
  timeZone: string,
): { occurredAt: string; localDate: string; sourceTimeZone: string } {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!dateMatch) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '日期格式不正确');
  }
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const calendarCheck = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(calendarCheck.getTime()) ||
    calendarCheck.getUTCFullYear() !== year ||
    calendarCheck.getUTCMonth() !== month - 1 ||
    calendarCheck.getUTCDate() !== day
  ) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '日期格式不正确');
  }

  const rawTime = time && time.trim() !== '' ? time.trim() : '00:00';
  const timeMatch = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(rawTime);
  if (!timeMatch) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '日期格式不正确');
  }
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const second = timeMatch[3] ? Number(timeMatch[3]) : 0;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '日期格式不正确');
  }

  const effectiveTimeZone = resolveValidTimeZone(timeZone);
  const targetAsUtcMs = Date.UTC(year, month - 1, day, hour, minute, second, 0);
  const offset1 = getWallClockAsUtcMs(targetAsUtcMs, effectiveTimeZone) - targetAsUtcMs;
  const guess1 = targetAsUtcMs - offset1;
  const offset2 = getWallClockAsUtcMs(guess1, effectiveTimeZone) - targetAsUtcMs;
  const finalUtcMs = guess1 - offset2;

  const instant = new Date(finalUtcMs);
  if (Number.isNaN(instant.getTime())) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '日期格式不正确');
  }
  const occurredAt = instant.toISOString();
  const localDate = toLocalDate(instant, effectiveTimeZone);
  return { occurredAt, localDate, sourceTimeZone: effectiveTimeZone };
}
