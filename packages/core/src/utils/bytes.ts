/**
 * 通用工具函数。
 *
 * 架构位置：core 包的最底层工具模块，零业务依赖，可被任意层引用。
 */

/**
 * 把字节数组格式化为小写 hex 字符串。
 *
 * @param bytes 待转换的字节数组
 * @returns 小写 hex 字符串；空数组返回空串
 */
export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * 把 hex 字符串转换为字节数组。
 *
 * @param hex hex 字符串（不区分大小写）
 * @returns 字节数组
 * @throws {Error} 字符串含非法字符或长度为奇数
 */
export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) {
    throw new Error('非法 hex 字符串');
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * 拼接多个字节数组。
 *
 * @param chunks 待拼接的字节数组列表
 * @returns 拼接结果
 */
export function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) {
    total += chunk.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * 把 UTF-8 字符串编码为字节数组。
 *
 * 说明：手写实现而非调用 `TextEncoder`，因为 `TextEncoder` 属于 DOM / Web API 类型，
 * 而核心层必须能在「零 DOM」的 `lib: ["ES2022"]` 环境下编译（架构红线 R1）。
 *
 * @param text 待编码文本
 * @returns UTF-8 字节数组
 */
export function utf8Encode(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const char of text) {
    let codePoint = char.codePointAt(0);
    if (codePoint === undefined) {
      continue;
    }
    if (codePoint < 0x80) {
      bytes.push(codePoint);
    } else if (codePoint < 0x800) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      bytes.push(0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return new Uint8Array(bytes);
}

/**
 * 把 UTF-8 字节数组解码为字符串。
 *
 * 说明：手写实现，理由同 `utf8Encode`——保持核心层零 DOM 类型依赖。
 *
 * @param bytes 待解码字节数组
 * @returns 解码后的字符串；非法字节序列以 U+FFFD 替换
 */
export function utf8Decode(bytes: Uint8Array): string {
  let out = '';
  let index = 0;
  while (index < bytes.length) {
    const byte = bytes[index++] ?? 0;
    let codePoint: number;
    let extra: number;
    if (byte < 0x80) {
      out += String.fromCodePoint(byte);
      continue;
    } else if ((byte & 0xe0) === 0xc0) {
      codePoint = byte & 0x1f;
      extra = 1;
    } else if ((byte & 0xf0) === 0xe0) {
      codePoint = byte & 0x0f;
      extra = 2;
    } else if ((byte & 0xf8) === 0xf0) {
      codePoint = byte & 0x07;
      extra = 3;
    } else {
      out += '�';
      continue;
    }
    if (index + extra > bytes.length) {
      out += '�';
      break;
    }
    for (let i = 0; i < extra; i += 1) {
      const continuation = bytes[index++] ?? 0;
      if ((continuation & 0xc0) !== 0x80) {
        out += '�';
        codePoint = -1;
        break;
      }
      codePoint = (codePoint << 6) | (continuation & 0x3f);
    }
    out += codePoint >= 0 ? String.fromCodePoint(codePoint) : '�';
  }
  return out;
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * 把字节数组编码为标准 base64 字符串。
 *
 * 说明：核心层不依赖 DOM 的 `btoa` / Node 的 `Buffer`，以保证零 DOM 且跨端一致。
 *
 * @param bytes 待编码字节数组
 * @returns base64 字符串
 */
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1] ?? 0;
    const b2 = bytes[i + 2] ?? 0;
    const triple = (b0 << 16) | (b1 << 8) | b2;
    out += BASE64_ALPHABET[(triple >> 18) & 0x3f];
    out += BASE64_ALPHABET[(triple >> 12) & 0x3f];
    out += i + 1 < bytes.length ? BASE64_ALPHABET[(triple >> 6) & 0x3f] : '=';
    out += i + 2 < bytes.length ? BASE64_ALPHABET[triple & 0x3f] : '=';
  }
  return out;
}

/**
 * 把 base64 字符串解码为字节数组。
 *
 * @param base64 base64 字符串
 * @returns 字节数组
 * @throws {Error} 字符串含非法字符
 */
export function fromBase64(base64: string): Uint8Array {
  const cleaned = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((cleaned.length * 3) / 4));
  let outIndex = 0;
  for (let i = 0; i < cleaned.length; i += 4) {
    const c0 = BASE64_ALPHABET.indexOf(cleaned[i] ?? 'A');
    const c1 = BASE64_ALPHABET.indexOf(cleaned[i + 1] ?? 'A');
    const c2 = BASE64_ALPHABET.indexOf(cleaned[i + 2] ?? 'A');
    const c3 = BASE64_ALPHABET.indexOf(cleaned[i + 3] ?? 'A');
    const triple = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    if (outIndex < out.length) {
      out[outIndex++] = (triple >> 16) & 0xff;
    }
    if (outIndex < out.length) {
      out[outIndex++] = (triple >> 8) & 0xff;
    }
    if (outIndex < out.length) {
      out[outIndex++] = triple & 0xff;
    }
  }
  return out;
}

/**
 * 比较两个字节数组是否相等（长度与内容都相同）。
 *
 * @param a 字节数组 a
 * @param b 字节数组 b
 * @returns 相等返回 true
 */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}
