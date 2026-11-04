/**
 * 多格式文件抽取。
 *
 * 架构位置：apps/web 的「导入」工具层。
 *
 * 说明：core 的 `ImportService` 只认统一的 `ImportSource`（字节 / 规整二维表 / PDF 文本），
 * 不碰 DOM 与第三方解析库（合规红线 R2：core 依赖只能是 `@noble/*`）。
 * 因此 **xlsx 解析（SheetJS）与 PDF 文本抽取（pdfjs）都放在浏览器侧**，
 * 抽好之后再喂给 core。本模块就是「File → ImportSource」这一道浏览器专属的转换。
 */
import { formatMinor, LifeHubError, normalizeTableHeaders } from '@lifehub/core';
import type { ImportSource, RawTable } from '@lifehub/core';

import { PasswordRequiredError } from './zip';

/** 判断文件名对应的格式。 */
function inferFormat(fileName: string): 'csv' | 'xlsx' | 'pdf' | 'json' | 'other' {
  const name = fileName.toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    return 'xlsx';
  }
  if (name.endsWith('.pdf')) {
    return 'pdf';
  }
  if (name.endsWith('.json')) {
    return 'json';
  }
  if (name.endsWith('.csv') || name.endsWith('.txt') || name.endsWith('.tsv')) {
    return 'csv';
  }
  return 'other';
}

/**
 * 把用户选择的文件转换成 core 的 `ImportSource`。
 *
 * 说明：
 * - `.csv` / `.txt` / `.tsv`：直接给字节，由 core 按编码解码后解析；
 * - `.xlsx` / `.xls`：用 SheetJS 在浏览器里抽成规整二维表（含表头与数据行）；
 * - `.pdf`：用 pdfjs 抽取文本层，按页还原成行文本，交给 core 的银行流水解析器规整（支持加密 PDF 密码解密）；
 * - `.json`：用 `parseJsonBillTable` 将导出的 JSON 账单转换为标准二维表。
 *
 * @param file 用户选择的文件
 * @param bytes 文件字节（由 `readFileBytes` 读取）
 * @param options 可选配置（如加密 PDF 的解密密码 `password`）
 * @returns core 的导入源
 * @throws {PasswordRequiredError | LifeHubError} 当加密 PDF 缺少密码/密码错误或文件解析失败时抛出异常
 */
export async function buildImportSource(
  file: File,
  bytes: Uint8Array,
  options?: { password?: string },
): Promise<ImportSource> {
  const sizeBytes = bytes.length;
  const format = inferFormat(file.name);
  if (format === 'xlsx') {
    const table = await readXlsxTable(bytes);
    return { fileName: file.name, sizeBytes, bytes, format: 'xlsx', table };
  }
  if (format === 'pdf') {
    const text = await readPdfText(bytes, options?.password, file.name);
    return { fileName: file.name, sizeBytes, bytes, format: 'pdf', text };
  }
  if (format === 'json' || file.type === 'application/json') {
    const table = parseJsonBillTable(bytes);
    return { fileName: file.name, sizeBytes, bytes, format: 'csv', table };
  }
  // 默认按分隔符文本处理，core 用 CsvParser 解析。
  return { fileName: file.name, sizeBytes, bytes };
}

/**
 * 将 JSON 账单文件字节解析为标准二维表 `RawTable`。
 *
 * 说明：兼容顶层数组 `[...]` 或包裹对象 `{ bills: [...] }` / `{ items: [...] }` / `{ data: [...] }`，
 * 同时支持英文字段（`occurredAt`、`localDate`、`direction`、`categoryId`、`categoryName`、`counterparty`、
 * `note`、`amount`、`amountYuan`、`amountMinor`、`source`、`sourceFile`）与中文字段（`交易时间`、`收/支`、
 * `分类`、`交易对方`、`备注`、`金额`、`来源`），并严禁使用浮点数解析金额（`amountMinor` 统一通过 `formatAmount` 转为元字符串）。
 *
 * @param bytes JSON 文件字节数组
 * @returns 包含标准表头与数据行的 `RawTable`
 * @throws {LifeHubError} 当 JSON 语法错误或未识别到有效账单记录时抛出 `LIFEHUB_E_IMPORT_PARSE_FAILED`
 */
export function parseJsonBillTable(bytes: Uint8Array): RawTable {
  const text = new TextDecoder('utf-8').decode(bytes).trim();
  if (!text) {
    throw new LifeHubError('LIFEHUB_E_IMPORT_PARSE_FAILED', '无法从 JSON 文件中识别有效的账单记录');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new LifeHubError('LIFEHUB_E_IMPORT_PARSE_FAILED', '无法从 JSON 文件中识别有效的账单记录');
  }

  let list: unknown[] | null = null;
  if (Array.isArray(parsed)) {
    list = parsed;
  } else if (parsed && typeof parsed === 'object') {
    const container = parsed as Record<string, unknown>;
    if (Array.isArray(container.bills)) {
      list = container.bills;
    } else if (Array.isArray(container.items)) {
      list = container.items;
    } else if (Array.isArray(container.data)) {
      list = container.data;
    }
  }

  if (!list || list.length === 0) {
    throw new LifeHubError('LIFEHUB_E_IMPORT_PARSE_FAILED', '无法从 JSON 文件中识别有效的账单记录');
  }

  const headers = ['交易时间', '收/支', '分类', '交易对方', '备注', '金额', '来源'];
  const rows: string[][] = [];

  for (const rawItem of list) {
    if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
      continue;
    }
    const item = rawItem as Record<string, unknown>;

    const occurredAtRaw =
      item.occurredAt ??
      item.localDate ??
      item['交易时间'] ??
      item['记账日期'] ??
      item['日期'] ??
      item.date ??
      '';
    const occurredAt = String(occurredAtRaw).trim();

    const directionRaw = String(
      item.direction ?? item['收/支'] ?? item['收支方向'] ?? item['支/收'] ?? '',
    )
      .trim()
      .toLowerCase();
    let direction = '支出';
    if (directionRaw === 'income' || directionRaw === 'in' || directionRaw === '收入') {
      direction = '收入';
    } else if (
      directionRaw === 'transfer' ||
      directionRaw === 'neutral' ||
      directionRaw === '不计收支'
    ) {
      direction = '不计收支';
    } else if (directionRaw === 'expense' || directionRaw === 'out' || directionRaw === '支出') {
      direction = '支出';
    } else if (directionRaw) {
      direction = String(item.direction ?? item['收/支'] ?? '').trim();
    }

    const category = String(
      item.categoryName ??
        item.category ??
        item.categoryId ??
        item['分类'] ??
        item['交易分类'] ??
        '',
    ).trim();

    const counterparty = String(
      item.counterparty ?? item['交易对方'] ?? item['对方户名'] ?? item['商户名称'] ?? '',
    ).trim();

    const note = String(item.note ?? item['备注'] ?? item['商品说明'] ?? '').trim();

    let amount = '';
    if (item.amount !== undefined && item.amount !== null && String(item.amount).trim() !== '') {
      amount = String(item.amount).trim();
    } else if (
      item['金额'] !== undefined &&
      item['金额'] !== null &&
      String(item['金额']).trim() !== ''
    ) {
      amount = String(item['金额']).trim();
    } else if (
      item['金额(元)'] !== undefined &&
      item['金额(元)'] !== null &&
      String(item['金额(元)']).trim() !== ''
    ) {
      amount = String(item['金额(元)']).trim();
    } else if (
      typeof item.amountMinor === 'number' &&
      Number.isFinite(item.amountMinor)
    ) {
      // 使用整数分转元字符串（formatMinor 内部基于整数拆解，严禁浮点运算），去除货币符号前缀供金额解析器识别
      amount = formatMinor(Math.trunc(item.amountMinor), 'CNY').replace(/^[^\d-]+/, '');
    } else if (
      typeof item.amountYuan === 'string' &&
      item.amountYuan.trim() !== ''
    ) {
      amount = item.amountYuan.trim().replace(/^[^\d-]+/, '');
    }

    const source = String(
      item.source ?? item.sourceFile ?? item['来源'] ?? 'JSON 导入',
    ).trim();

    if (!occurredAt && !amount) {
      continue;
    }
    rows.push([occurredAt, direction, category, counterparty, note, amount, source]);
  }

  if (rows.length === 0) {
    throw new LifeHubError('LIFEHUB_E_IMPORT_PARSE_FAILED', '无法从 JSON 文件中识别有效的账单记录');
  }

  return { headers, rows };
}

/**
 * 用 SheetJS 把一个 Excel 工作簿的第一个工作表抽成规整二维表。
 *
 * 说明：首行作为表头，后续非空行作为数据行；所有单元格统一转字符串，
 * 与核心层 `RawTable` 的「字符串二维表」约定对齐（core 下游再做列映射）。
 *
 * @param bytes Excel 文件字节
 * @returns 规整二维表
 * @throws {Error} 当工作簿字节损坏无法读取时抛出异常
 */
export async function readXlsxTable(bytes: Uint8Array): Promise<RawTable> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(bytes, { type: 'array', cellDates: false });
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheet) {
    return { headers: [], rows: [] };
  }
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false });
  const grid = matrix.map((row) => (row ?? []).map((cell) => (cell === null || cell === undefined ? '' : String(cell))));
  const nonEmptyGrid = grid.filter((row) => row.some((cell) => cell.trim() !== ''));
  const headers = nonEmptyGrid.shift() ?? [];
  const rows = nonEmptyGrid;
  return normalizeTableHeaders(headers, rows);
}

/**
 * 用 pdfjs 抽取 PDF 文本层并按页还原成行文本。
 *
 * 说明：银行流水 PDF 的每一笔交易被拆成若干独立文本片段（日期 / 时间 / 金额 / 用途分行），
 * 需要按「同一视觉行（y 坐标一致）」重新拼回一行，core 的 `parseBankStatementText` 才能
 * 正确识别主行。通过将 `pdf.worker.min.mjs` 挂载到 `globalThis.pdfjsWorker`，使 PDF.js 直接走
 * 内存级 LoopbackPort（`#mainThreadWorkerMessageHandler`），彻底消除 Vite 预构建产物下 Worker 相对路径失效与 CSP 拦截问题。
 *
 * @param bytes PDF 文件字节
 * @param password 可选加密 PDF 解密密码
 * @param fileName 可选文件名（用于密码错误提示）
 * @returns 按行拼接的全文文本
 * @throws {PasswordRequiredError | Error} 当 PDF 需要密码、密码错误或文件损坏无法解析时抛出异常
 */
export async function readPdfText(
  bytes: Uint8Array,
  password?: string,
  fileName?: string,
): Promise<string> {
  const pdfjs: typeof import('pdfjs-dist/legacy/build/pdf.mjs') = await import(
    'pdfjs-dist/legacy/build/pdf.mjs'
  );
  const globalScope = globalThis as Record<string, unknown>;
  if (!globalScope.pdfjsWorker) {
    const workerModule = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs');
    globalScope.pdfjsWorker = workerModule;
  }
  let document;
  try {
    document = await pdfjs.getDocument({
      data: bytes.slice(),
      password: password || undefined,
    }).promise;
  } catch (err) {
    const errObj = err as { name?: string; code?: number; message?: string } | null;
    if (
      errObj &&
      (errObj.name === 'PasswordException' || /password/i.test(String(errObj.message ?? '')))
    ) {
      const isNeed = !password || errObj.code === 1;
      throw new PasswordRequiredError(
        isNeed ? '该 PDF 文件已加密，请输入文件密码' : 'PDF 文件密码错误，请重新输入',
        isNeed ? 'need_password' : 'incorrect_password',
        fileName,
      );
    }
    throw err;
  }
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(itemsToText(content.items));
  }
  return pages.join('\n');
}

/** PDF 表头与页脚常见中英文词条（在锚点分桶模式下予以剔除）。 */
const PDF_HEADER_WORDS: ReadonlySet<string> = new Set([
  '序号',
  '交易时间',
  '记账日期',
  '交易日期',
  '摘要',
  '支/收',
  '交易金额',
  '账户余额',
  '交易用途',
  '交易地点/附言',
  '对方账号与户名',
  '账号',
  '卡号/折号',
  '交易场所',
  '交易国家或地区简称',
  '钞/汇',
  '交易金额/币种',
  '记账金额/币种',
  '记账币种',
  '余额',
  '对方户名',
  '对方账户',
  '渠道',
  '中国银行交易流水明细清单',
  '记账时间',
  '币别',
  '交易名称',
  '网点名称',
  '附言',
  '对方账户名',
  '对方卡号/账号',
  '对方开户行',
  'Transaction Time',
  'Bookkeeping',
  'Date',
  'Summary',
  'Transaction',
  'Type',
  'Expenditure/',
  'Income',
  'Amount',
  'Account Balance',
  'Transaction Usage',
  'Accounting Date',
  'Balance',
  'Usage',
  'Currency',
  '币种',
]);

/**
 * 判断 PDF 文本片段是否为表头或页脚噪声。
 *
 * @param str 去空白后的文本
 * @param y 片段 Y 坐标
 * @param maxAnchorY 当前页最顶部交易锚点 Y 坐标
 * @param minAnchorY 当前页最底部交易锚点 Y 坐标
 * @returns 是表头或页脚返回 true
 */
function isHeaderOrFooterItem(str: string, y: number, maxAnchorY: number, minAnchorY: number): boolean {
  if (y > maxAnchorY + 25 || y < minAnchorY - 25) {
    return true;
  }
  if (PDF_HEADER_WORDS.has(str)) {
    return true;
  }
  return /^(说明[:：]|打印时间[:：]|打印日期[:：]|生成时间[:：]?|温馨提示[:：]?|仅供您核对|中国建设银行|中国工商银行|工商银行历史明细|中国银行交易流水|交易区间[:：]|借记卡号[:：]|借方发生数[:：]|贷方发生数[:：]|按收支筛选[:：]|按币种筛选[:：]|-+END-+|当前时间段收支金额合计|本页支出算术合计|第\s*\d+\s*页|共\s*\d+\s*页|Page\s*\d+|Note[:：]|Print\s*Time)/i.test(
    str,
  );
}

/**
 * 把 pdfjs 的文本片段按视觉行或交易锚点桶拼回多行文本。
 *
 * @param items pdfjs 文本层片段
 * @returns 按行拼接的文本
 */
function itemsToText(items: unknown[]): string {
  const rawItems = items.filter((item): item is { str: string; transform: number[] } => {
    const candidate = item as { str?: unknown; transform?: unknown };
    return (
      typeof candidate.str === 'string' &&
      candidate.str.trim() !== '' &&
      Array.isArray(candidate.transform)
    );
  });

  if (rawItems.length === 0) {
    return '';
  }

  // 检测是否为 90° 旋转横向排版（如中国工商银行历史明细 PDF：transform = [0, fontSize, -fontSize, 0, tx, ty]）
  const rotatedCount = rawItems.filter((item) => {
    const t = item.transform;
    return Math.abs(t[0] ?? 0) < 1e-3 && (t[1] ?? 0) > 0 && (t[2] ?? 0) < 0;
  }).length;
  const isRotated90 = rotatedCount > rawItems.length / 2;

  const positioned = rawItems
    .map((item) => {
      const t = item.transform;
      if (isRotated90 && Math.abs(t[0] ?? 0) < 1e-3 && (t[1] ?? 0) > 0 && (t[2] ?? 0) < 0) {
        return {
          x: t[5] as number,
          y: -(t[4] as number),
          str: item.str.trim(),
        };
      }
      return {
        y: t[5] as number,
        x: t[4] as number,
        str: item.str.trim(),
      };
    })
    .filter(
      (item) =>
        item.str !== '' &&
        !/^(?:兴业银行|中国工商银行)\s+.*\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/.test(item.str),
    );

  if (positioned.length === 0) {
    return '';
  }

  let minY = Infinity;
  let maxY = -Infinity;
  for (const item of positioned) {
    if (item.y < minY) minY = item.y;
    if (item.y > maxY) maxY = item.y;
  }

  const sortBucketItems = (
    list: { y: number; x: number; str: string }[],
  ): { y: number; x: number; str: string }[] => [...list].sort((a, b) => b.y - a.y || a.x - b.x);

  const rawAnchors = positioned
    .filter((item) => /^\d{8}$/.test(item.str) && item.x >= 105 && item.x <= 165)
    .sort((a, b) => b.y - a.y || a.x - b.x);

  const anchors: { y: number; x: number; str: string }[] = [];
  for (const anchor of rawAnchors) {
    const prev = anchors[anchors.length - 1];
    if (!prev || Math.abs(anchor.y - prev.y) > 3) {
      anchors.push(anchor);
    }
  }

  const firstAnchor = anchors[0];
  const lastAnchor = anchors[anchors.length - 1];
  if (firstAnchor && lastAnchor && maxY - minY > 2) {
    const maxAnchorY = firstAnchor.y;
    const minAnchorY = lastAnchor.y;
    const buckets = anchors.map((anchor) => ({
      anchor,
      items: [] as { y: number; x: number; str: string }[],
    }));

    for (const item of positioned) {
      if (anchors.includes(item)) {
        continue;
      }
      if (isHeaderOrFooterItem(item.str, item.y, maxAnchorY, minAnchorY)) {
        continue;
      }
      let bestBucket: (typeof buckets)[number] | undefined;
      let bestDist = Infinity;
      for (const bucket of buckets) {
        const dist = Math.abs(item.y - bucket.anchor.y);
        if (dist < bestDist) {
          bestDist = dist;
          bestBucket = bucket;
        }
      }
      if (bestBucket && bestDist <= 25) {
        bestBucket.items.push(item);
      }
    }

    const outLines: string[] = [];
    for (const bucket of buckets) {
      const sorted = sortBucketItems(bucket.items);
      const colTime = sorted
        .filter((it) => it.x < 105)
        .map((it) => it.str)
        .join(' ');
      const dateMatch = /(\d{4}-\d{2}-\d{2})/.exec(colTime);
      const timeMatch = /(\d{1,2}:\d{2}:\d{2})/.exec(colTime);
      const bookDate = bucket.anchor.str;
      const summary = sorted
        .filter((it) => it.x >= 165 && it.x < 235)
        .map((it) => it.str)
        .join('')
        .replace(/\s+/g, '');
      const dir = sorted
        .filter((it) => it.x >= 235 && it.x < 275)
        .map((it) => it.str)
        .join('')
        .replace(/\s+/g, '');
      const amount = sorted
        .filter((it) => it.x >= 275 && it.x < 355)
        .map((it) => it.str)
        .join('')
        .replace(/\s+/g, '');
      const balance = sorted
        .filter((it) => it.x >= 355 && it.x < 425)
        .map((it) => it.str)
        .join('')
        .replace(/\s+/g, '');
      const usageItems = sorted.filter((it) => it.x >= 425).map((it) => it.str);

      const matchedDate = dateMatch?.[1];
      const matchedTime = timeMatch?.[1];
      if (matchedDate && matchedTime && summary && dir && amount && balance) {
        outLines.push(matchedDate);
        outLines.push(`${matchedTime} ${bookDate} ${summary} ${dir} ${amount} ${balance}`);
        for (const u of usageItems) {
          outLines.push(u);
        }
      }
    }

    if (outLines.length > 0) {
      return outLines.join('\n');
    }
  }

  if (maxY - minY > 2) {
    // 中国建设银行等「序号 + 摘要 + 8位交易日期 + 带符号交易金额 + 账户余额 + 交易地点/附言 + 对方账号与户名」坐标锚点分桶
    const ccbRawAnchors = positioned
      .filter(
        (item) =>
          /^\d{8}$/.test(item.str) &&
          item.x >= 95 &&
          item.x < 145 &&
          positioned.some(
            (seqItem) =>
              seqItem.x < 55 && /^\d+$/.test(seqItem.str) && Math.abs(seqItem.y - item.y) <= 3,
          ),
      )
      .sort((a, b) => b.y - a.y || a.x - b.x);

    const ccbAnchors: { y: number; x: number; str: string }[] = [];
    for (const anchor of ccbRawAnchors) {
      const prev = ccbAnchors[ccbAnchors.length - 1];
      if (!prev || Math.abs(anchor.y - prev.y) > 3) {
        ccbAnchors.push(anchor);
      }
    }

    const firstCcbAnchor = ccbAnchors[0];
    const lastCcbAnchor = ccbAnchors[ccbAnchors.length - 1];
    if (firstCcbAnchor && lastCcbAnchor) {
      const maxCcbY = firstCcbAnchor.y;
      const minCcbY = lastCcbAnchor.y;
      const ccbBuckets = ccbAnchors.map((anchor) => ({
        anchor,
        items: [] as { y: number; x: number; str: string }[],
      }));

      for (const item of positioned) {
        if (ccbAnchors.includes(item)) {
          continue;
        }
        if (
          item.y > maxCcbY + 12 ||
          item.y < minCcbY - 12 ||
          isHeaderOrFooterItem(item.str, item.y, maxCcbY, minCcbY)
        ) {
          continue;
        }
        let bestBucket: (typeof ccbBuckets)[number] | undefined;
        let bestDist = Infinity;
        for (const bucket of ccbBuckets) {
          const dist = Math.abs(item.y - bucket.anchor.y);
          if (dist < bestDist) {
            bestDist = dist;
            bestBucket = bucket;
          }
        }
        if (bestBucket && bestDist <= 10) {
          bestBucket.items.push(item);
        }
      }

      const ccbLines: string[] = [];
      for (const bucket of ccbBuckets) {
        const sorted = sortBucketItems(bucket.items);
        const seq = sorted
          .filter((it) => it.x < 50 && /^\d+$/.test(it.str))
          .map((it) => it.str)
          .join('');
        const summary = sorted
          .filter((it) => it.x >= 50 && it.x < 100)
          .map((it) => it.str)
          .join('')
          .replace(/\s+/g, '');
        const tradeDate = bucket.anchor.str;
        const amount = sorted
          .filter((it) => it.x >= 140 && it.x < 215)
          .map((it) => it.str)
          .join('')
          .replace(/\s+/g, '');
        const balance = sorted
          .filter((it) => it.x >= 215 && it.x < 295)
          .map((it) => it.str)
          .join('')
          .replace(/\s+/g, '');
        const location = sorted
          .filter((it) => it.x >= 295 && it.x < 410)
          .map((it) => it.str)
          .join('')
          .replace(/\s+/g, '');
        const counterparty = sorted
          .filter((it) => it.x >= 410)
          .map((it) => it.str)
          .join('')
          .replace(/\s+/g, '');

        if (
          seq &&
          summary &&
          tradeDate &&
          /^[-+]?[\d,]+\.\d{2}$/.test(amount) &&
          /^[\d,]+\.\d{2}$/.test(balance)
        ) {
          ccbLines.push(
            `${seq} ${summary} ${tradeDate} ${amount} ${balance} ${location || '***'} ${counterparty}`.trim(),
          );
        }
      }

      if (ccbLines.length > 0) {
        return ccbLines.join('\n');
      }
    }

    // 中国工商银行等横向 90° 旋转流水坐标锚点分桶（含跨行对方户名无空格无缝拼接）
    const icbcRawAnchors = positioned
      .filter(
        (item) =>
          item.x >= 410 &&
          item.x < 495 &&
          /^[-+]?[\d,]+\.\d{2}$/.test(item.str) &&
          positioned.some(
            (bal) =>
              bal.x >= 495 &&
              bal.x < 565 &&
              /^[\d,]+\.\d{2}$/.test(bal.str) &&
              Math.abs(bal.y - item.y) <= 4,
          ) &&
          positioned.some(
            (acct) =>
              acct.x >= 120 &&
              acct.x < 200 &&
              /^\d{10,22}$/.test(acct.str) &&
              Math.abs(acct.y - item.y) <= 4,
          ),
      )
      .sort((a, b) => b.y - a.y || a.x - b.x);

    const icbcAnchors: { y: number; x: number; str: string }[] = [];
    for (const anchor of icbcRawAnchors) {
      const prev = icbcAnchors[icbcAnchors.length - 1];
      if (!prev || Math.abs(anchor.y - prev.y) > 4) {
        icbcAnchors.push(anchor);
      }
    }

    const firstIcbcAnchor = icbcAnchors[0];
    const lastIcbcAnchor = icbcAnchors[icbcAnchors.length - 1];
    if (firstIcbcAnchor && lastIcbcAnchor) {
      const maxIcbcY = firstIcbcAnchor.y;
      const minIcbcY = lastIcbcAnchor.y;
      const icbcBuckets = icbcAnchors.map((anchor) => ({
        anchor,
        items: [] as { y: number; x: number; str: string }[],
      }));

      for (const item of positioned) {
        if (
          item.y > maxIcbcY + 8 ||
          item.y < minIcbcY - 10 ||
          isHeaderOrFooterItem(item.str, item.y, maxIcbcY, minIcbcY)
        ) {
          continue;
        }
        let bestBucket: (typeof icbcBuckets)[number] | undefined;
        let bestDist = Infinity;
        for (const bucket of icbcBuckets) {
          const dist = Math.abs(item.y - bucket.anchor.y);
          if (dist < bestDist) {
            bestDist = dist;
            bestBucket = bucket;
          }
        }
        if (bestBucket && bestDist <= 8) {
          bestBucket.items.push(item);
        }
      }

      const icbcLines: string[] = [];
      for (const bucket of icbcBuckets) {
        const sorted = sortBucketItems(bucket.items);
        const colTime = sorted
          .filter((it) => it.x < 120)
          .map((it) => it.str)
          .join(' ');
        const dateMatch = /(\d{4}-\d{2}-\d{2})/.exec(colTime);
        const timeMatch = /(\d{1,2}:\d{2}:\d{2})/.exec(colTime);
        const summary = sorted
          .filter((it) => it.x >= 330 && it.x < 375)
          .map((it) => it.str)
          .join('')
          .replace(/\s+/g, '');
        const amount = sorted
          .filter((it) => it.x >= 410 && it.x < 495 && /^[-+]?[\d,]+\.\d{2}$/.test(it.str))
          .map((it) => it.str)
          .join('')
          .replace(/\s+/g, '');
        const balance = sorted
          .filter((it) => it.x >= 495 && it.x < 565 && /^[\d,]+\.\d{2}$/.test(it.str))
          .map((it) => it.str)
          .join('')
          .replace(/\s+/g, '');
        const counterparty = sorted
          .filter((it) => it.x >= 565 && it.x < 640)
          .map((it) => it.str)
          .join('')
          .replace(/\s+/g, '');
        const counterpartyAcct = sorted
          .filter((it) => it.x >= 640 && it.x < 705)
          .map((it) => it.str)
          .join('')
          .replace(/\s+/g, '');
        const channel = sorted
          .filter((it) => it.x >= 705)
          .map((it) => it.str)
          .join('')
          .replace(/\s+/g, '');

        const matchedDate = dateMatch?.[1];
        const matchedTime = timeMatch?.[1] ?? '00:00:00';
        if (matchedDate && summary && amount && balance) {
          const bookDate = matchedDate.replace(/-/g, '');
          const sign = amount.startsWith('-') ? '支' : '收';
          const absAmount = amount.replace(/^[-+]/, '');
          const usage = [counterparty, counterpartyAcct, channel].filter(Boolean).join(' ');
          icbcLines.push(matchedDate);
          icbcLines.push(`${matchedTime} ${bookDate} ${summary} ${sign} ${absAmount} ${balance}`);
          if (usage) {
            icbcLines.push(usage);
          }
        }
      }

      if (icbcLines.length > 0) {
        return icbcLines.join('\n');
      }
    }

    // 针对中国银行交易流水明细 PDF：以左侧「记账日期」(x ∈ [30, 90), YYYY-MM-DD) 搭配同行记账时间与金额作为交易锚点
    const bocRawAnchors = positioned
      .filter(
        (item) =>
          item.x >= 30 &&
          item.x < 90 &&
          /^\d{4}-\d{2}-\d{2}$/.test(item.str) &&
          positioned.some(
            (t) =>
              Math.abs(t.y - item.y) <= 3 &&
              t.x >= 95 &&
              t.x < 155 &&
              /^\d{1,2}:\d{2}:\d{2}$/.test(t.str),
          ) &&
          positioned.some(
            (a) =>
              Math.abs(a.y - item.y) <= 3 &&
              a.x >= 210 &&
              a.x < 285 &&
              /^[-+]?[\d,]+\.\d{2}$/.test(a.str),
          ),
      )
      .sort((a, b) => b.y - a.y);

    const bocAnchors: { y: number; x: number; str: string }[] = [];
    for (const cand of bocRawAnchors) {
      if (!bocAnchors.some((existing) => Math.abs(existing.y - cand.y) <= 3)) {
        bocAnchors.push(cand);
      }
    }

    if (bocAnchors.length > 0) {
      const maxBocY = Math.max(...bocAnchors.map((a) => a.y));
      const minBocY = Math.min(...bocAnchors.map((a) => a.y));

      const bocBuckets = bocAnchors.map((anchor) => ({
        anchor,
        items: [] as { y: number; x: number; str: string }[],
      }));

      for (const item of positioned) {
        if (isHeaderOrFooterItem(item.str, item.y, maxBocY, minBocY)) {
          continue;
        }
        if (item.y > maxBocY + 8 || item.y < minBocY - 14) {
          continue;
        }
        let bestBucket: (typeof bocBuckets)[number] | undefined;
        let bestDist = Infinity;
        for (const bucket of bocBuckets) {
          // 中国银行折行文本向下偏移约 7.9pt (dy = anchor.y - item.y > 0)
          const dy = bucket.anchor.y - item.y;
          if (dy >= -3 && dy <= 12 && Math.abs(dy) < bestDist) {
            bestDist = Math.abs(dy);
            bestBucket = bucket;
          }
        }
        if (bestBucket) {
          bestBucket.items.push(item);
        }
      }

      const bocLines: string[] = [];
      for (const bucket of bocBuckets) {
        const sorted = [...bucket.items].sort((a, b) => b.y - a.y || a.x - b.x);
        const matchedDate = bucket.anchor.str;
        const matchedTime =
          sorted.find((it) => it.x >= 95 && it.x < 155 && /^\d{1,2}:\d{2}:\d{2}$/.test(it.str))?.str ??
          '00:00:00';
        const amount = sorted.find(
          (it) => it.x >= 210 && it.x < 285 && /^[-+]?[\d,]+\.\d{2}$/.test(it.str),
        )?.str;
        const balance = sorted.find(
          (it) => it.x >= 285 && it.x < 338 && /^[\d,]+\.\d{2}$/.test(it.str),
        )?.str;
        const tradeName = sorted
          .filter((it) => it.x >= 338 && it.x < 393)
          .map((it) => it.str)
          .join('')
          .replace(/\s+/g, '');
        const postscript = sorted
          .filter((it) => it.x >= 445 && it.x < 590)
          .map((it) => it.str.replace(/^-+\s*/, '').replace(/\s*-+$/, '').trim())
          .filter((s) => s.length > 0)
          .join('')
          .replace(/\s+/g, '');
        const counterparty = sorted
          .filter((it) => it.x >= 590 && it.x < 668)
          .map((it) => it.str.replace(/^-+\s*/, '').replace(/\s*-+$/, '').trim())
          .filter((s) => s.length > 0)
          .join('')
          .replace(/\s+/g, '');

        if (matchedDate && tradeName && amount && balance) {
          const bookDate = matchedDate.replace(/-/g, '');
          const sign = amount.startsWith('-') ? '支' : '收';
          const absAmount = amount.replace(/^[-+]/, '');
          const summary =
            postscript && postscript !== counterparty ? `${tradeName}(${postscript})` : tradeName;
          const usage = counterparty || postscript;
          bocLines.push(matchedDate);
          bocLines.push(`${matchedTime} ${bookDate} ${summary} ${sign} ${absAmount} ${balance}`);
          if (usage) {
            bocLines.push(usage);
          }
        }
      }

      if (bocLines.length > 0) {
        return bocLines.join('\n');
      }
    }
  }

  positioned.sort((a, b) => b.y - a.y || a.x - b.x);

  const lines: string[] = [];
  let currentY: number | null = null;
  let current: string[] = [];
  for (const item of positioned) {
    if (currentY === null || Math.abs(item.y - currentY) > 2) {
      if (current.length > 0) {
        lines.push(current.join(' '));
      }
      current = [];
      currentY = item.y;
    }
    current.push(item.str);
  }
  if (current.length > 0) {
    lines.push(current.join(' '));
  }
  return lines.join('\n');
}
