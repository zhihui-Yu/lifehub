/**
 * 纯前端零外部依赖 ZIP 压缩包解析与解密工具（支持未加密 ZIP、PKWARE Traditional ZipCrypto 与 WinZip AES）。
 *
 * 架构位置：apps/web 的「导入」工具层。
 *
 * 说明：支付宝、微信及部分银行导出的电子账单常打包为加密或未加密的 `.zip` 压缩包（如支付宝 ZipCrypto 加密 CSV）。
 * 本模块在浏览器本地完成 Central Directory 解析、密码校验、流式解密、Deflate 解压与 CRC32 完整性核验，
 * 全程零网络请求、零外部第三方依赖。
 */
import { LifeHubError } from '@lifehub/core';

/**
 * 加密文件需要密码或密码错误异常。
 *
 * 说明：当用户上传加密的 PDF 或加密的 ZIP 压缩包且未提供密码或密码不匹配时抛出，
 * 供导入页捕获后弹出密码输入弹窗引导用户补填重试。
 *
 * @param message 中文错误提示
 * @param reason 触发原因（'need_password' 需要密码 | 'incorrect_password' 密码错误）
 * @param fileName 触发密码校验的文件名
 * @returns PasswordRequiredError 实例
 * @throws 无（异常类构造函数）
 */
export class PasswordRequiredError extends LifeHubError {
  /** 密码异常的具体原因：需要密码或密码错误。 */
  readonly reason: 'need_password' | 'incorrect_password';
  /** 触发该异常的文件名称。 */
  readonly fileName?: string;

  /**
   * 构造加密文件密码异常。
   *
   * @param message 中文错误消息
   * @param reason 原因枚举（需要密码或密码错误）
   * @param fileName 关联文件名
   * @returns PasswordRequiredError 实例
   * @throws 无
   */
  constructor(
    message: string,
    reason: 'need_password' | 'incorrect_password',
    fileName?: string,
  ) {
    super('LIFEHUB_E_IMPORT_PARSE_FAILED', message, { reason, fileName });
    Object.setPrototypeOf(this, PasswordRequiredError.prototype);
    this.name = 'PasswordRequiredError';
    this.reason = reason;
    this.fileName = fileName;
  }
}

/**
 * 判断未知异常是否为 `PasswordRequiredError`。
 *
 * 说明：兼容跨模块实例检测，支持 `instanceof` 或基于 `name === 'PasswordRequiredError'` 的结构化判定。
 *
 * @param err 待判定的异常对象
 * @returns 若为密码异常返回 true，否则返回 false
 * @throws 无（纯类型守卫函数）
 */
export function isPasswordRequiredError(err: unknown): err is PasswordRequiredError {
  if (err instanceof PasswordRequiredError) {
    return true;
  }
  if (!err || typeof err !== 'object') {
    return false;
  }
  const candidate = err as { name?: unknown; reason?: unknown };
  return (
    candidate.name === 'PasswordRequiredError' &&
    (candidate.reason === 'need_password' || candidate.reason === 'incorrect_password')
  );
}

/** 标准 CRC32 查找表（IEEE 802.3 多项式 0xEDB88320）。 */
const CRC32_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : (c >>> 1) >>> 0;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

/** 单步更新 CRC32 寄存器。 */
function crc32Update(crc: number, byte: number): number {
  const idx = (crc ^ byte) & 0xff;
  return ((crc >>> 8) ^ (CRC32_TABLE[idx] ?? 0)) >>> 0;
}

/**
 * 计算字节数组的 CRC32 校验值。
 *
 * 说明：用于核验解压后的明文数据完整性以及检测传统 ZipCrypto 密码是否正确。
 *
 * @param bytes 待计算的字节数组
 * @returns 无符号 32 位 CRC32 整数
 * @throws 无（纯计算函数）
 */
export function computeCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = crc32Update(crc, bytes[i] ?? 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** PKWARE Traditional ZipCrypto 流密码状态机。 */
class ZipCryptoCipher {
  private k0 = 0x12345678;
  private k1 = 0x23456789;
  private k2 = 0x34567890;

  constructor(passwordBytes: Uint8Array) {
    for (let i = 0; i < passwordBytes.length; i += 1) {
      this.updateKeys(passwordBytes[i] ?? 0);
    }
  }

  private updateKeys(byte: number): void {
    this.k0 = crc32Update(this.k0, byte);
    this.k1 = (this.k1 + (this.k0 & 0xff)) >>> 0;
    this.k1 = (Math.imul(this.k1, 134775813) + 1) >>> 0;
    this.k2 = crc32Update(this.k2, (this.k1 >>> 24) & 0xff);
  }

  private decryptByte(): number {
    const temp = (this.k2 | 2) & 0xffff;
    return (Math.imul(temp, temp ^ 1) >>> 8) & 0xff;
  }

  decrypt(input: Uint8Array): Uint8Array {
    const out = new Uint8Array(input.length);
    for (let i = 0; i < input.length; i += 1) {
      const plain = ((input[i] ?? 0) ^ this.decryptByte()) & 0xff;
      this.updateKeys(plain);
      out[i] = plain;
    }
    return out;
  }
}

/** 解码 ZIP 条目文件名（兼容 UTF-8 与中文 Windows GB18030/GBK）。 */
function decodeZipFileName(nameBytes: Uint8Array, isUtf8Flag: boolean): string {
  if (isUtf8Flag) {
    return new TextDecoder('utf-8').decode(nameBytes);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(nameBytes);
  } catch {
    try {
      return new TextDecoder('gb18030').decode(nameBytes);
    } catch {
      return new TextDecoder('utf-8').decode(nameBytes);
    }
  }
}

/** 根据文件名后缀推断 MIME 类型。 */
function inferMimeFromName(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.tsv') || lower.endsWith('.txt')) {
    return 'text/csv';
  }
  if (lower.endsWith('.xlsx')) {
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
  if (lower.endsWith('.xls')) {
    return 'application/vnd.ms-excel';
  }
  if (lower.endsWith('.pdf')) {
    return 'application/pdf';
  }
  if (lower.endsWith('.json')) {
    return 'application/json';
  }
  return 'application/octet-stream';
}

/** 判断压缩包内条目文件名是否为受支持的账单文件。 */
function isSupportedInnerBillFileName(entryPath: string): boolean {
  const normalized = entryPath.replace(/\\/g, '/');
  if (
    normalized.endsWith('/') ||
    normalized.startsWith('__MACOSX/') ||
    normalized.includes('/__MACOSX/') ||
    normalized.endsWith('.DS_Store')
  ) {
    return false;
  }
  const base = normalized.split('/').pop() ?? '';
  if (!base || base.startsWith('._')) {
    return false;
  }
  const lower = base.toLowerCase();
  return (
    lower.endsWith('.csv') ||
    lower.endsWith('.tsv') ||
    lower.endsWith('.txt') ||
    lower.endsWith('.xlsx') ||
    lower.endsWith('.xls') ||
    lower.endsWith('.pdf') ||
    lower.endsWith('.json')
  );
}

/** 使用浏览器原生 DecompressionStream('deflate-raw') 解压 Deflate 原始字节流。 */
async function inflateRawBytes(compressed: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new LifeHubError('LIFEHUB_E_IMPORT_PARSE_FAILED', '当前运行环境不支持 ZIP 解压流');
  }
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  const writePromise = writer
    .write(new Uint8Array(compressed))
    .then(() => writer.close())
    .catch(() => {
      // 读取端会统一捕获流解压异常
    });

  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        chunks.push(value);
        totalLength += value.length;
      }
    }
  } finally {
    await writePromise;
  }

  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/** 解析 WinZip AES 扩展字段（Header ID 0x9901）。 */
function parseWinZipAesExtra(extra: Uint8Array): {
  aeVersion: number;
  strength: number;
  actualMethod: number;
} | null {
  const view = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
  let pos = 0;
  while (pos + 4 <= extra.byteLength) {
    const headerId = view.getUint16(pos, true);
    const dataSize = view.getUint16(pos + 2, true);
    if (headerId === 0x9901 && pos + 4 + dataSize <= extra.byteLength && dataSize >= 7) {
      const aeVersion = view.getUint16(pos + 4, true);
      const strength = extra[pos + 8] ?? 3;
      const actualMethod = view.getUint16(pos + 9, true);
      return { aeVersion, strength, actualMethod };
    }
    pos += 4 + dataSize;
  }
  return null;
}

/** 解密 WinZip AES (AE-1 / AE-2) 加密条目载荷。 */
async function decryptWinZipAes(
  encryptedPayload: Uint8Array,
  password: string,
  strength: number,
  zipFileName?: string,
): Promise<Uint8Array> {
  const saltLen = strength === 1 ? 8 : strength === 2 ? 12 : 16;
  const keyLen = strength === 1 ? 16 : strength === 2 ? 24 : 32;
  const authLen = 10;
  const pwdVerifyLen = 2;

  if (encryptedPayload.length < saltLen + pwdVerifyLen + authLen) {
    throw new LifeHubError('LIFEHUB_E_IMPORT_PARSE_FAILED', '压缩包加密载荷长度异常');
  }

  const salt = encryptedPayload.subarray(0, saltLen);
  const pwdVerifyExpected = encryptedPayload.subarray(saltLen, saltLen + pwdVerifyLen);
  const cipherText = encryptedPayload.subarray(
    saltLen + pwdVerifyLen,
    encryptedPayload.length - authLen,
  );

  const pwdBytes = new TextEncoder().encode(password);
  const baseKey = await crypto.subtle.importKey('raw', pwdBytes, 'PBKDF2', false, ['deriveBits']);
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: new Uint8Array(salt),
      iterations: 1000,
      hash: 'SHA-1',
    },
    baseKey,
    (keyLen * 2 + pwdVerifyLen) * 8,
  );
  const derived = new Uint8Array(derivedBits);
  const aesKeyBytes = derived.subarray(0, keyLen);
  const pwdVerifyActual = derived.subarray(keyLen * 2, keyLen * 2 + pwdVerifyLen);

  if (
    pwdVerifyActual[0] !== pwdVerifyExpected[0] ||
    pwdVerifyActual[1] !== pwdVerifyExpected[1]
  ) {
    throw new PasswordRequiredError('压缩包密码错误，请重新输入', 'incorrect_password', zipFileName);
  }

  // WinZip AES 使用小端序（Little-Endian）块计数器（从 1 开始），按 16 字节分块转换到 WebCrypto 标准大端计数器
  const aesKey = await crypto.subtle.importKey('raw', aesKeyBytes, { name: 'AES-CBC' }, false, [
    'encrypt',
  ]);
  const out = new Uint8Array(cipherText.length);
  const blockCount = Math.ceil(cipherText.length / 16);
  const zeroIv = new Uint8Array(16);

  for (let b = 0; b < blockCount; b += 1) {
    const counterBlock = new Uint8Array(16);
    let counter = b + 1;
    for (let j = 0; j < 8 && counter > 0; j += 1) {
      counterBlock[j] = counter & 0xff;
      counter = Math.floor(counter / 256);
    }
    const keystreamBlock = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-CBC', iv: zeroIv }, aesKey, counterBlock),
    );
    const offset = b * 16;
    const rem = Math.min(16, cipherText.length - offset);
    for (let i = 0; i < rem; i += 1) {
      out[offset + i] = (cipherText[offset + i] ?? 0) ^ (keystreamBlock[i] ?? 0);
    }
  }
  return out;
}

/**
 * 从 ZIP 压缩包字节中解密并解压出所有受支持的账单文件。
 *
 * 说明：
 * 1. 自动从末尾逆向定位 End of Central Directory (`0x06054b50`) 并遍历 Central Directory (`0x02014b50`)；
 * 2. 若检测到条目加密标志（`flags & 0x0001`）：
 *    - 未传入密码时立即抛出 `PasswordRequiredError('need_password')`；
 *    - 支持支付宝等广泛使用的 PKWARE Traditional ZipCrypto 流式解密及 WinZip AES 解密；
 *    - 密码校验字节或解压后 CRC32 不匹配时立即抛出 `PasswordRequiredError('incorrect_password')`；
 * 3. 返回解压还原后的标准 `File[]` 数组，可直接交由 `buildImportSource` 进入单文件或批量导入管线。
 *
 * @param zipBytes ZIP 压缩包原始字节数组
 * @param password 可选的解压密码（未加密压缩包无需传入）
 * @param zipFileName 压缩包文件名（用于错误提示）
 * @returns 解压出的账单文件列表
 * @throws {PasswordRequiredError} 当压缩包已加密但未提供密码或密码错误时抛出
 * @throws {LifeHubError} 当压缩包损坏或内部不包含任何受支持账单文件时抛出
 */
export async function extractZipFiles(
  zipBytes: Uint8Array,
  password?: string,
  zipFileName?: string,
): Promise<File[]> {
  if (zipBytes.byteLength < 22) {
    throw new LifeHubError('LIFEHUB_E_IMPORT_PARSE_FAILED', '无效的 ZIP 压缩包文件');
  }
  const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);

  // 逆向扫描 End of Central Directory (EOCD: 0x06054b50)
  let eocdOffset = -1;
  const minEocdOffset = Math.max(0, zipBytes.byteLength - 65557);
  for (let pos = zipBytes.byteLength - 22; pos >= minEocdOffset; pos -= 1) {
    if (view.getUint32(pos, true) === 0x06054b50) {
      eocdOffset = pos;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new LifeHubError('LIFEHUB_E_IMPORT_PARSE_FAILED', '无法识别的 ZIP 压缩包结构');
  }

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);

  let ptr = cdOffset;
  const extractedFiles: File[] = [];

  for (let i = 0; i < totalEntries && ptr + 46 <= zipBytes.byteLength; i += 1) {
    const sig = view.getUint32(ptr, true);
    if (sig !== 0x02014b50) {
      break;
    }
    const flags = view.getUint16(ptr + 8, true);
    const compressionMethod = view.getUint16(ptr + 10, true);
    const dosTime = view.getUint16(ptr + 12, true);
    const crc32Expected = view.getUint32(ptr + 16, true);
    const compressedSize = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localHeaderOffset = view.getUint32(ptr + 42, true);

    const nameBytes = zipBytes.subarray(ptr + 46, ptr + 46 + nameLen);
    const cdExtraBytes = zipBytes.subarray(ptr + 46 + nameLen, ptr + 46 + nameLen + extraLen);
    const entryName = decodeZipFileName(nameBytes, (flags & 0x0800) !== 0);

    ptr += 46 + nameLen + extraLen + commentLen;

    if (!isSupportedInnerBillFileName(entryName)) {
      continue;
    }

    if (localHeaderOffset + 30 > zipBytes.byteLength) {
      throw new LifeHubError('LIFEHUB_E_IMPORT_PARSE_FAILED', '压缩包本地文件头偏移越界');
    }
    const localSig = view.getUint32(localHeaderOffset, true);
    if (localSig !== 0x04034b50) {
      throw new LifeHubError('LIFEHUB_E_IMPORT_PARSE_FAILED', '压缩包本地文件头签名损坏');
    }
    const localNameLen = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const localExtraBytes = zipBytes.subarray(
      localHeaderOffset + 30 + localNameLen,
      localHeaderOffset + 30 + localNameLen + localExtraLen,
    );
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > zipBytes.byteLength) {
      throw new LifeHubError('LIFEHUB_E_IMPORT_PARSE_FAILED', '压缩包文件数据区越界');
    }

    const rawPayload = zipBytes.subarray(dataStart, dataEnd);
    const isEncrypted = (flags & 0x0001) !== 0;
    let actualMethod = compressionMethod;
    let compressedStream = rawPayload;
    let skipCrcCheck = false;

    if (isEncrypted) {
      if (!password || password.length === 0) {
        throw new PasswordRequiredError(
          '该压缩包已加密，请输入解压密码',
          'need_password',
          zipFileName,
        );
      }

      if (compressionMethod === 99) {
        const aesInfo =
          parseWinZipAesExtra(localExtraBytes) ?? parseWinZipAesExtra(cdExtraBytes) ?? {
            aeVersion: 2,
            strength: 3,
            actualMethod: 8,
          };
        actualMethod = aesInfo.actualMethod;
        skipCrcCheck = aesInfo.aeVersion === 2 && crc32Expected === 0;
        compressedStream = await decryptWinZipAes(
          rawPayload,
          password,
          aesInfo.strength,
          zipFileName,
        );
      } else {
        if (rawPayload.byteLength < 12) {
          throw new LifeHubError('LIFEHUB_E_IMPORT_PARSE_FAILED', '压缩包加密头长度不足');
        }
        const pwdBytes = new TextEncoder().encode(password);
        const cipher = new ZipCryptoCipher(pwdBytes);
        const decHeader = cipher.decrypt(rawPayload.subarray(0, 12));
        const checkByte = decHeader[11] ?? 0;
        const expectedTimeByte = (dosTime >>> 8) & 0xff;
        const expectedCrcByte = (crc32Expected >>> 24) & 0xff;
        const validCheck =
          (flags & 0x0008) !== 0
            ? checkByte === expectedTimeByte || checkByte === expectedCrcByte
            : checkByte === expectedCrcByte || checkByte === expectedTimeByte;
        if (!validCheck) {
          throw new PasswordRequiredError(
            '压缩包密码错误，请重新输入',
            'incorrect_password',
            zipFileName,
          );
        }
        compressedStream = cipher.decrypt(rawPayload.subarray(12));
      }
    }

    let uncompressedBytes: Uint8Array;
    if (actualMethod === 0) {
      uncompressedBytes = new Uint8Array(compressedStream);
    } else if (actualMethod === 8) {
      try {
        uncompressedBytes = await inflateRawBytes(compressedStream);
      } catch {
        if (isEncrypted) {
          throw new PasswordRequiredError(
            '压缩包密码错误，请重新输入',
            'incorrect_password',
            zipFileName,
          );
        }
        throw new LifeHubError('LIFEHUB_E_IMPORT_PARSE_FAILED', '压缩包解压失败，文件可能已损坏');
      }
    } else {
      throw new LifeHubError(
        'LIFEHUB_E_IMPORT_PARSE_FAILED',
        `不支持的 ZIP 压缩算法（method=${String(actualMethod)}）`,
      );
    }

    if (!skipCrcCheck) {
      const actualCrc = computeCrc32(uncompressedBytes);
      if (actualCrc !== crc32Expected) {
        if (isEncrypted) {
          throw new PasswordRequiredError(
            '压缩包密码错误，请重新输入',
            'incorrect_password',
            zipFileName,
          );
        }
        throw new LifeHubError(
          'LIFEHUB_E_IMPORT_PARSE_FAILED',
          '压缩包文件损坏，CRC32 校验失败',
        );
      }
    }

    const baseName = entryName.replace(/\\/g, '/').split('/').pop() ?? entryName;
    const mimeType = inferMimeFromName(baseName);
    extractedFiles.push(
      new File([new Uint8Array(uncompressedBytes)], baseName, { type: mimeType }),
    );
  }

  if (extractedFiles.length === 0) {
    throw new LifeHubError(
      'LIFEHUB_E_IMPORT_PARSE_FAILED',
      '压缩包内未找到受支持的账单文件（支持 CSV / Excel / PDF / JSON）',
    );
  }

  return extractedFiles;
}
