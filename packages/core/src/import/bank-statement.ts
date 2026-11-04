/**
 * 银行流水文本解析器。
 *
 * 架构位置：core 包「导入」模块，服务于 A-25（多格式导入）与 A-21（跨来源去重）。
 *
 * 背景：兴业银行等导出的 PDF 经文本层抽取后，每行是独立的文本片段，
 * 一笔交易会被拆成「日期行 + 时间戳/金额行 + 交易用途/对方/订单号若干行」，
 * 且每页重复出现表头与页脚噪声。本模块把这些碎片重新拼回规整二维表，
 * 列名使用与微信 / CSV 同源的语义词（交易时间 / 金额 / 收支方向 / 交易用途），
 * 这样下游的列头映射与方向推断无需为银行特判。
 *
 * 说明：本解析器是**纯函数**，不依赖任何 DOM / 网络，可在 Node 与浏览器一致运行，
 * 也便于用真实 PDF 文本 fixture 做单测（系统设计 §1.2「零 DOM 依赖」）。
 */
import type { RawTable } from './raw-table';

/** 单笔交易的解析暂存结构。 */
interface PendingRecord {
  /** 交易日期 'YYYY-MM-DD'。 */
  date: string;
  /** 时间戳 'HH:MM:SS'。 */
  time: string;
  /** 摘要（如 快捷支付）。 */
  summary: string;
  /** 收 / 支原始标识。 */
  sign: '支' | '收';
  /** 带符号的金额文本（如 '-6,000.00'）。 */
  amount: string;
  /** 交易用途 / 对方等后续碎片的原始行。 */
  usageLines: string[];
  /** 多行用途拼接分隔符（兴业银行默认空格 ' '，建设银行跨行对方户名无缝拼接 ''）。 */
  joinSeparator?: string;
  /** 是否已被主行填充；仅有日期行但未见到主行的暂存不视为有效交易。 */
  realized: boolean;
}

/** 交易日期行：纯 'YYYY-MM-DD'，不含时间。 */
const DATE_LINE = /^\d{4}-\d{2}-\d{2}$/;

/** 单行带日期前缀的交易主行：'YYYY-MM-DD HH:MM:SS 记账日期(8位) ...'。 */
const DATE_PREFIXED_MAIN_LINE = /^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2}:\d{2}\s+\d{8}\s+.*)$/;

/** 交易主行（兴业银行等）：'HH:MM:SS 记账日期(8位) 摘要 支/收 带符号金额 余额(掩码) [用途]'。 */
const MAIN_LINE =
  /^(\d{1,2}:\d{2}:\d{2})\s+(\d{8})\s+(\S+)\s+(支|收)\s+([-+]?[\d,]+\.\d{2})\s+(\S+)(?:\s+(.*))?$/;

/** 交易主行（中国建设银行等）：'序号 摘要 交易日期(8位) 带符号交易金额 账户余额 [交易地点/附言] [对方账号与户名]'。 */
const CCB_MAIN_LINE =
  /^(\d+)\s+(\S+)\s+(\d{8})\s+([-+]?[\d,]+\.\d{2})\s+([\d,]+\.\d{2})(?:\s+(\S+))?(?:\s+(.*))?$/;

/** 交易主行（中国银行等）：'YYYY-MM-DD HH:MM:SS 币别 带符号金额 余额 交易名称 [网点名称/附言/对方账户名]'。 */
const BOC_MAIN_LINE =
  /^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2}:\d{2})\s+\S+\s+([-+]?[\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+(\S+)(?:\s+(.*))?$/;

/** 银行 PDF 文本里的噪声行（表头英文、页脚、说明等），应从「交易用途」里剔除。 */
const NOISE_PATTERNS: readonly RegExp[] = [
  /^兴业银行/,
  /^中国建设银行/,
  /^中国银行/,
  /^(?:交易区间|借记卡号|借方发生数|贷方发生数|按收支筛选|按币种筛选)[:：]/,
  /^-+END-+$/,
  /个人活期账户/,
  /当前时间段收支金额合计/,
  /^序号\s+摘要/,
  /^生成时间/,
  /温馨提示/,
  /仅供您核对/,
  /^第\s*\d+\s*页/,
  /\d{4}年\d{1,2}月\d{1,2}日/,
  /交易明细/,
  /Industrial Bank/,
  /Transaction/,
  /Account/,
  /Currency/,
  /Income and/,
  /Expenditure/,
  /Transfer/,
  /Counterparty/,
  /说明：/,
  /币种：/,
  /收支类别/,
  /打印日期/,
  /对方/,
  /Export/,
  /Page/,
];

/**
 * 判断一行文本是否属于应忽略的噪声。
 *
 * @param line 已去首尾空白的文本行
 * @returns 是噪声返回 true
 */
function isNoiseLine(line: string): boolean {
  if (line === '') {
    return true;
  }
  // 订单号（纯数字且较长）与「订单」字样属于银行导出的内部编号，对对账无意义。
  if (/^\d{10,}$/.test(line)) {
    return true;
  }
  if (line === '订单') {
    return true;
  }
  return NOISE_PATTERNS.some((pattern) => pattern.test(line));
}

/**
 * 把带符号、可能含千分位的金额文本转成绝对值字符串。
 *
 * 说明：银行导出金额恒带正负号（支出为负、收入为正），但下游方向由「收支方向」列表达，
 * 金额列只保留绝对值，避免符号与方向双重表达导致口径漂移。
 *
 * @param raw 金额文本，如 '-6,000.00'
 * @returns 绝对值字符串，如 '6000.00'
 */
function toAbsoluteAmount(raw: string): string {
  return raw.replace(/[-+,]/g, '');
}

/**
 * 把银行流水的文本行解析为规整二维表。
 *
 * 说明：逐行扫描，遇到「纯日期行」开启一笔交易，紧接着的「主行」抽取时间 / 摘要 /
 * 收支部 / 金额，随后的碎片行（剔除噪声后）累积为交易用途；遇到下一笔日期行时
 * 把上一笔落盘。同时支持中国建设银行「序号 + 摘要 + 8位交易日期 + 带符号金额 + 余额 + 附言/对方」
 * 格式。最终产出列名与微信 / CSV 同源的二维表，下游可直接套用列头映射。
 *
 * @param lines 银行 PDF 经文本层抽取后的文本行（已按原始换行切分）
 * @returns 规整二维表，表头为 ['交易时间','记账日期','摘要','收支方向','交易金额','交易用途']
 */
export function parseBankStatementText(lines: readonly string[]): RawTable {
  const headers = ['交易时间', '记账日期', '摘要', '收支方向', '交易金额', '交易用途'];
  const rows: string[][] = [];
  let pending: PendingRecord | null = null;

  const flush = (): void => {
    if (pending && pending.realized) {
      const occurredAt = pending.time === '' ? pending.date : `${pending.date} ${pending.time}`;
      const sep = pending.joinSeparator ?? ' ';
      rows.push([
        occurredAt,
        pending.date,
        pending.summary,
        pending.sign === '支' ? '支出' : '收入',
        toAbsoluteAmount(pending.amount),
        pending.usageLines.join(sep).trim(),
      ]);
    }
    pending = null;
  };

  for (const rawLine of lines) {
    let line = rawLine.trim();
    const datePrefixed = DATE_PREFIXED_MAIN_LINE.exec(line);
    if (datePrefixed) {
      flush();
      pending = {
        date: datePrefixed[1] ?? '',
        time: '',
        summary: '',
        sign: '支',
        amount: '0',
        usageLines: [],
        joinSeparator: ' ',
        realized: false,
      };
      line = datePrefixed[2] ?? '';
    }
    const mainMatch = MAIN_LINE.exec(line);
    if (mainMatch) {
      if (!pending) {
        // 极少数情况下主行先于日期行出现：用记账日期（8 位）反推交易日期。
        const acct = mainMatch[2] ?? '';
        const date = acct.length === 8 ? `${acct.slice(0, 4)}-${acct.slice(4, 6)}-${acct.slice(6, 8)}` : '';
        pending = {
          date,
          time: '',
          summary: '',
          sign: '支',
          amount: '0',
          usageLines: [],
          joinSeparator: ' ',
          realized: true,
        };
      }
      pending.realized = true;
      pending.time = mainMatch[1] ?? pending.time;
      pending.summary = mainMatch[3] ?? pending.summary;
      pending.sign = (mainMatch[4] as '支' | '收') ?? pending.sign;
      pending.amount = mainMatch[5] ?? pending.amount;
      const usage = (mainMatch[7] ?? '').trim();
      if (usage !== '' && !isNoiseLine(usage)) {
        pending.usageLines.push(usage);
      }
      continue;
    }
    const ccbMatch = CCB_MAIN_LINE.exec(line);
    if (ccbMatch) {
      flush();
      const summary = ccbMatch[2] ?? '';
      const rawDate = ccbMatch[3] ?? '';
      const date =
        rawDate.length === 8 ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}` : '';
      const rawAmount = (ccbMatch[4] ?? '0').trim();
      const sign: '支' | '收' = rawAmount.startsWith('-') ? '支' : '收';
      const col6 = (ccbMatch[6] ?? '').trim();
      const col7 = (ccbMatch[7] ?? '').trim();
      const usage = col7 !== '' ? col7 : col6 !== '***' ? col6 : '';
      const usageLines: string[] = [];
      if (usage !== '' && !isNoiseLine(usage)) {
        usageLines.push(usage);
      }
      pending = {
        date,
        time: '',
        summary,
        sign,
        amount: rawAmount,
        usageLines,
        joinSeparator: '',
        realized: true,
      };
      continue;
    }
    const bocMatch = BOC_MAIN_LINE.exec(line);
    if (bocMatch) {
      flush();
      const date = bocMatch[1] ?? '';
      const time = bocMatch[2] ?? '';
      const rawAmount = (bocMatch[3] ?? '0').trim();
      const sign: '支' | '收' = rawAmount.startsWith('-') ? '支' : '收';
      const summary = bocMatch[5] ?? '';
      const tail = (bocMatch[6] ?? '').trim();
      const usageLines: string[] = [];
      if (tail !== '' && !isNoiseLine(tail)) {
        usageLines.push(tail);
      }
      pending = {
        date,
        time,
        summary,
        sign,
        amount: rawAmount,
        usageLines,
        joinSeparator: '',
        realized: true,
      };
      continue;
    }
    if (DATE_LINE.test(line)) {
      flush();
      pending = { date: line, time: '', summary: '', sign: '支', amount: '0', usageLines: [], realized: false };
      continue;
    }
    if (pending) {
      // 主行已解析出时间（与日期同行或在主行里）；这里只把「时间 + 记账日期 + 摘要 + 收支部 + 金额」
      // 整体落在主行，因此碎片行只可能是用途 / 对方 / 订单号，剔除噪声后并入用途。
      if (!isNoiseLine(line)) {
        pending.usageLines.push(line);
      }
      continue;
    }
    // 还没有开启任何交易（页面页眉 / 页脚 / 说明），直接忽略。
  }
  flush();

  return { headers, rows };
}
