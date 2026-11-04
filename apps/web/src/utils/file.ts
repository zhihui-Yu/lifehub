/**
 * 文件读取工具。
 *
 * 架构位置：apps/web 的「工具」层。
 *
 * 说明：统一转发 `@/lib/import/file` 的文件类型识别与字节读取能力，
 * 保持 `@/utils/file` 与 `@/lib/import/file` 导出一致。
 */
export {
  SUPPORTED_EXTENSIONS,
  SUPPORTED_MIMES,
  detectFileType,
  isSupportedFileType,
  readFileBytes,
} from '@/lib/import/file';
export type { SupportedImportType } from '@/lib/import/file';
