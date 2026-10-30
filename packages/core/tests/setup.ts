/**
 * Vitest 全局 setup。
 *
 * 说明：core 包的测试全部在 Node 环境运行（零 DOM），这里只做必要的环境准备。
 */
import { beforeEach, vi } from 'vitest';

// 统一使用 UTC 时区，避免测试结果随机器本地时区变化而抖动。
process.env['TZ'] = 'UTC';

// 抑制未处理的 Promise 拒绝噪声（部分测试故意构造失败路径）。
process.on('unhandledRejection', () => undefined);

beforeEach(() => {
  vi.restoreAllMocks();
});
