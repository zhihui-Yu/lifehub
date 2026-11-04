/**
 * CSV 文件编码探测与解码。
 *
 * 架构位置：core 包「CSV 解析」模块的第 0 步。
 *
 * 策略（系统设计 §1.2 难点 4）：
 * 1. 先试 UTF-8 **严格**解码；
 * 2. 失败则试 GBK / GB18030 **严格**解码；
 * 3. 仍失败则 UTF-8 宽松解码并记录告警。
 *
 * 说明：`TextDecoder` 属于 WHATWG Encoding 标准，Chrome / Edge / Node 22 全 ICU 均支持 GBK，
 * **零第三方依赖**。
 */
import { LifeHubError } from '../errors';
import type { ImportEncoding } from '../models/import-batch';

/** UTF-8 BOM 字节序列。 */
export const UTF8_BOM = new Uint8Array([0xef, 0xbb, 0xbf]);

/**
 * 判断字节数组是否以 UTF-8 BOM 开头。
 *
 * @param bytes 待检查的字节数组
 * @returns 含 BOM 返回 true
 */
export function hasBom(bytes: Uint8Array): boolean {
  if (bytes.length < 3) {
    return false;
  }
  return bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}

/**
 * 剥离 UTF-8 BOM。
 *
 * @param bytes 待剥离的字节数组
 * @returns 剥离后的字节数组（无 BOM 时返回原数组）
 */
export function stripBom(bytes: Uint8Array): Uint8Array {
  return hasBom(bytes) ? bytes.subarray(3) : bytes;
}

/**
 * 严格解码字节数组。
 *
 * @param bytes 待解码的字节数组
 * @param label 编码标签，如 'utf-8' / 'gbk'
 * @returns 解码文本；编码非法时返回 null
 */
function decodeStrict(bytes: Uint8Array, label: string): string | null {
  if (bytes.includes(0xff)) {
    return null;
  }
  try {
    const decoder = new TextDecoder(label, { fatal: true });
    return decoder.decode(bytes);
  } catch {
    return null;
  }
}

/**
 * 探测文件编码。
 *
 * @param bytes 文件字节数组
 * @returns 探测到的编码标识
 * @throws {LifeHubError} `LIFEHUB_E_CSV_ENCODING` —— 所有编码都无法严格解码
 */
export function detectEncoding(bytes: Uint8Array): ImportEncoding {
  if (hasBom(bytes)) {
    return 'utf-8-bom';
  }
  // 空文件按 UTF-8 处理，后续解析会得到 0 行。
  if (bytes.length === 0) {
    return 'utf-8';
  }
  if (decodeStrict(bytes, 'utf-8') !== null) {
    return 'utf-8';
  }
  if (decodeStrict(bytes, 'gbk') !== null) {
    return 'gbk';
  }
  if (decodeStrict(bytes, 'gb18030') !== null) {
    return 'gb18030';
  }
  throw new LifeHubError('LIFEHUB_E_CSV_ENCODING');
}

/**
 * 按指定编码解码字节数组。
 *
 * @param bytes 待解码的字节数组
 * @param encoding 编码标识；省略时自动探测
 * @returns 解码文本
 * @throws {LifeHubError} `LIFEHUB_E_CSV_ENCODING` —— 编码无法识别
 */
export function decodeBytes(bytes: Uint8Array, encoding?: ImportEncoding): string {
  const resolved = encoding ?? detectEncoding(bytes);
  if (resolved === 'utf-8-bom') {
    return decodeStrict(stripBom(bytes), 'utf-8') ?? new TextDecoder('utf-8').decode(stripBom(bytes));
  }
  const strict = decodeStrict(bytes, resolved);
  if (strict !== null) {
    return strict;
  }
  // 严格解码失败时退回宽松解码，尽量多救回一些内容（坏字节替换为 U+FFFD）。
  return new TextDecoder(resolved).decode(bytes);
}

/**
 * 把字节流按块解码为文本流。
 *
 * 说明：使用 `TextDecoder` 的流式模式，decoder 内部会保留跨 chunk 的未完成多字节序列，
 * 避免中文被截断成乱码（系统设计 §1.2 难点 4）。
 *
 * @param chunks 字节块异步迭代器
 * @param encoding 编码标识；省略时自动探测（需先读完首块才能判定，成本较高，建议显式传入）
 * @returns 解码后的文本块异步迭代器
 */
export async function* decodeChunks(
  chunks: AsyncIterable<Uint8Array>,
  encoding?: ImportEncoding,
): AsyncGenerator<string> {
  let label = encoding;
  if (!label) {
    // 收集首块用于探测编码；探测失败时按 UTF-8 宽松处理。
    const iterator = chunks[Symbol.asyncIterator]();
    const first = await iterator.next();
    if (first.done) {
      return;
    }
    const detected = tryDetectEncoding(first.value);
    label = detected ?? 'utf-8';
    const decoder = new TextDecoder(label);
    yield decoder.decode(first.value, { stream: true });
    for (;;) {
      const next = await iterator.next();
      if (next.done) {
        break;
      }
      yield decoder.decode(next.value, { stream: true });
    }
    yield decoder.decode();
    return;
  }

  const decoder = new TextDecoder(label);
  for await (const chunk of chunks) {
    yield decoder.decode(chunk, { stream: true });
  }
  yield decoder.decode();
}

/**
 * 尝试探测编码，失败返回 null 而不抛异常。
 *
 * @param bytes 待探测的字节数组
 * @returns 编码标识；无法判定返回 null
 */
function tryDetectEncoding(bytes: Uint8Array): ImportEncoding | null {
  try {
    return detectEncoding(bytes);
  } catch {
    return null;
  }
}
