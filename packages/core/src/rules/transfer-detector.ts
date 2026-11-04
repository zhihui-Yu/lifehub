/**
 * 跨卡内部转账识别、配对检测与内置智能分类推断。
 *
 * 架构位置：core 包「规则」层。
 *
 * 说明：
 * 1. 识别「跨行转入 / 他行转入 / 行内转账 / 本人同名互转 / 信用卡还款 / 零钱提现充值 / 活期理财赎回」
 *    等不产生真实净资产增减的内部资金流动，默认排除在收支统计之外；
 * 2. 在多张银行卡/多渠道账单导入后，自动检测「同日（或跨日 1 天内）+ 同金额 + 一支一收」的跨卡转账配对；
 * 3. 提供无用户自定义规则时的内置语义分类推断，自动归入 7 大标准四字分类及辅助系统分类。
 */
import type { Bill, Direction } from '../models/bill';
import type { Category } from '../models/category';
import { diffDays } from '../time/datetime';

/** 跨卡/跨渠道内部转账配对结果。 */
export interface TransferPair {
  /** 转出方（支出）账单。 */
  expenseBill: Bill;
  /** 转入方（收入）账单。 */
  incomeBill: Bill;
  /** 转账金额（整数分）。 */
  amountMinor: number;
  /** 发生日期（以支出方或较早一方为准，YYYY-MM-DD）。 */
  localDate: string;
}

/** 强特征内部转账/倒卡/信用卡还款/零钱提现/活期互转关键词。 */
const INTERNAL_TRANSFER_KEYWORDS: readonly string[] = [
  '跨行转入',
  '他行转入',
  '行内转入',
  '转账存入',
  '手机银行转入',
  '超级网银',
  '网银转入',
  '网银转账',
  '本人账户',
  '同名转账',
  '账户互转',
  '内部转账',
  '跨行转出',
  '他行转出',
  '行内转出',
  '信用卡还款',
  '预约还款',
  '自动还款',
  '约定还款',
  '零钱提现',
  '提现到银行卡',
  '零钱充值',
  '转入零钱通',
  '零钱通转出',
  '零钱通转入',
  '余额宝转出',
  '余额宝转入',
  '转入余额宝',
  '余额宝-单次转入',
  '余额宝-自动转入',
  '余额宝-转入',
  '余额宝-转出',
  '余额宝提现',
  '朝朝宝',
  '天天宝',
  '活期宝',
  '活期转',
  '银证转账',
  '证券转银行',
  '银行转证券',
  '证转银',
  '银转证',
  '银联转账',
  '云闪付转账',
  '跨行代付',
  '本金划转',
  '倒卡',
  '内转',
];

/** 配对检测时的弱转账特征词（当同批次内出现同金额一收一支时辅助判定）。 */
const PAIR_TRANSFER_HINTS: readonly string[] = [
  '转账',
  '转入',
  '转出',
  '跨行',
  '他行',
  '行内',
  '还款',
  '提现',
  '充值',
  '网银',
  '银行',
  '尾号',
  '储蓄卡',
  '信用卡',
  '卡',
  '汇款',
  '划转',
];

/**
 * 判断指定分类是否属于「内部转账」系统分类。
 *
 * 说明：通过分类图标标识（`transfer` / `swap_horiz`）或分类名称（含 `转账`）判定。
 *
 * @param category 分类实体（可为 undefined）
 * @returns 属于内部转账分类返回 true
 * @throws 无；纯函数不抛出异常
 */
export function isTransferCategory(category: Category | undefined): boolean {
  if (!category) {
    return false;
  }
  const icon = (category.icon ?? '').trim().toLowerCase();
  const name = (category.name ?? '').trim();
  return icon === 'transfer' || icon === 'swap_horiz' || name === '内部转账' || name.includes('转账');
}

/**
 * 判断一条账单是否为「内部转账 / 本人多卡互转 / 还款提现」流水。
 *
 * 说明：
 * 1. 若账单已关联分类且在 `categoryMap` 中可查到：
 *    - 若该分类为「内部转账」，直接返回 `true`；
 *    - 若该分类为其他常规收支分类（如用户手动改为「餐饮美食」「工资薪水」），尊重用户显式分类并返回 `false`；
 * 2. 若账单未分类（`categoryId === null`），则检查 `counterparty` 与 `note` 是否命中强特征内部转账关键词。
 *
 * @param bill 待判定的账单实体
 * @param categoryMap 分类 ID 到分类实体的只读映射表（可选）
 * @returns 属于内部转账返回 true，否则返回 false
 * @throws 无；纯函数不抛出异常
 */
export function isInternalTransferBill(
  bill: Bill,
  categoryMap?: ReadonlyMap<string, Category>,
): boolean {
  if (bill.categoryId && categoryMap) {
    const category = categoryMap.get(bill.categoryId);
    if (category) {
      return isTransferCategory(category);
    }
  }

  const combined = `${bill.counterparty} ${bill.note}`.toLowerCase();
  for (const kw of INTERNAL_TRANSFER_KEYWORDS) {
    if (combined.includes(kw.toLowerCase())) {
      return true;
    }
  }
  if (combined.includes('信用卡') && combined.includes('还款')) {
    return true;
  }
  if (
    (combined.includes('余额宝') || combined.includes('零钱通')) &&
    (combined.includes('转入') || combined.includes('转出') || combined.includes('提现'))
  ) {
    return true;
  }
  return false;
}

/**
 * 在账单列表中自动检测「跨卡 / 跨文件同金额一收一支」的疑似内部转账配对。
 *
 * 说明：
 * 扫描尚未全部归入「内部转账」分类的账单，找出同时满足以下条件的 `(expenseBill, incomeBill)` 配对：
 * 1. 一笔为 `expense`（转出），另一笔为 `income`（转入）；
 * 2. 两者 `amountMinor` 完全相等且大于 0，币种相同；
 * 3. 发生日期 `localDate` 相同或相差不超过 1 天（兼容跨行次日到账）；
 * 4. 来自不同导入文件（`sourceFileId` 不同），或至少一方包含转账/银行卡特征词；
 * 5. 每笔账单最多参与一次配对（优先匹配同日账单）。
 *
 * @param bills 待检测的账单列表
 * @param categoryMap 分类 ID 到分类实体的只读映射表（可选）
 * @returns 检测到的跨卡转账配对列表
 * @throws 无；纯函数不抛出异常
 */
export function detectTransferPairs(
  bills: readonly Bill[],
  categoryMap?: ReadonlyMap<string, Category>,
): TransferPair[] {
  const expenses: Bill[] = [];
  const incomes: Bill[] = [];

  for (const bill of bills) {
    if (bill.amountMinor <= 0) {
      continue;
    }
    // 若用户已显式将账单归入某个非转账的常规分类，则不参与疑似转账配对打扰。
    if (bill.categoryId && categoryMap) {
      const cat = categoryMap.get(bill.categoryId);
      if (cat && !isTransferCategory(cat)) {
        continue;
      }
    }
    if (bill.direction === 'expense') {
      expenses.push(bill);
    } else if (bill.direction === 'income') {
      incomes.push(bill);
    }
  }

  const usedIncomeIds = new Set<string>();
  const pairs: TransferPair[] = [];

  for (const exp of expenses) {
    let bestIncome: Bill | null = null;
    let bestDayDiff = 999;

    for (const inc of incomes) {
      if (usedIncomeIds.has(inc.id) || inc.id === exp.id) {
        continue;
      }
      if (inc.amountMinor !== exp.amountMinor || inc.currency !== exp.currency) {
        continue;
      }

      let dayDiff = 999;
      try {
        dayDiff = Math.abs(diffDays(exp.localDate, inc.localDate));
      } catch {
        dayDiff = exp.localDate === inc.localDate ? 0 : 999;
      }
      if (dayDiff > 1) {
        continue;
      }

      // 如果两笔账单都已经归入「内部转账」分类，则无需再次作为待确认配对提示。
      const expIsTransferCat = Boolean(
        exp.categoryId && categoryMap && isTransferCategory(categoryMap.get(exp.categoryId)),
      );
      const incIsTransferCat = Boolean(
        inc.categoryId && categoryMap && isTransferCategory(categoryMap.get(inc.categoryId)),
      );
      if (expIsTransferCat && incIsTransferCat) {
        continue;
      }

      const crossFile = exp.sourceFileId !== inc.sourceFileId;
      const text = `${exp.counterparty} ${exp.note} ${inc.counterparty} ${inc.note}`.toLowerCase();
      const hasTransferHint = PAIR_TRANSFER_HINTS.some((kw) => text.includes(kw.toLowerCase()));

      if (!crossFile && !hasTransferHint) {
        continue;
      }

      if (dayDiff < bestDayDiff) {
        bestDayDiff = dayDiff;
        bestIncome = inc;
        if (dayDiff === 0) {
          break;
        }
      }
    }

    if (bestIncome) {
      usedIncomeIds.add(bestIncome.id);
      pairs.push({
        expenseBill: exp,
        incomeBill: bestIncome,
        amountMinor: exp.amountMinor,
        localDate: exp.localDate <= bestIncome.localDate ? exp.localDate : bestIncome.localDate,
      });
    }
  }

  return pairs;
}

/** 内置智能分类推断入参。 */
export interface CategoryInferenceInput {
  /** 交易对方。 */
  counterparty: string;
  /** 备注或商品说明。 */
  note: string;
  /** 收支方向。 */
  direction: Direction;
  /** 原始文件里的「分类/类型」单元格文本（可选）。 */
  rawCategory?: string;
}

/**
 * 根据账单交易对方、商品备注、收支方向与原始分类文本推断系统标准分类名称。
 *
 * 说明：
 * 当用户未配置自定义 `CategoryRule` 或未命中时，作为导入阶段的智能兜底规则，
 * 将账单自动归入 7 大标准四字分类（餐饮美食、交通出行、购物消费、居家住房、医疗健康、工资薪水、投资理财）
 * 或内部转账、娱乐休闲、教育培训、通讯话费、奖金补贴。
 *
 * @param input 账单特征字段
 * @returns 命中的系统分类标准名称；无法推断时返回 null
 * @throws 无；纯函数不抛出异常
 */
export function inferSystemCategoryName(input: CategoryInferenceInput): string | null {
  const combined = `${input.counterparty} ${input.note} ${input.rawCategory ?? ''}`.toLowerCase();
  if (!combined.trim()) {
    return null;
  }

  // 1. 优先识别内部转账 / 本人互转 / 信用卡还款 / 提现充值
  for (const kw of INTERNAL_TRANSFER_KEYWORDS) {
    if (combined.includes(kw.toLowerCase())) {
      return '内部转账';
    }
  }
  if (combined.includes('信用卡') && combined.includes('还款')) {
    return '内部转账';
  }
  if (
    (combined.includes('余额宝') || combined.includes('零钱通')) &&
    (combined.includes('转入') || combined.includes('转出') || combined.includes('提现'))
  ) {
    return '内部转账';
  }

  // 1.5 若原始账单分类已明确标注为「投资理财」（如支付宝 CSV），直接归入「投资理财」，
  // 防止基金名称中含有「医疗」「消费」「传媒」「科技」等行业词时被误归入医疗健康或购物消费。
  if ((input.rawCategory ?? '').includes('投资理财')) {
    return '投资理财';
  }

  // 2. 收入方向优先匹配工资薪水、奖金补贴、投资理财
  if (input.direction === 'income') {
    if (
      /工资|薪资|薪水|代发|月薪|年终奖|绩效|薪酬/.test(combined)
    ) {
      return '工资薪水';
    }
    if (
      /奖金|补贴|津贴|报销|红包|礼金|兼职|稿费|劳务/.test(combined)
    ) {
      return '奖金补贴';
    }
    if (
      /理财|基金|分红|利息|结息|收益|赎回|国债|逆回购|证券|股票|定投/.test(combined)
    ) {
      return '投资理财';
    }
  }

  // 3. 7 大标准分类及常用支出分类关键词匹配
  if (
    /餐饮|美食|美团|饿了么|星巴克|瑞幸|麦当劳|肯德基|必胜客|pizzahut|喜茶|奈雪|霸王茶姬|海底捞|咖啡|奶茶|餐厅|饭店|食堂|小吃|烧烤|火锅|汉堡|披萨|猪脚饭|烘焙|蛋糕|面包|早餐|午餐|晚餐|外卖|茶饮|面馆|料理/.test(
      combined,
    )
  ) {
    return '餐饮美食';
  }

  if (
    /交通|出行|滴滴|打车|高德打车|花小猪|曹操|地铁|公交|一卡通|乘车码|先乘后付|12306|铁路|火车|高铁|机票|航空|加油|中石化|中石油|停车|高速|etc|通行费|单车|哈啰|出租车/.test(
      combined,
    )
  ) {
    return '交通出行';
  }

  if (
    /医疗|健康|医院|药房|大药房|药店|诊所|门诊|挂号|医保|体检|牙科|眼科|疫苗|卫生院/.test(
      combined,
    )
  ) {
    return '医疗健康';
  }

  if (
    /居家|住房|居住|房租|租房|租金|物业|水费|电费|燃气|煤气|供暖|宽带|电网|自来水|家政|保洁|维修|宜家|房贷/.test(
      combined,
    )
  ) {
    return '居家住房';
  }

  if (
    /通讯|话费|中国移动|中国联通|中国电信|流量|充值话费|手机充值|通信/.test(combined)
  ) {
    return '通讯话费';
  }

  if (
    /教育|培训|学费|课程|书店|图书|驾校|考试|报名费|网课|得到|学杂费/.test(combined)
  ) {
    return '教育培训';
  }

  if (
    /娱乐|休闲|电影|影城|猫眼|淘票票|游戏|steam|健身|游泳|球馆|ktv|演出|门票|景点|旅游|酒店|民宿|携程|去哪儿|飞猪|爱奇艺|腾讯视频|优酷|哔哩哔哩|会员/.test(
      combined,
    )
  ) {
    return '娱乐休闲';
  }

  if (
    /投资|理财|基金|申购|定投|证券|股票|黄金|债券/.test(combined)
  ) {
    return '投资理财';
  }

  if (
    /工资|薪资|薪水|代发/.test(combined)
  ) {
    return '工资薪水';
  }

  if (
    /购物|消费|淘宝|天猫|京东|拼多多|唯品会|抖音电商|小红书|超市|便利店|沃尔玛|山姆|盒马|永辉|大润发|全家|罗森|7-11|百货|商场|服饰|服装|优衣库|迪卡侬|数码|apple|苹果|小米|华为|日用|商贸|百货|商户消费/.test(
      combined,
    )
  ) {
    return '购物消费';
  }

  return null;
}
