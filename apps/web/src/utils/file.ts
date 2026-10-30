/**
 * 文件读取工具。
 *
 * 架构位置：apps/web 的「工具」层。
 *
 * 说明：本轮读取全量字节（10MB 基准下完全够用）；
 * 若后续要支持更大文件，可在此处切换到 `File.stream()` 分块读取
 * （系统设计 §1.2 难点 4 预留了流式路径）。
 */

/**
 * 读取文件的全部字节。
 *
 * @param file 用户选择的文件
 * @returns 文件字节数组
 */
export async function readFileBytes(file: File): Promise<Uint8Array> {
  const buffer = await file.arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * 判断文件类型是否受支持。
 *
 * 说明：本轮只支持 CSV（A-25 的 Excel / PDF / txt 解析排在阶段 2）。
 *
 * @param file 待判断的文件
 * @returns 受支持返回 true
 */
export function isSupportedFileType(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith('.csv') || file.type === 'text/csv';
}
