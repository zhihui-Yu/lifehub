/**
 * 默认 7 大四字分类自动初始化、导入智能归类与跨卡内部转账识别单测。
 *
 * 覆盖工单：T-Category-Defaults-1 & T-Transfer-Dedupe-1。
 */
import { describe, expect, it } from 'vitest';
import {
  CsvParser,
  ImportService,
  SYSTEM_CATEGORIES,
  USER_CATEGORY_MEMORY_SIGNATURE,
  USER_CATEGORY_MEMORY_TEMPLATE_ID,
  createDefaultDirectionRule,
  detectTransferPairs,
  extractBillItemKey,
  extractBillItemLabel,
  inferSystemCategoryName,
  isInternalTransferBill,
  utf8Encode,
  type Bill,
  type Category,
} from '../../src';
import { createUnlockedRuntime } from '../helpers/runtime';

/** 构造测试账单。 */
function makeBill(overrides: Partial<Bill> & { id: string }): Bill {
  return {
    amountMinor: 100000,
    currency: 'CNY',
    direction: 'expense',
    occurredAt: '2025-03-10T10:00:00.000Z',
    localDate: '2025-03-10',
    sourceTimeZone: 'Asia/Shanghai',
    counterparty: '测试商户',
    categoryId: null,
    note: '',
    sourceFileId: 'batch-a',
    sourceRowIndex: 0,
    createdAt: '2025-03-10T10:00:00.000Z',
    updatedAt: '2025-03-10T10:00:00.000Z',
    version: 1,
    deviceId: 'dev-1',
    ...overrides,
  };
}

describe('T-Category-Defaults-1 · 7 大标准四字分类初始化与导入智能归类', () => {
  it('SYSTEM_CATEGORIES 包含全部 7 大标准四字分类与内部转账分类', () => {
    const names = SYSTEM_CATEGORIES.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining([
        '餐饮美食',
        '交通出行',
        '购物消费',
        '居家住房',
        '医疗健康',
        '工资薪水',
        '投资理财',
        '内部转账',
      ]),
    );
  });

  it('CategoryRepository.ensureSystemCategories 幂等初始化并平滑升级旧版二字分类（保留原 id）', async () => {
    const rt = await createUnlockedRuntime();

    // 先写入一条旧版二字系统分类「餐饮」（固定 id: 'legacy-food-id'）。
    const legacyFood: Category = {
      id: 'legacy-food-id',
      name: '餐饮',
      kind: 'expense',
      parentId: null,
      color: '#DC2626',
      icon: 'restaurant',
      isSystem: true,
      sortOrder: 100,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      version: 1,
      deviceId: 'seed',
    };
    await rt.categories.save(legacyFood);

    const ensured1 = await rt.categories.ensureSystemCategories(rt.clock, 'dev-1');
    const foodCat = ensured1.find((c) => c.name === '餐饮美食');
    expect(foodCat).toBeDefined();
    // 原 id 必须保留，确保历史账单关联不丢失
    expect(foodCat?.id).toBe('legacy-food-id');

    // 7 大标准分类与内部转账全部落库
    for (const requiredName of [
      '餐饮美食',
      '交通出行',
      '购物消费',
      '居家住房',
      '医疗健康',
      '工资薪水',
      '投资理财',
      '内部转账',
    ]) {
      expect(ensured1.some((c) => c.name === requiredName)).toBe(true);
    }

    // 再次调用幂等，不会重复创建
    const ensured2 = await rt.categories.ensureSystemCategories(rt.clock, 'dev-1');
    expect(ensured2.length).toBe(ensured1.length);
  });

  it('inferSystemCategoryName 准确识别 7 大分类与内部转账关键词', () => {
    expect(
      inferSystemCategoryName({ counterparty: '星巴克咖啡', note: '拿铁', direction: 'expense' }),
    ).toBe('餐饮美食');
    expect(
      inferSystemCategoryName({ counterparty: '滴滴出行', note: '快车', direction: 'expense' }),
    ).toBe('交通出行');
    expect(
      inferSystemCategoryName({ counterparty: '京东商城', note: '日用品', direction: 'expense' }),
    ).toBe('购物消费');
    expect(
      inferSystemCategoryName({ counterparty: '国网电力', note: '电费缴纳', direction: 'expense' }),
    ).toBe('居家住房');
    expect(
      inferSystemCategoryName({ counterparty: '协和医院', note: '门诊挂号', direction: 'expense' }),
    ).toBe('医疗健康');
    expect(
      inferSystemCategoryName({ counterparty: '某科技有限公司', note: '代发工资', direction: 'income' }),
    ).toBe('工资薪水');
    expect(
      inferSystemCategoryName({ counterparty: '天天基金', note: '基金赎回收益', direction: 'income' }),
    ).toBe('投资理财');
    expect(
      inferSystemCategoryName({ counterparty: '招商银行', note: '他行转入', direction: 'income' }),
    ).toBe('内部转账');
    expect(
      inferSystemCategoryName({
        counterparty: '天弘基金管理有限公司',
        note: '余额宝-单次转入',
        direction: 'expense',
        rawCategory: '投资理财',
      }),
    ).toBe('内部转账');
    expect(
      inferSystemCategoryName({
        counterparty: '天弘基金管理有限公司',
        note: '余额宝-2026.10.30-收益发放',
        direction: 'income',
        rawCategory: '投资理财',
      }),
    ).toBe('投资理财');
  });

  it('ImportService.run 传入 categories 仓储时自动完成系统分类初始化与智能归类', async () => {
    const rt = await createUnlockedRuntime();
    const importer = new ImportService({
      provider: rt.provider,
      parser: new CsvParser(),
      templates: rt.templates,
      batches: rt.batches,
      bills: rt.bills,
      categories: rt.categories,
      audit: rt.audit,
      clock: rt.clock,
      deviceId: 'test-device',
    });

    const csvText = [
      '交易时间,交易对方,商品说明,收/支,金额(元)',
      '2025-03-10 08:30:00,瑞幸咖啡,生椰拿铁,支出,19.90',
      '2025-03-10 09:15:00,滴滴出行,打车上班,支出,28.00',
      '2025-03-10 12:00:00,跨行转入,本人账户互转,收入,5000.00',
      '2025-03-10 18:00:00,科技公司,3月代发工资,收入,18000.00',
    ].join('\n');

    const source = {
      fileName: 'statement.csv',
      sizeBytes: csvText.length,
      bytes: utf8Encode(csvText),
    };

    const plan = await importer.plan(source);
    const summary = await importer.run(source, plan.suggestedMapping, {});
    expect(summary.rowImported).toBe(4);

    const categories = await rt.categories.list();
    const catById = new Map(categories.map((c) => [c.id, c.name]));
    const bills = await rt.bills.list();

    const coffeeBill = bills.find((b) => b.counterparty === '瑞幸咖啡');
    const taxiBill = bills.find((b) => b.counterparty === '滴滴出行');
    const transferBill = bills.find((b) => b.counterparty === '跨行转入');
    const salaryBill = bills.find((b) => b.counterparty === '科技公司');

    expect(catById.get(coffeeBill?.categoryId ?? '')).toBe('餐饮美食');
    expect(catById.get(taxiBill?.categoryId ?? '')).toBe('交通出行');
    expect(catById.get(transferBill?.categoryId ?? '')).toBe('内部转账');
    expect(catById.get(salaryBill?.categoryId ?? '')).toBe('工资薪水');
  });
});

describe('T-Transfer-Dedupe-1 · 内部转账识别与跨卡配对检测', () => {
  const transferCat: Category = {
    id: 'cat-transfer',
    name: '内部转账',
    kind: 'both',
    parentId: null,
    color: '#6366F1',
    icon: 'transfer',
    isSystem: true,
    sortOrder: 800,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    version: 1,
    deviceId: 'dev-1',
  };
  const foodCat: Category = {
    id: 'cat-food',
    name: '餐饮美食',
    kind: 'expense',
    parentId: null,
    color: '#DC2626',
    icon: 'restaurant',
    isSystem: true,
    sortOrder: 100,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    version: 1,
    deviceId: 'dev-1',
  };
  const categoryMap = new Map<string, Category>([
    [transferCat.id, transferCat],
    [foodCat.id, foodCat],
  ]);

  it('isInternalTransferBill 识别内部转账分类与强特征转账词，并尊重用户显式常规分类覆盖', () => {
    // 1. 归入「内部转账」分类的账单判定为 true
    const byCat = makeBill({ id: 'b-1', counterparty: '张三', categoryId: 'cat-transfer' });
    expect(isInternalTransferBill(byCat, categoryMap)).toBe(true);

    // 2. 未分类但命中「他行转入 / 信用卡还款 / 朝朝宝」判定为 true
    const byKeyword = makeBill({
      id: 'b-2',
      direction: 'income',
      counterparty: '招商银行',
      note: '手机银行他行转入',
      categoryId: null,
    });
    expect(isInternalTransferBill(byKeyword, categoryMap)).toBe(true);

    // 3. 即便备注含转账词，但用户已显式归为「餐饮美食」，尊重用户选择返回 false
    const overridden = makeBill({
      id: 'b-3',
      counterparty: '朝朝宝茶餐厅',
      note: '晚餐',
      categoryId: 'cat-food',
    });
    expect(isInternalTransferBill(overridden, categoryMap)).toBe(false);
  });

  it('detectTransferPairs 准确配对跨银行卡同日（或跨日 1 天内）同金额的一支一收流水', () => {
    const cardAOut = makeBill({
      id: 'exp-card-a',
      direction: 'expense',
      amountMinor: 500000,
      localDate: '2025-03-10',
      counterparty: '王小明（尾号1234）',
      note: '手机银行跨行转出',
      sourceFileId: 'batch-icbc',
    });
    const cardBIn = makeBill({
      id: 'inc-card-b',
      direction: 'income',
      amountMinor: 500000,
      localDate: '2025-03-10',
      counterparty: '王小明',
      note: '他行转入',
      sourceFileId: 'batch-cmb',
    });
    const normalCoffee = makeBill({
      id: 'exp-coffee',
      direction: 'expense',
      amountMinor: 3500,
      localDate: '2025-03-10',
      counterparty: '星巴克',
      sourceFileId: 'batch-cmb',
    });

    const pairs = detectTransferPairs([cardAOut, cardBIn, normalCoffee], categoryMap);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.expenseBill.id).toBe('exp-card-a');
    expect(pairs[0]?.incomeBill.id).toBe('inc-card-b');
    expect(pairs[0]?.amountMinor).toBe(500000);

    // 当两笔账单都已归入「内部转账」分类后，不再重复出现在待确认配对列表中
    const markedPairs = detectTransferPairs(
      [
        { ...cardAOut, categoryId: 'cat-transfer' },
        { ...cardBIn, categoryId: 'cat-transfer' },
      ],
      categoryMap,
    );
    expect(markedPairs).toHaveLength(0);
  });

  it('T-Category-Memory-1 · extractBillItemKey 归一化相同项标识，且 ImportService.run 基于历史相同项记忆与用户分类记忆模板自动归类后续导入账单', async () => {
    // 1. 验证相同项提取优先级：优先有效交易对方，退化取备注，忽略占位符
    expect(extractBillItemKey({ counterparty: '  某某小众独立咖啡馆 ', note: '美式' })).toBe(
      '某某小众独立咖啡馆',
    );
    expect(extractBillItemLabel({ counterparty: '  某某小众独立咖啡馆 ', note: '美式' })).toBe(
      '某某小众独立咖啡馆',
    );
    expect(extractBillItemKey({ counterparty: '-', note: '  园区物业费2026  ' })).toBe(
      '园区物业费2026',
    );
    expect(extractBillItemKey({ counterparty: '—', note: '/' })).toBe('');

    const rt = await createUnlockedRuntime();
    const ensuredCats = await rt.categories.ensureSystemCategories(rt.clock, 'test-device');
    const foodCat = ensuredCats.find((c) => c.name === '餐饮美食');
    const homeCat = ensuredCats.find((c) => c.name === '居家住房');
    expect(foodCat).toBeDefined();
    expect(homeCat).toBeDefined();
    if (!foodCat || !homeCat) {
      throw new Error('系统预置分类缺失');
    }

    // 2. 模拟历史账单中用户已将不含内置关键词的「某某小众独立咖啡馆」手动归入「餐饮美食」
    await rt.bills.put(
      makeBill({
        id: 'hist-niche-coffee',
        localDate: '2025-03-01',
        occurredAt: '2025-03-01T09:00:00.000Z',
        counterparty: '某某小众独立咖啡馆',
        note: '手冲单品',
        categoryId: foodCat.id,
        updatedAt: '2025-03-05T10:00:00.000Z',
      }),
    );

    // 3. 模拟用户在分类记忆规则模板（sys-user-category-memory）中记住了「张师傅开锁修锁 -> 居家住房」
    await rt.templates.save({
      id: USER_CATEGORY_MEMORY_TEMPLATE_ID,
      name: '用户分类记忆规则',
      fileSignature: USER_CATEGORY_MEMORY_SIGNATURE,
      columnMapping: {},
      directionRule: createDefaultDirectionRule('auto'),
      categoryRules: [
        {
          id: 'mem-张师傅开锁修锁',
          priority: 1000,
          matchType: 'exact',
          pattern: '张师傅开锁修锁',
          categoryId: homeCat.id,
        },
      ],
      dateFormatHints: [],
      createdAt: '2025-03-05T10:00:00.000Z',
      updatedAt: '2025-03-05T10:00:00.000Z',
      version: 1,
      deviceId: 'test-device',
    });

    const importer = new ImportService({
      provider: rt.provider,
      parser: new CsvParser(),
      templates: rt.templates,
      batches: rt.batches,
      bills: rt.bills,
      categories: rt.categories,
      audit: rt.audit,
      clock: rt.clock,
      deviceId: 'test-device',
    });

    // 4. 导入新账单文件：两条交易对方均不含系统预置关键词，但分别命中历史相同项记忆与用户分类记忆模板
    const csvText = [
      '交易时间,交易对方,商品说明,收/支,金额(元)',
      '2025-03-12 10:15:00,某某小众独立咖啡馆,Dirty特调,支出,32.00',
      '2025-03-12 16:40:00,张师傅开锁修锁,上门换锁芯,支出,120.00',
    ].join('\n');

    const source = {
      fileName: 'march-second-half.csv',
      sizeBytes: csvText.length,
      bytes: utf8Encode(csvText),
    };

    const plan = await importer.plan(source);
    const summary = await importer.run(source, plan.suggestedMapping, {});
    expect(summary.rowImported).toBe(2);

    const allBills = await rt.bills.list();
    const newCoffeeBill = allBills.find(
      (b) => b.counterparty === '某某小众独立咖啡馆' && b.localDate === '2025-03-12',
    );
    const newLockBill = allBills.find((b) => b.counterparty === '张师傅开锁修锁');

    expect(newCoffeeBill?.categoryId).toBe(foodCat.id);
    expect(newLockBill?.categoryId).toBe(homeCat.id);
  });
});
