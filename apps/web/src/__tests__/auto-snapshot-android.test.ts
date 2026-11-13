/**
 * 自动落盘（syncAutoSnapshotToStorageDir）在 Android 容器下的行为测试：
 * 数据变更后的自动保存必须走静默接口，不能每次都弹「已保存至…」提示。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { syncAutoSnapshotToStorageDir } from '@/utils/download';

type Bridge = Record<string, ReturnType<typeof vi.fn>>;
const g = globalThis as unknown as { LifeHubAndroid?: Bridge };

afterEach(() => {
  delete g.LifeHubAndroid;
});

describe('syncAutoSnapshotToStorageDir（Android）', () => {
  it('优先调用 saveTextFileSilent，不调用会弹 Toast 的 saveTextFile', () => {
    const bridge = { saveTextFile: vi.fn(), saveTextFileSilent: vi.fn() };
    g.LifeHubAndroid = bridge;

    syncAutoSnapshotToStorageDir('{"a":1}', 'lifehub-bills.json');

    expect(bridge.saveTextFile).not.toHaveBeenCalled();
    expect(bridge.saveTextFileSilent).toHaveBeenCalledTimes(2);
    expect(bridge.saveTextFileSilent.mock.calls.map((c) => c[0])).toEqual([
      'lifehub-bills.json',
      'lifehub-auto-snapshot.json',
    ]);
  });

  it('旧版 APK 没有静默接口时回退到 saveTextFile', () => {
    const bridge = { saveTextFile: vi.fn() };
    g.LifeHubAndroid = bridge;

    syncAutoSnapshotToStorageDir('{}');

    expect(bridge.saveTextFile).toHaveBeenCalledTimes(1);
  });
});
