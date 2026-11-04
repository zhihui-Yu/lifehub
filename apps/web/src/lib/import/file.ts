/**
 * 导入文件类型识别与字节读取工具。
 *
 * 架构位置：apps/web 的「导入」工具层。
 *
 * 说明：统一维护受支持的账单文件扩展名、MIME 类型及类型推断（CSV / XLSX / PDF / JSON），
 * 供拖拽区、导入页与多格式抽取模块复用。
 */

/** 受支持的账单导入文件类型。 */
export type SupportedImportType = 'csv' | 'xlsx' | 'pdf' | 'json' | 'zip';

/** 受支持的账单文件扩展名列表。 */
export const SUPPORTED_EXTENSIONS = [
  '.csv',
  '.tsv',
  '.txt',
  '.xlsx',
  '.xls',
  '.pdf',
  '.json',
  '.zip',
] as const;

/** 受支持的账单文件 MIME 类型列表。 */
export const SUPPORTED_MIMES = [
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/pdf',
  'application/json',
  'application/zip',
  'application/x-zip-compressed',
] as const;

/**
 * 识别用户上传文件的导入类型。
 *
 * 说明：优先根据文件名后缀识别 `.xlsx/.xls`、`.pdf`、`.json`、`.zip`、`.csv/.tsv/.txt`，
 * 若文件名缺少标准后缀则回退至 `file.type` MIME 识别。
 *
 * @param file 待识别的文件对象
 * @returns 识别出的导入类型；不受支持时返回 null
 * @throws 无（纯函数不抛出异常）
 */
export function detectFileType(file: File): SupportedImportType | null {
  const name = file.name.toLowerCase();
  if (name.endsWith('.zip')) {
    return 'zip';
  }
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    return 'xlsx';
  }
  if (name.endsWith('.pdf')) {
    return 'pdf';
  }
  if (name.endsWith('.json')) {
    return 'json';
  }
  if (name.endsWith('.csv') || name.endsWith('.tsv') || name.endsWith('.txt')) {
    return 'csv';
  }
  if (file.type === 'application/zip' || file.type === 'application/x-zip-compressed') {
    return 'zip';
  }
  if (
    file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    file.type === 'application/vnd.ms-excel'
  ) {
    return 'xlsx';
  }
  if (file.type === 'application/pdf') {
    return 'pdf';
  }
  if (file.type === 'application/json') {
    return 'json';
  }
  if (file.type === 'text/csv') {
    return 'csv';
  }
  return null;
}

/**
 * 判断文件类型是否受支持。
 *
 * 说明：支持 CSV / TSV / TXT（分隔符文本）、XLSX / XLS（电子表格）、PDF（银行流水）与 JSON（导出的账单文件）。
 *
 * @param file 待判断的文件
 * @returns 受支持返回 true，否则返回 false
 * @throws 无（纯函数不抛出异常）
 */
export function isSupportedFileType(file: File): boolean {
  return detectFileType(file) !== null;
}

/**
 * 读取文件的全部字节。
 *
 * 说明：通过 `File.arrayBuffer()` 读取完整字节并包装为 `Uint8Array`。
 *
 * @param file 用户选择的文件
 * @returns 文件字节数组
 * @throws {DOMException} 当底层文件读取失败时抛出浏览器异常
 */
export async function readFileBytes(file: File): Promise<Uint8Array> {
  const buffer = await file.arrayBuffer();
  return new Uint8Array(buffer);
}
