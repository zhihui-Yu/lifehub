import { defineConfig } from 'vitest/config';

/**
 * packages/core 的 Vitest 配置。
 * 覆盖率门禁（NF-M-4）：核心层整体 ≥ 80%，加密 / CSV / 时间 / 金额四个目录要求 100%。
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    // 说明：限制并发 worker 数。
    // 原因：KDF 默认参数 scrypt N=32768（§8.2 KDF_DEFAULT_PARAMS）是**纯 CPU 密集**的，
    // 单次口令派生实测约 4.3s。测试文件共 30+ 个，其中近半会反复创建保险库，
    // 若让 Vitest 按 CPU 核数开满 worker（本机 16 核 → 31 个 worker），
    // 会出现「31 个进程同时抢 16 核」的 CPU 超订，每个 scrypt 都被拖慢到分钟级，
    // 最终以「测试超时」的形式失败 —— 实测同一份代码：
    //   不限制 worker → 351s，10 个用例因超时失败；
    //   限制为 4      →  33s，全部通过。
    // CI 的 GitHub runner 只有 2～4 核，超订问题只会比本地更严重，
    // 因此这里固定为 4（既能吃满典型 runner 的 CPU，又不会超订）。
    // 注意：这只影响**调度**，不放宽任何断言 —— 门禁强度不受影响。
    maxWorkers: 4,
    // 说明：放宽单测超时。
    // 原因：单次 scrypt 派生在 CI 机器上实测约 4.3s，一个用例可能连续做多次派生
    // （建保险库 + 解锁 + 轮换），累计耗时天然超过 Vitest 默认的 5s；
    // 开启覆盖率插桩或多个 worker 抢 CPU 时会更慢。
    // 与 apps/web/vitest.config.ts 的 testTimeout 取同一量级，保持两个包的行为一致。
    // 注意：这只放宽「超时上限」，不放宽任何断言 —— 门禁强度不受影响。
    testTimeout: 60_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/**/index.ts', 'src/crypto/providers/node-crypto-provider.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
        'src/money/**': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        'src/time/**': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        'src/crypto/**': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        'src/csv/**': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
      },
    },
  },
});
