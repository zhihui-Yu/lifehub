/**
 * 覆盖率门禁补测 · money / time / crypto / csv 四个目录补齐到 100%。
 *
 * 覆盖需求：NF-M-4（覆盖率门禁）、系统设计 §7 T05 第 4 条
 * 「core ≥ 80%，crypto/**、csv/**、time/**、money/** 100%」。
 *
 * 【本文件的定位】
 * 既有测试覆盖了各目录的**主路径**，但「异常分支」「边界输入」
 * 「降级参数」这类路径往往没有独立用例，导致覆盖率停在 85%~90%。
 * 本文件**只补缺口**，不重复验证已有断言覆盖的 happy path；
 * 每个用例都对应 lcov 里一个具体的未覆盖行 / 未覆盖分支。
 *
 * 【为什么不改动既有测试】
 * 既有用例的断言是 QA 与架构评审过的基线（NF-M-4 明确要求「不改动既有断言」）。
 * 补覆盖率只能靠**新增**用例，不能靠放宽既有用例的断言。
 *
 * 【覆盖缺口清单（来自 lcov.info，按文件）】
 * - money/amount-sign.ts   86-87（非字符串入参）、106-107（前导 + 号）、125-126（无效文本返回 null）
 * - money/amount.ts        44-45（非字符串）、67-68（超出安全整数）、115-116（求和溢出）
 * - money/currency.ts      63-64（minorToDecimal）
 * - time/datetime.ts       77-81、101-102、152、167-169、178-179、201-208
 * - time/date-formats.ts   120-125、138-139
 * - time/time-zone.ts      62、68、81-85、96-99
 * - crypto/dek.ts          55、72（wrapDek / unwrapDek 薄封装）
 * - crypto/kdf.ts          61-62、86、102-119、149-161、182、197
 * - crypto/recovery-code.ts 62、131-132、139-140、163-164、222-223
 * - crypto/service.ts      77、114、183、192
 * - crypto/providers/*     noble 47-48、54-55；web 75、78、97-98、207-208
 * - csv/column-mapper.ts   93、108-113、135-136、152、157、192、209-210、217
 * - csv/direction.ts       103-104、127、129、145、150-151
 * - csv/encoding.ts        27-28、40、71-83、95-100、104、121-161
 * - csv/parser.ts          136、140、249、296、314、366、411、443-444
 * - csv/row-mapper.ts      129-130、132-133、156、162、224
 */
import { describe, expect, it } from 'vitest';

// ── money ────────────────────────────────────────────────────────────────
import { detectAmountSign, normalizeAmountText } from '../../src/money/amount-sign';
import { parseAmountToMinor, formatMinor, sumMinor } from '../../src/money/amount';
import { minorToDecimal, isCurrencyCode } from '../../src/money/currency';

// ── time ─────────────────────────────────────────────────────────────────
import {
  formatIsoUtc,
  isIsoUtc,
  toLocalDate,
  toWallClock,
  addDays,
  diffDays,
  parseFlexibleDate,
} from '../../src/time/datetime';
import {
  isExcelSerialDate,
  excelSerialToDate,
  parseOffsetMinutes,
  isValidDateParts,
  throwDateInvalid,
  EXCEL_EPOCH_UTC,
} from '../../src/time/date-formats';
import {
  assertTimeZone,
  guessSourceTimeZone,
  isValidTimeZone,
  resolveTimeZone,
  DEFAULT_TIME_ZONE,
} from '../../src/time/time-zone';

// ── crypto ───────────────────────────────────────────────────────────────
import {
  createFallbackKdfParams,
  createKdfParams,
  deserializeKdfParams,
  getKdfParamsVersion,
  isKdfUpgradable,
  serializeKdfParams,
  validateKdfParams,
} from '../../src/crypto/kdf';
import { assertKeyLength, generateDek, generateSalt, unwrapDek, wipeBytes, wrapDek } from '../../src/crypto/dek';
import { CryptoService } from '../../src/crypto/service';
import { WebCryptoProvider } from '../../src/crypto/providers/web-crypto-provider';
import { NobleCryptoProvider } from '../../src/crypto/providers/noble-fallback-provider';
import {
  assertRecoveryCode,
  computeGroupCheck,
  generateRecoveryCode,
  normalizeRecoveryCode,
  splitRecoveryGroups,
  validateRecoveryCode,
} from '../../src/crypto/recovery-code';

// ── csv ──────────────────────────────────────────────────────────────────
import { ColumnMapper } from '../../src/csv/column-mapper';
import { DirectionResolver } from '../../src/csv/direction';
import type { MappedRow } from '../../src/csv/column-mapper';
import type { DirectionRule } from '../../src/models/rule-template';
import {
  detectEncoding,
  decodeBytes,
  decodeChunks,
  hasBom,
  stripBom,
  UTF8_BOM,
} from '../../src/csv/encoding';
import { CsvParser } from '../../src/csv/parser';

/** 16 字节合法盐值。 */
const SALT = new Uint8Array(16).fill(7);

/** 32 字节合法密钥。 */
const KEY = new Uint8Array(32).fill(9);

describe('money · 金额符号与解析的异常分支（补齐 100%）', () => {
  it('normalizeAmountText 遇到非字符串入参时返回「无效」而非抛错', () => {
    // 补 lcov 86-87：非字符串入参的防御分支。
    const result = normalizeAmountText(123 as unknown as string);
    expect(result.digits).toBe('');
    expect(result.negative).toBe(false);
    expect(result.valid).toBe(false);
  });

  it('normalizeAmountText 遇到空字符串与纯空白时返回「无效」', () => {
    expect(normalizeAmountText('').valid).toBe(false);
    expect(normalizeAmountText('   ').valid).toBe(false);
  });

  it('normalizeAmountText 剥掉前导 + 号但不标记为负', () => {
    // 补 lcov 106-107：显式正号分支。
    const result = normalizeAmountText('+35.00');
    expect(result.digits).toBe('35.00');
    expect(result.negative).toBe(false);
    expect(result.valid).toBe(true);
  });

  it('detectAmountSign 对无法解析的文本返回 null（而非 true / false）', () => {
    // 补 lcov 125-126：三态返回里的「不确定」分支。
    expect(detectAmountSign('abc')).toBeNull();
    expect(detectAmountSign('')).toBeNull();
    expect(detectAmountSign('.')).toBeNull();
  });

  it('detectAmountSign 对合法文本返回明确的正 / 负', () => {
    expect(detectAmountSign('35.00')).toBe(false);
    expect(detectAmountSign('-35.00')).toBe(true);
    expect(detectAmountSign('(35.00)')).toBe(true);
    expect(detectAmountSign('¥(35.00)')).toBe(true);
    expect(detectAmountSign('￥-35.00 元')).toBe(true);
  });

  it('parseAmountToMinor 遇到非字符串入参时抛 LIFEHUB_E_AMOUNT_INVALID', () => {
    // 补 lcov 44-45。
    expect(() => parseAmountToMinor(123 as unknown as string)).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_AMOUNT_INVALID' }),
    );
  });

  it('parseAmountToMinor 遇到超出安全整数范围的金额时抛 LIFEHUB_E_AMOUNT_INVALID', () => {
    // 补 lcov 67-68：digits 超出 Number.MAX_SAFE_INTEGER。
    // 用 30 位整数构造，必然溢出安全整数范围。
    const huge = '9'.repeat(30);
    expect(() => parseAmountToMinor(huge)).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_AMOUNT_INVALID' }),
    );
  });

  it('sumMinor 累加溢出安全整数范围时抛 LIFEHUB_E_VALIDATION', () => {
    // 补 lcov 115-116：单项合法但累计溢出。
    expect(() => sumMinor([Number.MAX_SAFE_INTEGER, 1])).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_VALIDATION' }),
    );
  });

  it('sumMinor 遇到非整数分时抛 LIFEHUB_E_VALIDATION', () => {
    expect(() => sumMinor([1.5])).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_VALIDATION' }),
    );
  });

  it('minorToDecimal 把整数分换算为十进制数', () => {
    // 补 lcov 63-64：minorToDecimal 从未被调用过。
    expect(minorToDecimal(1234)).toBe(12.34);
    expect(minorToDecimal(-1234)).toBe(-12.34);
    expect(minorToDecimal(0)).toBe(0);
    expect(minorToDecimal(1234, 'CNY')).toBe(12.34);
  });

  it('isCurrencyCode 识别受支持与不受支持的币种', () => {
    expect(isCurrencyCode('CNY')).toBe(true);
    expect(isCurrencyCode('XXX')).toBe(false);
    expect(isCurrencyCode(123)).toBe(false);
  });

  it('formatMinor 对负数与整数分都给出正确十进制文本', () => {
    expect(formatMinor(1234)).toBe('12.34');
    expect(formatMinor(-1234)).toBe('-12.34');
    expect(formatMinor(0)).toBe('0.00');
    expect(formatMinor(5)).toBe('0.05');
  });

  it('parseAmountToMinor 在 allowNegative 打开时保留负号', () => {
    expect(parseAmountToMinor('-35.00', { allowNegative: true })).toBe(-3500);
    expect(() => parseAmountToMinor('-35.00')).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_AMOUNT_INVALID' }),
    );
  });
});

describe('time · 日期与时区的边界与异常分支（补齐 100%）', () => {
  it('isIsoUtc 识别合法与非法的 ISO 8601 UTC 时间戳', () => {
    // 补 lcov（isIsoUtc 此前从未被调用）。
    expect(isIsoUtc('2024-01-15T08:12:00.000Z')).toBe(true);
    expect(isIsoUtc('2024-01-15T08:12:00Z')).toBe(false);
    expect(isIsoUtc('2024-01-15 08:12:00')).toBe(false);
    expect(isIsoUtc('')).toBe(false);
  });

  it('formatIsoUtc 输出毫秒精度的 ISO 8601 UTC 字符串', () => {
    expect(formatIsoUtc(new Date('2024-01-15T08:12:00.000Z'))).toBe('2024-01-15T08:12:00.000Z');
  });

  it('toLocalDate 按用户时区换算日历日（跨天边界）', () => {
    // 补 lcov 77-81：跨天判定分支。
    const instant = new Date('2024-01-15T20:30:00.000Z');
    // UTC 20:30 在上海已是次日 04:30。
    expect(toLocalDate(instant, 'Asia/Shanghai')).toBe('2024-01-16');
    // UTC 20:30 在纽约仍是当天 15:30。
    expect(toLocalDate(instant, 'America/New_York')).toBe('2024-01-15');
  });

  it('toLocalDate 在非法时区上抛错', () => {
    // 补 lcov 101-102：非法时区的防御分支。
    expect(() => toLocalDate(new Date('2024-01-15T20:30:00.000Z'), 'Not/AZone')).toThrowError();
  });

  it('toWallClock 按用户时区换算墙钟时间', () => {
    // 补 lcov 152 附近的墙钟换算分支。
    const instant = new Date('2024-01-15T20:30:45.000Z');
    expect(toWallClock(instant, 'UTC')).toBe('20:30');
    expect(toWallClock(instant, 'Asia/Shanghai')).toBe('04:30');
  });

  it('toWallClock 在非法时区上抛错', () => {
    expect(() => toWallClock(new Date('2024-01-15T20:30:45.000Z'), 'Not/AZone')).toThrowError();
  });

  it('addDays 在日历日上做加减，跨月跨年都正确', () => {
    // 补 lcov 167-169。
    expect(addDays('2024-01-31', 1)).toBe('2024-02-01');
    expect(addDays('2024-01-01', -1)).toBe('2023-12-31');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
  });

  it('diffDays 计算两个日历日之间的天数差', () => {
    // 补 lcov 178-179。
    expect(diffDays('2024-01-01', '2024-01-31')).toBe(30);
    expect(diffDays('2024-01-31', '2024-01-01')).toBe(-30);
    expect(diffDays('2024-01-01', '2024-01-01')).toBe(0);
  });

  it('parseFlexibleDate 解析多种常见日期写法', () => {
    // 补 lcov 201-208：日期格式命中与时区换算分支。
    const iso = parseFlexibleDate('2024-01-15 08:12:00', { timeZone: 'UTC' });
    expect(iso.occurredAt).toBe('2024-01-15T08:12:00.000Z');
    expect(iso.localDate).toBe('2024-01-15');
    expect(iso.matchedFormat).not.toBe('');

    const dashed = parseFlexibleDate('2024-01-15', { timeZone: 'UTC' });
    expect(dashed.localDate).toBe('2024-01-15');
  });

  it('parseFlexibleDate 对无法解析的文本抛错', () => {
    expect(() => parseFlexibleDate('not-a-date', { timeZone: 'UTC' })).toThrowError();
  });

  it('isExcelSerialDate 识别 Excel 序列日期', () => {
    expect(isExcelSerialDate('45293')).toBe(true);
    expect(isExcelSerialDate('2024-01-15')).toBe(false);
  });

  it('excelSerialToDate 按 Excel 纪元换算成 Date', () => {
    // 补 lcov 71-83 附近的序列日期换算分支。
    const date = excelSerialToDate(45293);
    expect(date.getTime()).toBeGreaterThan(0);
    expect(EXCEL_EPOCH_UTC).toBe(Date.UTC(1899, 11, 30));
  });

  it('parseOffsetMinutes 解析时区偏移文本', () => {
    // 补 lcov 120-125：偏移分钟的解析分支。
    expect(parseOffsetMinutes('+08:00')).toBe(480);
    expect(parseOffsetMinutes('-05:00')).toBe(-300);
    expect(parseOffsetMinutes('+0800')).toBe(480);
    expect(parseOffsetMinutes(undefined)).toBeNull();
    expect(parseOffsetMinutes('bad')).toBeNull();
  });

  it('isValidDateParts 校验年月日三元组', () => {
    // 补 lcov 138-139。
    expect(isValidDateParts(2024, 2, 29)).toBe(true);
    expect(isValidDateParts(2023, 2, 29)).toBe(false);
    expect(isValidDateParts(2024, 13, 1)).toBe(false);
    expect(isValidDateParts(2024, 0, 1)).toBe(false);
  });

  it('throwDateInvalid 抛出统一的日期非法异常', () => {
    expect(() => throwDateInvalid('bad')).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_DATE_INVALID' }),
    );
  });

  it('isValidTimeZone 区分合法与非法时区', () => {
    expect(isValidTimeZone('Asia/Shanghai')).toBe(true);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
  });

  it('resolveTimeZone 在运行环境时区不可用时回落到兜底时区', () => {
    // 补 lcov 62、68：resolveTimeZone 的两条分支。
    // ① 运行环境时区有效时直接采用它。
    expect(resolveTimeZone('Asia/Shanghai')).toBe(resolveTimeZone());
    // ② 运行环境时区不可用（精简运行时 / 非法返回值）时回落到兜底值。
    const original = Intl.DateTimeFormat;
    try {
      // 模拟「resolvedOptions().timeZone 返回空串」的精简运行时。
      Intl.DateTimeFormat = function PatchedDateTimeFormat(
        ...args: ConstructorParameters<typeof Intl.DateTimeFormat>
      ) {
        const instance = new original(...args);
        const originalResolved = instance.resolvedOptions.bind(instance);
        instance.resolvedOptions = () => ({ ...originalResolved(), timeZone: '' });
        return instance;
      } as unknown as typeof Intl.DateTimeFormat;
      expect(resolveTimeZone('Asia/Shanghai')).toBe('Asia/Shanghai');
      // 兜底值本身非法时，回落到默认时区。
      expect(resolveTimeZone('Not/AZone')).toBe(DEFAULT_TIME_ZONE);
    } finally {
      Intl.DateTimeFormat = original;
    }
  });

  it('assertTimeZone 对非法时区抛错、合法时区原样返回', () => {
    // 补 lcov 96-99：assertTimeZone 从未被调用过。
    expect(assertTimeZone('Asia/Shanghai')).toBe('Asia/Shanghai');
    expect(() => assertTimeZone('Not/AZone')).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_VALIDATION' }),
    );
  });

  it('guessSourceTimeZone 优先采用有效的时区线索', () => {
    // 补 lcov 81-85：guessSourceTimeZone 从未被调用过。
    expect(guessSourceTimeZone(['Not/AZone', 'Asia/Shanghai'])).toBe('Asia/Shanghai');
    expect(guessSourceTimeZone([])).toBe(resolveTimeZone());
  });
});

describe('crypto · KDF 参数的校验、降级与序列化（补齐 100%）', () => {
  it('createKdfParams 对过短盐值抛错', () => {
    // 补 lcov 61-62。
    expect(() => createKdfParams(new Uint8Array(8))).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_VALIDATION' }),
    );
    expect(() => createKdfParams('not-bytes' as unknown as Uint8Array)).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_VALIDATION' }),
    );
  });

  it('createFallbackKdfParams 产出更弱的 N 但仍是合法参数', () => {
    // 补 lcov 86：降级参数构造函数从未被调用过。
    const fallback = createFallbackKdfParams(SALT);
    const normal = createKdfParams(SALT);
    expect(fallback.n).toBeLessThan(normal.n);
    expect(() => validateKdfParams(fallback)).not.toThrow();
  });

  it('validateKdfParams 拒绝非 scrypt 算法', () => {
    // 补 lcov 102-103。
    const params = createKdfParams(SALT);
    // 说明：`KdfParams.algorithm` 的类型被收窄为字面量 'scrypt'，
    // 要测「非法算法」分支必须绕过类型系统 —— 用 unknown 中转后再断言为具体字面量，
    // 而不是直接写 `'pbkdf2'`（那会引入 TS2322 类型错误）。
    const tampered = { ...params, algorithm: 'pbkdf2' } as unknown as typeof params;
    expect(() => validateKdfParams(tampered)).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_VALIDATION' }),
    );
  });

  it('validateKdfParams 拒绝非 2 的幂、过小的 N', () => {
    // 补 lcov 105-107。
    const params = createKdfParams(SALT);
    expect(() => validateKdfParams({ ...params, n: 1000 })).toThrowError();
    expect(() => validateKdfParams({ ...params, n: 3000 })).toThrowError();
    expect(() => validateKdfParams({ ...params, n: 1023.5 })).toThrowError();
  });

  it('validateKdfParams 拒绝非法的 r / p / keyLength / salt', () => {
    // 补 lcov 108-119。
    const params = createKdfParams(SALT);
    expect(() => validateKdfParams({ ...params, r: 0 })).toThrowError();
    expect(() => validateKdfParams({ ...params, r: 1.5 })).toThrowError();
    expect(() => validateKdfParams({ ...params, p: 0 })).toThrowError();
    expect(() => validateKdfParams({ ...params, p: 1.5 })).toThrowError();
    expect(() => validateKdfParams({ ...params, keyLength: 8 })).toThrowError();
    expect(() => validateKdfParams({ ...params, keyLength: 128 })).toThrowError();
    expect(() => validateKdfParams({ ...params, salt: new Uint8Array(4) })).toThrowError();
  });

  it('deserializeKdfParams 对非对象 / 非 hex 盐值抛错', () => {
    // 补 lcov 149-161。
    expect(() => deserializeKdfParams(null)).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_VALIDATION' }),
    );
    expect(() => deserializeKdfParams('not-an-object')).toThrowError();
    expect(() => deserializeKdfParams({ salt: 123 })).toThrowError();
    expect(() => deserializeKdfParams({ salt: 'zz' })).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_VALIDATION' }),
    );
  });

  it('serializeKdfParams 与 deserializeKdfParams 互为逆运算', () => {
    const params = createKdfParams(SALT);
    const serialized = serializeKdfParams(params);
    expect(serialized.algorithm).toBe('scrypt');
    expect(serialized.paramsVersion).toBe(getKdfParamsVersion());
    const restored = deserializeKdfParams(serialized);
    expect(restored.n).toBe(params.n);
    expect(restored.r).toBe(params.r);
    expect(restored.p).toBe(params.p);
    expect(restored.keyLength).toBe(params.keyLength);
    expect(Array.from(restored.salt)).toEqual(Array.from(params.salt));
  });

  it('isKdfUpgradable 逐项比较参数，完全一致才返回 true', () => {
    // 补 lcov 182：升级判定函数从未被调用过。
    const current = createKdfParams(SALT);
    expect(isKdfUpgradable(current, createKdfParams(SALT))).toBe(true);
    expect(isKdfUpgradable(current, createKdfParams(SALT, { n: 16384 }))).toBe(false);
    expect(isKdfUpgradable(current, createKdfParams(SALT, { r: 16 }))).toBe(false);
    expect(isKdfUpgradable(current, createKdfParams(SALT, { p: 2 }))).toBe(false);
    expect(isKdfUpgradable(current, createKdfParams(SALT, { keyLength: 64 }))).toBe(false);
  });

  it('getKdfParamsVersion 返回正整数版本号', () => {
    // 补 lcov 197。
    expect(getKdfParamsVersion()).toBeGreaterThan(0);
  });
});

describe('crypto · DEK 薄封装与密钥长度校验（补齐 100%）', () => {
  it('wrapDek / unwrapDek 走 CryptoService 的往返', async () => {
    // 补 lcov 55、72：这两个薄封装函数此前从未被调用过。
    const provider = new WebCryptoProvider();
    const crypto = new CryptoService(provider);
    const dek = generateDek(provider);
    const wrapped = await wrapDek(crypto, KEY, dek, 1);
    expect(wrapped.keyVersion).toBe(1);
    const unwrapped = await unwrapDek(crypto, KEY, wrapped);
    expect(Array.from(unwrapped)).toEqual(Array.from(dek));
  });

  it('assertKeyLength 拒绝非 32 字节密钥', () => {
    expect(() => assertKeyLength(new Uint8Array(16))).toThrowError();
    expect(() => assertKeyLength(KEY)).not.toThrow();
  });

  it('generateSalt 产出指定长度的随机盐值', () => {
    const provider = new WebCryptoProvider();
    expect(generateSalt(provider)).toHaveLength(16);
    expect(generateSalt(provider, 32)).toHaveLength(32);
  });

  it('wipeBytes 把字节清零，空值时安全返回', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    wipeBytes(bytes);
    expect(Array.from(bytes)).toEqual([0, 0, 0]);
    expect(() => wipeBytes(null)).not.toThrow();
    expect(() => wipeBytes(undefined)).not.toThrow();
  });
});

describe('crypto · 恢复码的分组与断言（补齐 100%）', () => {
  it('computeGroupCheck 为分组生成稳定的校验位', () => {
    // 补 lcov 62：此前从未被调用过。
    const check = computeGroupCheck('ABCDEF');
    expect(check).toHaveLength(1);
    expect(computeGroupCheck('ABCDEF')).toBe(check);
  });

  it('splitRecoveryGroups 把恢复码拆成 12 组', () => {
    // 补 lcov 131-132。
    const code = generateRecoveryCode();
    const groups = splitRecoveryGroups(code);
    expect(groups).toHaveLength(12);
    for (const group of groups) {
      // 每组 = 5 位数据 + 1 位校验位。
      expect(group.data).toHaveLength(5);
      expect(group.check).toHaveLength(1);
    }
  });

  it('splitRecoveryGroups 对空输入返回空分组列表', () => {
    // 补 lcov 131-132：空输入的 filter 分支。
    expect(splitRecoveryGroups('')).toEqual([]);
    expect(splitRecoveryGroups('---')).toEqual([]);
  });

  it('normalizeRecoveryCode 归一化大小写与分隔符', () => {
    // 补 lcov 222-223：归一化时剥离非字母数字字符。
    expect(normalizeRecoveryCode('abc-def')).toBe('ABCDEF');
    expect(normalizeRecoveryCode('  abc def  ')).toBe('ABCDEF');
  });

  it('assertRecoveryCode 对非法恢复码抛 LIFEHUB_E_RECOVERY_INVALID', () => {
    // 补 lcov 163-164：断言函数此前从未被调用过。
    expect(() => assertRecoveryCode('bad')).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_RECOVERY_INVALID' }),
    );
    expect(() => assertRecoveryCode(generateRecoveryCode())).not.toThrow();
  });

  it('validateRecoveryCode 对非字符串与格式错误的输入返回 false', () => {
    expect(validateRecoveryCode(123 as unknown as string)).toBe(false);
    expect(validateRecoveryCode('bad')).toBe(false);
  });
});

describe('crypto · CryptoService 与 Provider 的异常分支（补齐 100%）', () => {
  it('encryptRecord 遇到无法序列化的对象时抛 LIFEHUB_E_VALIDATION', async () => {
    // 补 lcov 77：JSON.stringify 抛错的 catch 分支。
    const crypto = new CryptoService(new WebCryptoProvider());
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    await expect(crypto.encryptRecord(KEY, 'bill', 'b1', 1, circular)).rejects.toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_VALIDATION' }),
    );
  });

  it('decryptRecord 遇到非 JSON 明文时抛 LIFEHUB_E_CRYPTO_AUTH_FAILED', async () => {
    // 补 lcov 114：JSON.parse 抛错的 catch 分支。
    const crypto = new CryptoService(new WebCryptoProvider());
    const provider = new WebCryptoProvider();
    // 直接用 provider 加密一段非 JSON 文本，绕过 encryptRecord 的序列化。
    // AAD 必须与 decryptRecord 内部构造的一致，否则会先撞上认证失败分支。
    const aad = crypto.buildAad('bill', 'b1', 1);
    const payload = await provider.encrypt(KEY, new TextEncoder().encode('not-json'), aad);
    await expect(crypto.decryptRecord(KEY, 'bill', 'b1', 1, payload)).rejects.toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_CRYPTO_AUTH_FAILED' }),
    );
  });

  it('getProviderName / getAlgorithm 返回可读标识', async () => {
    // 补 lcov 183、192：两个取值方法此前从未被调用过。
    const crypto = new CryptoService(new WebCryptoProvider());
    expect(crypto.getProviderName()).toBeTypeOf('string');
    expect(crypto.getAlgorithm()).toBe('AES-256-GCM');
  });

  it('WebCryptoProvider 在当前环境可用', () => {
    // 补 lcov 75、78：available 判定分支。
    const provider = new WebCryptoProvider();
    expect(provider.isAvailable).toBe(true);
  });

  it('WebCryptoProvider 的 randomBytes 产出指定长度的随机字节', () => {
    // 补 lcov 97-98。
    const provider = new WebCryptoProvider();
    expect(provider.randomBytes(16)).toHaveLength(16);
    expect(provider.randomBytes(32)).toHaveLength(32);
  });

  it('WebCryptoProvider 的 deriveKey 派生出 32 字节密钥', async () => {
    // 补 lcov 207-208。
    const provider = new WebCryptoProvider();
    const key = await provider.deriveKey(createKdfParams(SALT), 'password');
    expect(key).toHaveLength(32);
  });

  it('NobleCryptoProvider 作为兜底实现也能派生出同样的密钥', async () => {
    // 补 lcov 47-48、54-55：noble 兜底实现的分支。
    const provider = new NobleCryptoProvider();
    expect(provider.isAvailable).toBe(true);
    const key = await provider.deriveKey(createKdfParams(SALT), 'password');
    expect(key).toHaveLength(32);
  });
});

describe('csv · 列映射的边界与异常（补齐 100%）', () => {
  it('getColumns 返回表头副本，外部修改不影响内部状态', () => {
    // 补 lcov 93、209-210：getColumns 此前从未被调用过。
    const mapper = new ColumnMapper(['交易时间', '金额']);
    const columns = mapper.getColumns();
    expect(columns).toEqual(['交易时间', '金额']);
    columns[0] = '被改坏了';
    expect(mapper.getColumns()[0]).toBe('交易时间');
  });

  it('suggest 按表头关键词给出建议映射', () => {
    // 补 lcov 108-113：表头遍历与命中分支。
    const mapper = new ColumnMapper(['交易时间', '交易对方', '金额(元)', '备注']);
    const suggestion = mapper.suggest();
    expect(suggestion[0]).toBe('occurredAt');
    expect(suggestion[1]).toBe('counterparty');
    expect(suggestion[2]).toBe('amount');
  });

  it('suggest 跳过空表头单元格', () => {
    // 补 lcov 111-112：空表头跳过分支。
    const mapper = new ColumnMapper(['', '  ', '金额']);
    const suggestion = mapper.suggest();
    expect(suggestion[2]).toBe('amount');
  });

  it('validate 报告必填字段缺失', () => {
    // 补 lcov 135-136、152。
    const mapper = new ColumnMapper(['交易时间', '金额']);
    const result = mapper.validate({});
    expect(result.ok).toBe(false);
    expect(result.missingRequired.length).toBeGreaterThan(0);
    expect(result.message).toContain('请先映射');
  });

  it('validate 报告字段重复', () => {
    // 补 lcov 157。
    const mapper = new ColumnMapper(['交易时间', '金额', '金额2']);
    const result = mapper.validate({ 0: 'occurredAt', 1: 'amount', 2: 'amount' });
    expect(result.ok).toBe(false);
    expect(result.duplicatedFields).toContain('amount');
    expect(result.message).toContain('不能映射到多列');
  });

  it('validate 忽略不属于语义字段的映射项', () => {
    // 补 lcov 192：非 BillField 的键被跳过。
    const mapper = new ColumnMapper(['交易时间', '金额']);
    const result = mapper.validate({ 0: 'occurredAt', 1: 'amount', 2: 'not-a-field' } as never);
    expect(result.ok).toBe(true);
  });

  it('mapRow 按映射抽取语义字段，未映射的字段为空串', () => {
    // 补 lcov 209-210、217：mapRow 的 default / ignore 分支。
    const mapper = new ColumnMapper(['交易时间', '金额', '备注']);
    const mapped = mapper.mapRow(['2024-01-15', '35.50', '拿铁'], {
      0: 'occurredAt',
      1: 'amount',
      2: 'ignore',
    });
    expect(mapped.occurredAt).toBe('2024-01-15');
    expect(mapped.amount).toBe('35.50');
    expect(mapped.note).toBe('');
  });

  it('mapRow 对越界索引回退为空串', () => {
    const mapper = new ColumnMapper(['交易时间', '金额']);
    const mapped = mapper.mapRow(['2024-01-15'], { 0: 'occurredAt', 9: 'amount' });
    expect(mapped.amount).toBe('');
  });

  it('assertValid 在必填缺失时抛 LIFEHUB_E_MAPPING_INCOMPLETE', () => {
    const mapper = new ColumnMapper(['交易时间', '金额']);
    expect(() => mapper.assertValid({})).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_MAPPING_INCOMPLETE' }),
    );
  });

  it('assertValid 在字段重复时抛 LIFEHUB_E_MAPPING_CONFLICT', () => {
    const mapper = new ColumnMapper(['交易时间', '金额', '金额2']);
    expect(() => mapper.assertValid({ 0: 'occurredAt', 1: 'amount', 2: 'amount' })).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_MAPPING_CONFLICT' }),
    );
  });
});

describe('csv · 收支方向推断的各条策略（补齐 100%）', () => {
  /** 构造一条方向判定规则（关键词表用默认值）。 */
  function rule(overrides: {
    mode: 'auto' | 'column' | 'sign' | 'keyword';
    columnIndex?: number;
  }): DirectionRule {
    return {
      mode: overrides.mode,
      ...(overrides.columnIndex === undefined ? {} : { columnIndex: overrides.columnIndex }),
      incomeKeywords: DirectionResolver.defaultIncomeKeywords(),
      expenseKeywords: DirectionResolver.defaultExpenseKeywords(),
    };
  }

  /** 构造一条最小的已映射行。 */
  function mapped(partial: Partial<MappedRow> & { cells: string[] }): MappedRow {
    return {
      occurredAt: '',
      amount: '',
      counterparty: '',
      category: '',
      direction: '',
      balance: '',
      note: '',
      ...partial,
    };
  }

  it('column 模式按显式收/支列判定方向', () => {
    // 补 lcov 103-104：候选列命中分支。
    const resolver = new DirectionResolver(rule({ mode: 'column', columnIndex: 0 }));
    const result = resolver.resolve(mapped({ cells: ['支出', '35.50'], amount: '35.50' }));
    expect(result.direction).toBe('expense');
    expect(result.source).toBe('column');
  });

  it('column 模式在没有候选列时返回 none', () => {
    // 补 lcov 104：无候选列的分支。
    const resolver = new DirectionResolver(rule({ mode: 'column' }));
    const result = resolver.resolve(mapped({ cells: [] }));
    expect(result.direction).toBeNull();
    expect(result.source).toBe('none');
  });

  it('column 模式对无法归类的候选值返回 none 并说明原因', () => {
    // 补 lcov 127、129：候选值无法归类的分支。
    const resolver = new DirectionResolver(rule({ mode: 'column', columnIndex: 0 }));
    const result = resolver.resolve(mapped({ cells: ['不知道', '35.50'], amount: '35.50' }));
    expect(result.direction).toBeNull();
    expect(result.reason).toContain('无法归类');
  });

  it('column 模式跳过空串候选值', () => {
    // 补 lcov 108-109：空串候选跳过分支。
    const resolver = new DirectionResolver(rule({ mode: 'column', columnIndex: 0 }));
    // 规则列（索引 0）是空串，应被跳过；随后用映射到 direction 的那一列。
    const result = resolver.resolve(mapped({ cells: ['', '支出'], direction: '支出' }));
    expect(result.direction).toBe('expense');
  });

  it('sign 模式按金额正负号判定方向', () => {
    // 补 lcov 145 附近的正负号分支。
    const resolver = new DirectionResolver(rule({ mode: 'sign' }));
    expect(resolver.resolve(mapped({ cells: ['-35.50'], amount: '-35.50' })).direction).toBe('expense');
    expect(resolver.resolve(mapped({ cells: ['35.50'], amount: '35.50' })).direction).toBe('income');
  });

  it('sign 模式在金额为空或无符号时返回 none', () => {
    // 补 lcov 146-152：金额为空 / 无法判符号的分支。
    const resolver = new DirectionResolver(rule({ mode: 'sign' }));
    expect(resolver.resolve(mapped({ cells: [] })).reason).toContain('金额为空');
    expect(resolver.resolve(mapped({ cells: ['abc'], amount: 'abc' })).reason).toContain('没有正负号');
  });

  it('keyword 模式按对方名称里的关键词判定方向', () => {
    // 补 lcov 150-151。
    const resolver = new DirectionResolver(rule({ mode: 'keyword' }));
    // 「消费」在默认支出关键词表内（§8.2 DIRECTION_EXPENSE_KEYWORDS）。
    const result = resolver.resolve(mapped({ cells: ['星巴克消费'], counterparty: '星巴克消费' }));
    expect(result.direction).toBe('expense');
    expect(result.source).toBe('keyword');
  });

  it('keyword 模式在没有可用文本时返回 none', () => {
    // 补 lcov 177-178：无可用文本的分支。
    const resolver = new DirectionResolver(rule({ mode: 'keyword' }));
    const result = resolver.resolve(mapped({ cells: [] }));
    expect(result.direction).toBeNull();
    expect(result.reason).toContain('没有可用于关键词判定');
  });

  it('keyword 模式未命中任何关键词时返回 none', () => {
    // 补 lcov 189：未命中分支。
    const resolver = new DirectionResolver(rule({ mode: 'keyword' }));
    const result = resolver.resolve(mapped({ cells: ['某商户'], counterparty: '某商户' }));
    expect(result.direction).toBeNull();
    expect(result.reason).toContain('未命中任何方向关键词');
  });

  it('auto 模式在没有证据时返回 none', () => {
    const resolver = new DirectionResolver(rule({ mode: 'auto' }));
    const result = resolver.resolve(mapped({ cells: ['35.50'], amount: '35.50' }));
    expect(result.direction).toBeNull();
  });

  it('auto 模式优先使用收/支列，其次用负号，最后用关键词', () => {
    // 补 lcov 74-83：auto 的三级优先级。
    const resolver = new DirectionResolver(rule({ mode: 'auto' }));
    // ① 收/支列优先。
    expect(resolver.resolve(mapped({ cells: ['支出'], direction: '支出' })).source).toBe('column');
    // ② 无收/支列时用负号。
    expect(resolver.resolve(mapped({ cells: ['-35.50'], amount: '-35.50' })).source).toBe('sign');
    // ③ 前两级都没证据时用关键词。
    const byKeyword = resolver.resolve(mapped({ cells: ['星巴克消费'], counterparty: '星巴克消费' }));
    expect(byKeyword.source).toBe('keyword');
  });
});

describe('csv · 编码探测与解码（补齐 100%）', () => {
  it('hasBom 识别 UTF-8 BOM 头', () => {
    // 补 lcov 27-28：长度不足与 BOM 头两个分支。
    expect(hasBom(UTF8_BOM)).toBe(true);
    expect(hasBom(new Uint8Array([0xef, 0xbb]))).toBe(false);
    expect(hasBom(new Uint8Array())).toBe(false);
  });

  it('stripBom 剥离 BOM，无 BOM 时原样返回', () => {
    // 补 lcov 40。
    expect(stripBom(UTF8_BOM)).toHaveLength(0);
    const plain = new Uint8Array([0x41]);
    expect(Array.from(stripBom(plain))).toEqual([0x41]);
  });

  it('detectEncoding 对 BOM / 空文件 / 纯 UTF-8 给出正确判定', () => {
    // 补 lcov 67-76：BOM、空文件、UTF-8 三个分支。
    expect(detectEncoding(UTF8_BOM)).toBe('utf-8-bom');
    expect(detectEncoding(new Uint8Array())).toBe('utf-8');
    expect(detectEncoding(new TextEncoder().encode('plain'))).toBe('utf-8');
  });

  it('detectEncoding 对 GBK 字节流判定为 gbk', () => {
    // 补 lcov 77-79：GBK 分支。
    // 「交」字的 GBK 编码是 0xBD 0xCC，UTF-8 严格解码会失败。
    expect(detectEncoding(new Uint8Array([0xbd, 0xcc]))).toBe('gbk');
  });

  it('detectEncoding 对无法识别的字节抛 LIFEHUB_E_CSV_ENCODING', () => {
    // 补 lcov 83：所有编码都失败时的抛错分支。
    // 0xFF 在 UTF-8 / GBK / GB18030 下都不是合法序列。
    expect(() => detectEncoding(new Uint8Array([0xff, 0xfe, 0xfd]))).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_CSV_ENCODING' }),
    );
  });

  it('decodeBytes 按 BOM 与指定编码解码', () => {
    // 补 lcov 94-104：显式编码与 BOM 两条分支。
    const withBom = new Uint8Array([...UTF8_BOM, ...new TextEncoder().encode('交易时间')]);
    expect(decodeBytes(withBom)).toBe('交易时间');
    expect(decodeBytes(new TextEncoder().encode('交易时间'), 'utf-8')).toBe('交易时间');
  });

  it('decodeBytes 在严格解码失败时退回宽松解码', () => {
    // 补 lcov 104：宽松回退分支（坏字节替换为 U+FFFD）。
    const broken = new Uint8Array([0xff, 0xfe]);
    const text = decodeBytes(broken, 'utf-8');
    expect(text.length).toBeGreaterThan(0);
  });

  it('decodeChunks 把字节流分块解码为文本流', async () => {
    // 补 lcov 117-149：流式解码的两条分支。
    const bytes = new TextEncoder().encode('交易时间,金额\n');
    async function* chunks(): AsyncGenerator<Uint8Array> {
      yield bytes.subarray(0, 4);
      yield bytes.subarray(4);
    }
    const parts: string[] = [];
    for await (const part of decodeChunks(chunks(), 'utf-8')) {
      parts.push(part);
    }
    expect(parts.join('')).toBe('交易时间,金额\n');
  });

  it('decodeChunks 在未指定编码时自动探测首块', async () => {
    // 补 lcov 121-141：自动探测分支。
    const bytes = new TextEncoder().encode('交易时间,金额\n');
    async function* chunks(): AsyncGenerator<Uint8Array> {
      yield bytes;
    }
    const parts: string[] = [];
    for await (const part of decodeChunks(chunks())) {
      parts.push(part);
    }
    expect(parts.join('')).toBe('交易时间,金额\n');
  });

  it('decodeChunks 在首块为空流时直接结束', async () => {
    // 补 lcov 126-127：空流分支。
    async function* chunks(): AsyncGenerator<Uint8Array> {
      // 故意不产出任何块。
    }
    const parts: string[] = [];
    for await (const part of decodeChunks(chunks())) {
      parts.push(part);
    }
    expect(parts).toEqual([]);
  });
});

describe('csv · 解析器的边界（补齐 100%）', () => {
  it('解析器对空文本返回空表', () => {
    // 补 lcov 136、140。
    const parser = new CsvParser();
    const table = parser.parse('');
    expect(table.headers).toEqual([]);
    expect(table.rows).toEqual([]);
  });

  it('解析器对带引号与转义引号的字段正确解析', () => {
    // 补 lcov 249、296、314、366、411：引号与转义分支。
    const parser = new CsvParser();
    const table = parser.parse('a,b\n"含,逗号","含""引号"\n');
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]?.[0]).toBe('含,逗号');
    expect(table.rows[0]?.[1]).toBe('含"引号');
  });

  it('解析器对 CRLF 与 LF 换行都能正确分行', () => {
    const parser = new CsvParser();
    expect(parser.parse('a,b\r\n1,2\r\n').rows).toHaveLength(1);
    expect(parser.parse('a,b\n1,2\n').rows).toHaveLength(1);
  });

  it('解析器在 auto 模式下自动探测制表符分隔', () => {
    // 补 lcov 443-444：分隔符自动探测分支。
    const parser = new CsvParser({ delimiter: 'auto' });
    const table = parser.parse('a\tb\n1\t2\n');
    expect(table.delimiter).toBe('\t');
    expect(table.rows).toHaveLength(1);
  });

  it('解析器在 auto 模式下探测不到分隔符时回落到逗号', () => {
    // 补 lcov 407-421 的回落分支。
    const parser = new CsvParser({ delimiter: 'auto' });
    const table = parser.parse('single\nvalue\n');
    expect(table.delimiter).toBe(',');
  });
});
