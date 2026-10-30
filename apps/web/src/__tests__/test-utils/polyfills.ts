/**
 * jsdom 环境补齐。
 *
 * 架构位置：apps/web 的「测试辅助」层（位于 `src/__tests__/test-utils/`，仅被测试文件引用，不参与生产构建）。
 *
 * 说明：jsdom 25 尚未实现 `Blob.prototype.arrayBuffer()` / `Blob.prototype.text()`
 * （真实浏览器 Chrome 76+ / Firefox 69+ / Safari 14+ 均已支持），
 * 而 Web 端的 `readFileBytes` 正是基于 `File.arrayBuffer()` 读取用户选择的 CSV。
 * 这里用 jsdom 已实现的 `FileReader` 补齐这两个方法，
 * **不改动任何生产代码**，也不改变真实浏览器下的行为。
 *
 * 注意：补齐后必须把 `Blob.prototype.arrayBuffer` 标记为不可枚举，
 * 否则会污染 `for...in` 遍历结果（部分断言库会因此看到多余属性）。
 */

/**
 * 用 FileReader 读取 Blob 内容为 ArrayBuffer。
 *
 * @returns 读取完成的 ArrayBuffer
 */
function readAsArrayBuffer(this: Blob): Promise<ArrayBuffer> {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(reader.result as ArrayBuffer);
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error('读取文件失败'));
    };
    reader.readAsArrayBuffer(this);
  });
}

/**
 * 用 FileReader 读取 Blob 内容为文本。
 *
 * @returns 读取完成的文本
 */
function readAsText(this: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(String(reader.result ?? ''));
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error('读取文件失败'));
    };
    reader.readAsText(this);
  });
}

if (typeof Blob !== 'undefined') {
  if (typeof Blob.prototype.arrayBuffer !== 'function') {
    Object.defineProperty(Blob.prototype, 'arrayBuffer', {
      value: readAsArrayBuffer,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }
  if (typeof Blob.prototype.text !== 'function') {
    Object.defineProperty(Blob.prototype, 'text', {
      value: readAsText,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }
}

/**
 * 补齐 `window.matchMedia`。
 *
 * 说明：jsdom 25 未实现 `matchMedia`（真实浏览器全部支持），
 * 而 `App.tsx` 的主题跟随逻辑会调用 `window.matchMedia('(prefers-color-scheme: dark)')`，
 * 缺失时会直接抛错。这里返回一个恒为「不匹配」的最小实现，
 * 保证测试环境下主题逻辑走「浅色」分支且不崩溃。
 */
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  });
}
