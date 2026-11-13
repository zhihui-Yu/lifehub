/**
 * 文件下载与本地存储目录管理工具。
 *
 * 架构位置：apps/web 的「工具」层。
 *
 * 说明：用于「下载盐值备份」「导出加密备份」「导出全部数据 (JSON / CSV)」等动作；
 * 支持在设置页自定义文件存储子目录（手机端写入 `Download/<子目录>`，桌面端支持系统文件夹选择器或直接写入绝对路径）。
 */

/** 本地文件存储目录在 localStorage 中的持久化键名。 */
export const FILE_STORAGE_DIR_KEY = 'lifehub:file-storage-dir:v1';

/** 默认文件存储子目录名称。 */
export const DEFAULT_STORAGE_DIR = 'LifeHub';

/** Android WebView 原生文件导出桥接接口（可选注入）。 */
interface AndroidFileBridge {
  saveTextFile?: (fileName: string, content: string, mimeType: string, subDir?: string) => void;
  /** 静默保存（数据变更自动落盘用）：成功不弹提示，同名文件覆盖。 */
  saveTextFileSilent?: (fileName: string, content: string, mimeType: string, subDir?: string) => void;
  pickDirectory?: () => void;
  migrateDirectory?: (fromSubDir: string, toSubDir: string) => void;
}

/** 浏览器 File System Access API 最小类型定义。 */
interface WebWritableFileStream {
  write: (data: string) => Promise<void>;
  close: () => Promise<void>;
}

interface WebFileHandle {
  createWritable: () => Promise<WebWritableFileStream>;
}

interface WebDirectoryHandle {
  name: string;
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<WebFileHandle>;
}

/** 桌面浏览器当前会话已授权的文件夹句柄（可选）。 */
let activeDirectoryHandle: WebDirectoryHandle | null = null;

/**
 * 判断是否在 Windows 桌面版容器（LifeHub Desktop）中运行。
 */
export function isWindowsDesktopRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const win = window as unknown as { __LIFEHUB_DESKTOP__?: boolean };
  return Boolean(win.__LIFEHUB_DESKTOP__);
}

/**
 * 清洗并规范化用户输入的存储目录名（兼容 Windows 盘符绝对路径如 `D:/LifeHubBackup` 与相对子目录如 `LifeHub/Backup`）。
 *
 * @param raw 原始输入目录字符串
 * @returns 安全的目录路径字符串
 */
export function sanitizeStorageDirectory(raw: string): string {
  const trimmed = (raw || '').trim().replace(/\\/g, '/').replace(/\.\.+/g, '');
  if (!trimmed) return '';

  // 识别 Windows 绝对盘符前缀（如 C:/ 或 D:/）
  const driveMatch = /^([A-Za-z]:)(\/.*)?$/.exec(trimmed);
  if (driveMatch && driveMatch[1]) {
    const drive = driveMatch[1].toUpperCase();
    const rest = (driveMatch[2] || '')
      .replace(/^\/+|\/+$/g, '')
      .replace(/[<>:"|?*]/g, '_')
      .replace(/\/{2,}/g, '/');
    return rest ? `${drive}/${rest}` : `${drive}/`;
  }

  return trimmed
    .replace(/^\/+|\/+$/g, '')
    .replace(/[<>:"|?*]/g, '_')
    .replace(/\/{2,}/g, '/');
}

/**
 * 读取当前配置的文件存储目录。
 *
 * @returns 当前生效的目录名称或完整路径（默认 `'LifeHub'`）
 */
export function getStorageDirectory(): string {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const saved = window.localStorage.getItem(FILE_STORAGE_DIR_KEY);
      if (saved !== null) {
        return sanitizeStorageDirectory(saved) || DEFAULT_STORAGE_DIR;
      }
    }
  } catch {
    // 忽略无 localStorage 权限环境
  }
  return DEFAULT_STORAGE_DIR;
}

/**
 * 将原文件存储目录下的所有 LifeHub 数据文件（`lifehub-*`、`*.json`、`*.csv`、`*.enc`）
 * 自动迁移复制至新目录，确保目录切换前后文件零断层。
 *
 * @param fromDir 原目录路径或子目录名
 * @param toDir 新目录路径或子目录名
 */
export function migrateStorageDirectoryFiles(fromDir: string, toDir: string): void {
  const cleanFrom = sanitizeStorageDirectory(fromDir) || DEFAULT_STORAGE_DIR;
  const cleanTo = sanitizeStorageDirectory(toDir) || DEFAULT_STORAGE_DIR;
  if (cleanFrom.toLowerCase() === cleanTo.toLowerCase()) {
    return;
  }

  // 1. Android 原生容器
  const bridge = (globalThis as { LifeHubAndroid?: AndroidFileBridge }).LifeHubAndroid;
  if (bridge && typeof bridge.migrateDirectory === 'function') {
    try {
      bridge.migrateDirectory(cleanFrom, cleanTo);
    } catch {
      // 忽略异常
    }
    return;
  }

  // 2. Windows 桌面版容器或本地开发/预览服务
  if (
    isWindowsDesktopRuntime() ||
    (typeof window !== 'undefined' &&
      (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost'))
  ) {
    void fetch('/__lifehub_desktop__/migrate-directory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromDir: cleanFrom, toDir: cleanTo }),
    }).catch(() => {
      // 忽略异常
    });
  }
}

/**
 * 保存自定义文件存储目录配置（若目录发生变化，自动将原目录下的历史备份与数据文件迁移至新目录）。
 *
 * @param dir 用户输入的目录名或路径（若为空白则重置为默认 `'LifeHub'`）
 * @returns 规范化后实际保存的目录名
 */
export function setStorageDirectory(dir: string): string {
  const previous = getStorageDirectory();
  const sanitized = sanitizeStorageDirectory(dir) || DEFAULT_STORAGE_DIR;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(FILE_STORAGE_DIR_KEY, sanitized);
    }
  } catch {
    // 忽略无 localStorage 权限环境
  }
  if (previous.toLowerCase() !== sanitized.toLowerCase()) {
    migrateStorageDirectoryFiles(previous, sanitized);
  }
  return sanitized;
}

/**
 * 通过隐藏 `<input type="file" webkitdirectory>` 兜底选择本地文件夹并提取目录名（适用于不支持或拒绝 `showDirectoryPicker` 的环境）。
 */
function pickDirectoryViaInputFallback(): Promise<string | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve(null);
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('directory', '');
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.style.opacity = '0';
    document.body.appendChild(input);

    let settled = false;
    const cleanup = () => {
      if (input.parentNode) {
        input.parentNode.removeChild(input);
      }
    };
    const finish = (val: string | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(val);
    };

    input.addEventListener('change', () => {
      const files = input.files;
      if (files && files.length > 0 && files[0]) {
        const rel = (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath || '';
        const folderName = rel.split('/')[0] || files[0].name;
        if (folderName) {
          finish(setStorageDirectory(folderName));
          return;
        }
      }
      finish(null);
    });

    input.addEventListener('cancel', () => {
      finish(null);
    });

    input.click();
  });
}

/**
 * 调起系统原生文件夹选择器（全面支持 Windows 桌面版 / 本地服务原生对话框、Android 原生目录选择器、现代浏览器 `showDirectoryPicker` 以及 `webkitdirectory` 兜底），支持无限次重复点击选择。
 *
 * @returns 选中的文件夹路径或名称；若用户取消则返回 null
 */
export async function pickWebDirectoryHandle(): Promise<string | null> {
  // 1. Android 原生文件夹选择器桥接（MainActivity.AndroidFileBridge.pickDirectory）
  const bridge = (globalThis as { LifeHubAndroid?: AndroidFileBridge }).LifeHubAndroid;
  if (bridge && typeof bridge.pickDirectory === 'function') {
    return new Promise<string | null>((resolve) => {
      let resolved = false;
      const handler = (ev: Event) => {
        if (resolved) return;
        resolved = true;
        window.removeEventListener('lifehub:android-dir-picked', handler);
        const detail = (ev as CustomEvent<{ path?: string }>).detail;
        if (detail?.path) {
          resolve(setStorageDirectory(detail.path));
        } else {
          resolve(null);
        }
      };
      window.addEventListener('lifehub:android-dir-picked', handler);
      try {
        bridge.pickDirectory?.();
      } catch {
        window.removeEventListener('lifehub:android-dir-picked', handler);
        resolve(null);
      }
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          window.removeEventListener('lifehub:android-dir-picked', handler);
          resolve(null);
        }
      }, 60_000);
    });
  }

  // 2. Windows 桌面版（LifeHub Desktop）或本地开发/预览服务原生文件夹选择对话框（返回完整绝对路径，如 D:/MyBackup）
  if (
    isWindowsDesktopRuntime() ||
    (typeof window !== 'undefined' &&
      (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost'))
  ) {
    try {
      const resp = await fetch('/__lifehub_desktop__/pick-directory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (resp.ok) {
        const contentType = resp.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const data = (await resp.json()) as { path?: string | null; cancelled?: boolean };
          if (data.path && data.path.trim().length > 0) {
            activeDirectoryHandle = null;
            return setStorageDirectory(data.path);
          }
          if (data.cancelled) {
            return null;
          }
        }
      }
    } catch {
      // 忽略并继续尝试浏览器原生 API
    }
  }

  // 3. 桌面浏览器 File System Access API (`window.showDirectoryPicker`)
  // 注意：不传 `id` 且先以默认参数调用，避免部分 Chromium 内核在第二次传入 `{ mode: 'readwrite' }` 时因权限状态异常而拒绝弹窗
  const win = globalThis as unknown as {
    showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<WebDirectoryHandle>;
  };
  if (typeof win.showDirectoryPicker === 'function') {
    try {
      const handle = await win.showDirectoryPicker();
      activeDirectoryHandle = handle;
      const saved = setStorageDirectory(handle.name);
      return saved;
    } catch (err) {
      // 若用户主动点击了「取消」(AbortError)，直接返回 null，不弹 fallback
      if (err instanceof DOMException && err.name === 'AbortError') {
        return null;
      }
      // 其他兼容性错误则降级到 input[webkitdirectory]
    }
  }

  // 4. 兜底：使用 `<input type="file" webkitdirectory>` 选择文件夹
  return pickDirectoryViaInputFallback();
}

/**
 * 获取当前桌面浏览器已挂载的本地文件夹句柄名称。
 *
 * @returns 文件夹名或 null
 */
export function getWebDirectoryHandleName(): string | null {
  return activeDirectoryHandle ? activeDirectoryHandle.name : null;
}

/**
 * 当任意业务模块的数据发生增删改时，将该模块的数据文件（如 `lifehub-bills.json`、`lifehub-schedule.json`、`lifehub-habits.json`、`lifehub-treehole.json`、`lifehub-categories.json`）
 * 实时静默落盘至用户已配置的文件存储目录，同时同步更新全量快照 `lifehub-auto-snapshot.json`。
 *
 * @param snapshotJson 序列化后的 JSON 字符串
 * @param moduleFileName 可选的模块专属文件名（默认 `'lifehub-auto-snapshot.json'`）
 */
export function syncAutoSnapshotToStorageDir(
  snapshotJson: string,
  moduleFileName = 'lifehub-auto-snapshot.json',
): void {
  const writeSingleFile = (targetName: string, text: string) => {
    const subDir = getStorageDirectory();

    // 1. Android 原生容器：优先走静默接口（不弹 Toast、覆盖同名文件），旧版 APK 回退到 saveTextFile
    const bridge = (globalThis as { LifeHubAndroid?: AndroidFileBridge }).LifeHubAndroid;
    if (bridge && typeof bridge.saveTextFileSilent === 'function') {
      try {
        bridge.saveTextFileSilent(targetName, text, 'application/json', subDir);
      } catch {
        // 忽略异常
      }
      return;
    }
    if (bridge && typeof bridge.saveTextFile === 'function') {
      try {
        bridge.saveTextFile(targetName, text, 'application/json', subDir);
      } catch {
        // 忽略异常
      }
      return;
    }

    // 2. Windows 桌面版容器或本地服务
    if (
      isWindowsDesktopRuntime() ||
      (typeof window !== 'undefined' &&
        (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost'))
    ) {
      void fetch('/__lifehub_desktop__/save-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: targetName, content: text, subDir }),
      }).catch(() => {
        // 忽略异常
      });
      return;
    }

    // 3. 桌面浏览器已授权文件夹句柄
    if (activeDirectoryHandle) {
      void activeDirectoryHandle
        .getFileHandle(targetName, { create: true })
        .then((fh) => fh.createWritable())
        .then(async (writable) => {
          await writable.write(text);
          await writable.close();
        })
        .catch(() => {
          // 忽略异常
        });
    }
  };

  writeSingleFile(moduleFileName, snapshotJson);
  if (moduleFileName !== 'lifehub-auto-snapshot.json') {
    writeSingleFile('lifehub-auto-snapshot.json', snapshotJson);
  }
}

/**
 * 触发浏览器、Windows 桌面版或 Android 原生容器下载一段文本内容至配置的文件存储目录。
 *
 * @param fileName 下载文件名
 * @param content 文本内容
 * @param mimeType MIME 类型，默认 'application/json'
 * @returns 无异常
 */
export function downloadText(fileName: string, content: string, mimeType = 'application/json'): void {
  const subDir = getStorageDirectory();

  // 1. Android 原生容器：调用 LifeHubAndroid.saveTextFile 直接写入手机 Download/<subDir>
  const bridge = (globalThis as { LifeHubAndroid?: AndroidFileBridge }).LifeHubAndroid;
  if (bridge && typeof bridge.saveTextFile === 'function') {
    bridge.saveTextFile(fileName, content, mimeType, subDir);
    return;
  }

  // 2. Windows 桌面版容器（或配置了盘符绝对路径时的本地服务）：直接通过本地原生服务落盘到用户设置的本地目录
  if (
    isWindowsDesktopRuntime() ||
    (/^[A-Za-z]:\//.test(subDir) &&
      typeof window !== 'undefined' &&
      (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost'))
  ) {
    void fetch('/__lifehub_desktop__/save-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName, content, subDir }),
    })
      .then((res) => {
        if (!res.ok) {
          triggerBrowserAnchorDownload(fileName, content, mimeType);
        }
      })
      .catch(() => {
        triggerBrowserAnchorDownload(fileName, content, mimeType);
      });
    return;
  }

  // 3. 桌面浏览器已授权文件夹句柄：直接写入该文件夹，不再重复触发浏览器默认下载弹窗
  if (activeDirectoryHandle) {
    void activeDirectoryHandle
      .getFileHandle(fileName, { create: true })
      .then((fh) => fh.createWritable())
      .then(async (writable) => {
        await writable.write(content);
        await writable.close();
      })
      .catch(() => {
        triggerBrowserAnchorDownload(fileName, content, mimeType);
      });
    return;
  }

  // 4. 普通浏览器默认下载兜底
  triggerBrowserAnchorDownload(fileName, content, mimeType);
}

/**
 * 浏览器 `<a download>` 标准下载触发器。
 */
function triggerBrowserAnchorDownload(fileName: string, content: string, mimeType: string): void {
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
