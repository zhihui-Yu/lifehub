/**
 * 文件下载工具。
 *
 * 架构位置：apps/web 的「工具」层。
 *
 * 说明：用于「下载盐值备份」「导出加密备份」两个动作；
 * 下载内容是**密文或恢复码**，不包含任何明文业务数据。
 */

/** Android WebView 原生文件导出桥接接口（可选注入）。 */
interface AndroidFileBridge {
  saveTextFile?: (fileName: string, content: string, mimeType: string) => void;
}

/**
 * 触发浏览器或 Android 原生容器下载一段文本内容。
 *
 * @param fileName 下载文件名
 * @param content 文本内容
 * @param mimeType MIME 类型，默认 'application/json'
 * @returns 无异常
 */
export function downloadText(fileName: string, content: string, mimeType = 'application/json'): void {
  const bridge = (globalThis as { LifeHubAndroid?: AndroidFileBridge }).LifeHubAndroid;
  if (bridge && typeof bridge.saveTextFile === 'function') {
    bridge.saveTextFile(fileName, content, mimeType);
  }
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // 立即释放对象 URL，避免内存泄漏。
  URL.revokeObjectURL(url);
}

/**
 * 生成带日期的文件名。
 *
 * 说明：盐值备份与加密备份的文件名都含日期，便于用户识别（PRD UI-04 交互要点 3）。
 *
 * @param prefix 文件名前缀
 * @param extension 扩展名（含点）
 * @param date 日期，默认取今天
 * @returns 文件名
 */
export function buildDatedFileName(prefix: string, extension: string, date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${prefix}-${year}-${month}-${day}${extension}`;
}
