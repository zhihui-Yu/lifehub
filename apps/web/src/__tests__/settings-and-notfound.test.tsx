/**
 * 设置页与 404 页测试。
 *
 * 覆盖需求：PRD §5.5「基础设置」（时区 / 币种 / 周起始日），
 * 以及路由兜底：未匹配的路径展示 404 页面而不是白屏。
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { HomeIndexRoute } from '@/components/layout/HomeIndexRoute';
import {
  createDefaultCloudConfig,
  decryptCloudSourceJson,
  loadCloudConfig,
  restoreBillsFromCloud,
  uploadBillsToCloud,
} from '@/lib/cloud-storage';
import { useBillStore } from '@/store';
import { useSettingsStore } from '@/store/settings-store';
import { makeBill } from '@/__tests__/test-utils/fixtures';
import { LocationProbe } from '@/__tests__/test-utils/render';

vi.mock('@/hooks/useVault', () => ({
  useVault: () => ({
    status: 'unlocked',
    vaultCreated: true,
    error: null,
    failedAttempts: 0,
    recoveryBundle: null,
    runtime: {
      billRepository: { put: vi.fn(async () => undefined) },
    },
    dekProvider: {
      isUnlocked: () => true,
      setDek: vi.fn(),
      clear: vi.fn(),
    },
    createVault: vi.fn(),
    unlock: vi.fn(),
    unlockWithRecoveryCode: vi.fn(),
    regenerateRecoveryCode: vi.fn(),
    lock: vi.fn(),
  }),
}));

describe('SettingsPage', () => {
  beforeEach(() => {
    useSettingsStore.getState().hydrate({
      timezone: 'Asia/Shanghai',
      currency: 'CNY',
      theme: 'system',
      weekStart: 1,
      locale: 'zh-CN',
    });
  });

  it('渲染基础设置表单并回显当前设置，默认锁定北京时间与人民币，移除币种与周起始日，仅保留外观主题与云存储模块', () => {
    render(<SettingsPage />);

    expect(screen.getByTestId('settings-page')).toBeInTheDocument();
    expect(screen.queryByTestId('security-master-toggle-card')).not.toBeInTheDocument();
    expect(screen.getByTestId('cloud-storage-panel')).toBeInTheDocument();

    const basicCard = screen.getByTestId('basic-settings-card');
    expect(basicCard).toBeInTheDocument();
    expect(basicCard).toHaveStyle({ width: '100%' });

    expect(screen.getByTestId('default-timezone-chip')).toHaveTextContent(
      '默认时区：北京时间 (Asia/Shanghai)',
    );
    expect(screen.queryByLabelText('默认币种')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('一周起始日')).not.toBeInTheDocument();
    expect(screen.getByLabelText('外观主题')).toHaveTextContent('跟随系统');
    expect(useSettingsStore.getState().timezone).toBe('Asia/Shanghai');
    expect(useSettingsStore.getState().currency).toBe('CNY');
  });

  it('切换外观主题会写回 settings-store', () => {
    render(<SettingsPage />);

    const select = screen.getByLabelText('外观主题');
    fireEvent.mouseDown(select);
    fireEvent.click(screen.getByRole('option', { name: '深色模式' }));

    expect(useSettingsStore.getState().theme).toBe('dark');
  });

  it('支持通过下拉框切换 5 大主流云存储服务商、测试连接、强制使用登录密码加密上传及凭登录密码恢复账单与还原源文件内容', async () => {
    window.localStorage.clear();
    useBillStore.getState().setBills([
      makeBill({ id: 'cloud-b1', counterparty: '云端咖啡店', amountMinor: 4200 }),
    ]);

    render(<SettingsPage />);

    // 1. 顶部模式徽标固定展示「强制加密上传（登录密码保护）」
    expect(screen.getByTestId('cloud-upload-mode-chip')).toHaveTextContent(
      '强制加密上传（登录密码保护）',
    );

    // 切换至坚果云 WebDAV 并测试连接（通过下拉框选择，不再冗余渲染厂商卡片）
    expect(screen.queryByTestId('cloud-provider-option-jianguoyun-webdav')).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId('cloud-provider-select'), {
      target: { value: 'jianguoyun-webdav' },
    });
    expect(screen.getByTestId('cloud-endpoint-input')).toHaveValue(
      'https://dav.jianguoyun.com/dav/',
    );
    fireEvent.click(screen.getByTestId('cloud-test-button'));
    expect(await screen.findByTestId('cloud-action-banner')).toHaveTextContent(
      '已成功连接「坚果云 WebDAV」',
    );

    // 2. 输入登录密码并点击上传，生成 .json.enc 加密快照
    const passwordInput = screen.getByTestId('cloud-encryption-password-input');
    fireEvent.change(passwordInput, { target: { value: 'MyLoginPass#2026' } });
    fireEvent.click(screen.getByTestId('cloud-upload-button'));
    expect(screen.getByTestId('cloud-sync-status')).toHaveTextContent(
      '强制加密上传（登录密码保护）',
    );
    expect(screen.getByTestId('cloud-sync-status')).toHaveTextContent(
      'LifeHubBackup/lifehub-backup.json.enc',
    );

    // 清空本地账单，准备测试云端拉取恢复与源文件还原
    act(() => {
      useBillStore.getState().setBills([]);
    });
    expect(useBillStore.getState().bills).toHaveLength(0);

    // 3. 输入错误密码时，「从云端拉取恢复」与「用登录密码还原源文件内容」均被拦截报错
    fireEvent.change(passwordInput, { target: { value: 'WrongPassword999' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('cloud-restore-button'));
    });
    expect(await screen.findByTestId('cloud-action-banner')).toHaveTextContent('登录密码错误');
    expect(useBillStore.getState().bills).toHaveLength(0);

    fireEvent.click(screen.getByTestId('cloud-decrypt-source-button'));
    expect(await screen.findByTestId('cloud-action-banner')).toHaveTextContent('登录密码错误');
    expect(screen.queryByTestId('cloud-decrypted-source-preview')).not.toBeInTheDocument();

    // 4. 输入正确登录密码后，可成功恢复账单并还原出完整可读的 JSON 源文件内容
    fireEvent.change(passwordInput, { target: { value: 'MyLoginPass#2026' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('cloud-restore-button'));
    });
    await waitFor(() => {
      expect(useBillStore.getState().bills).toHaveLength(1);
    });
    expect(useBillStore.getState().bills[0]?.counterparty).toBe('云端咖啡店');

    fireEvent.click(screen.getByTestId('cloud-decrypt-source-button'));
    const preview = await screen.findByTestId('cloud-decrypted-source-preview');
    expect(preview).toHaveTextContent('lifehub-cloud-backup-v1');
    expect(preview).toHaveTextContent('云端咖啡店');
    expect(screen.getByTestId('cloud-download-source-button')).toBeInTheDocument();
  });

  it('展示移动端快捷功能中心（导入账单 / 分类管理 / 习惯打卡）并支持一键跳转，不再暴露多余的安全与加密入口', () => {
    render(<SettingsPage />);

    expect(screen.getByTestId('mobile-quick-hub-card')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-settings-quick-nav')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('quick-nav-import'));
    expect(window.location.hash).toBe('#/import');

    fireEvent.click(screen.getByTestId('quick-nav-categories'));
    expect(window.location.hash).toBe('#/categories');

    fireEvent.click(screen.getByTestId('quick-nav-habits'));
    expect(window.location.hash).toBe('#/habits');

    expect(screen.queryByTestId('quick-nav-security')).not.toBeInTheDocument();
  });

  it('支持在设置页一键导出全部数据（JSON）与通用账单表格（CSV），方便迁移至其他应用', async () => {
    const createObjectURLSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:http://localhost/mock-export');
    const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    useBillStore.getState().setBills([
      makeBill({ id: 'exp-b1', counterparty: '迁移测试书店', amountMinor: 5600 }),
    ]);

    render(<SettingsPage />);

    expect(screen.getByTestId('data-export-card')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('export-all-json-button'));
    expect(await screen.findByTestId('data-export-banner')).toHaveTextContent(
      '已导出全量数据 lifehub-all-data-',
    );

    fireEvent.click(screen.getByTestId('export-bills-csv-button'));
    await waitFor(() => {
      expect(screen.getByTestId('data-export-banner')).toHaveTextContent(
        '已导出通用账单表格 lifehub-bills-',
      );
    });

    createObjectURLSpy.mockRestore();
    revokeObjectURLSpy.mockRestore();
  });

  it('支持全量生活数据（账单 + 分类 + 课表 + 习惯 + 完成事件）一并加密进入 OSS 备份并完整还原，且严禁包含 aiSettings', () => {
    window.localStorage.clear();
    const config = createDefaultCloudConfig('aliyun-oss');
    const bills = [makeBill({ id: 'oss-b1', counterparty: '全量超市', amountMinor: 8800 })];
    const categories = [
      {
        id: 'cat-custom-1',
        name: '数码订阅',
        kind: 'expense' as const,
        parentId: null,
        color: '#6366F1',
        icon: 'subscriptions',
        isSystem: false,
        sortOrder: 10,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        version: 1,
        deviceId: 'dev-1',
      },
    ];
    const scheduleSlots = [
      {
        id: 'slot-1',
        title: '晨间英语精读',
        startTime: '08:00',
        endTime: '09:00',
        dayOfWeek: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ];
    const habits = [
      {
        id: 'habit-1',
        name: '每日八杯水',
        unit: '杯',
        targetPerPeriod: 8,
        color: '#16A34A',
        icon: '💧',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ];
    const habitCheckIns = [
      {
        id: 'habit:habit-1:2026-11-03',
        habitId: 'habit-1',
        localDate: '2026-11-03',
        completedAt: '2026-11-03T01:00:00.000Z',
      },
    ];
    const completionEvents = [
      {
        id: 'schedule:slot-1:2026-11-03',
        sourceType: 'schedule' as const,
        sourceId: 'slot-1',
        localDate: '2026-11-03',
        createdAt: '2026-11-03T01:00:00.000Z',
      },
    ];

    const syncRecord = uploadBillsToCloud(config, bills, 'VaultSecret#2026', {
      categories,
      scheduleSlots,
      habits,
      habitCheckIns,
      completionEvents,
    });

    expect(syncRecord.billCount).toBe(1);
    expect(syncRecord.categoryCount).toBe(1);
    expect(syncRecord.scheduleCount).toBe(1);
    expect(syncRecord.habitCount).toBe(1);

    const { rawJson } = decryptCloudSourceJson(config, 'VaultSecret#2026');
    expect(rawJson).not.toContain('aiSettings');
    expect(rawJson).not.toContain('apiKey');

    const restored = restoreBillsFromCloud(config, 'VaultSecret#2026');
    expect(restored.bills).toHaveLength(1);
    expect(restored.categories).toHaveLength(1);
    expect(restored.categories[0]?.name).toBe('数码订阅');
    expect(restored.scheduleSlots).toHaveLength(1);
    expect(restored.scheduleEvents).toHaveLength(1);
    expect(restored.scheduleSlots[0]?.title).toBe('晨间英语精读');
    expect(restored.habits).toHaveLength(1);
    expect(restored.habits[0]?.name).toBe('每日八杯水');
    expect(restored.habitCheckIns).toHaveLength(1);
    expect(restored.habitCheckins).toHaveLength(1);
    expect(restored.completionEvents).toHaveLength(1);
    expect(restored.scheduleCompletions).toHaveLength(1);
  });

  it('强制校验加密密码必填、自动记住密码免手输，且拦截误改密码覆盖（勾选允许更换后放行）', () => {
    window.localStorage.clear();
    const config = createDefaultCloudConfig('aliyun-oss');
    const bills = [makeBill({ id: 'pwd-b1', counterparty: '密码校验商店', amountMinor: 3500 })];

    // 1. 空密码上传直接报错拦截
    expect(() => uploadBillsToCloud(config, bills, '   ')).toThrow(/加密密码为必填项/);

    // 2. 首次使用 PasswordA 上传成功，且默认记住密码（本地混淆存储，读取时自动还原）
    const rec1 = uploadBillsToCloud(config, bills, 'PasswordA#2026');
    expect(rec1.passwordFingerprint).toBeTruthy();
    expect(typeof rec1.sizeBytes).toBe('number');
    expect(loadCloudConfig().savedPassword).toBe('PasswordA#2026');

    // 3. 第二次若误输为不一致的 PasswordB 且未开启 allowPasswordChange，则主动拦截报错
    expect(() => uploadBillsToCloud(config, bills, 'PasswordB#9999')).toThrow(
      /与上次云端备份密码不一致/,
    );

    // 4. 勾选 allowPasswordChange: true 后允许更换新密码覆盖
    const rec2 = uploadBillsToCloud(config, bills, 'PasswordB#9999', undefined, {
      allowPasswordChange: true,
    });
    expect(rec2.passwordFingerprint).not.toBe(rec1.passwordFingerprint);
    const restored = restoreBillsFromCloud(loadCloudConfig());
    expect(restored.bills[0]?.counterparty).toBe('密码校验商店');
  });

  it('HomeIndexRoute 在手机窄屏（<= 900px）打开根路径 / 时自动重定向至 /bills', () => {
    const originalInnerWidth = window.innerWidth;
    window.location.hash = '#/';
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 390,
    });

    try {
      render(
        <MemoryRouter initialEntries={['/']}>
          <HomeIndexRoute />
          <LocationProbe />
        </MemoryRouter>,
      );
      expect(screen.getByTestId('location-pathname')).toHaveTextContent('/bills');
    } finally {
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        writable: true,
        value: originalInnerWidth,
      });
    }
  });
});

describe('NotFoundPage', () => {
  it('未匹配的路径展示 404 提示与返回入口', () => {
    render(
      <MemoryRouter initialEntries={['/nowhere']}>
        <NotFoundPage />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('not-found-page')).toBeInTheDocument();
    expect(screen.getByText('404')).toBeInTheDocument();
    expect(screen.getByText('页面不存在。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '返回导入页' })).toBeInTheDocument();
  });

  it('点击「返回导入页」会导航回导入页', () => {
    render(
      <MemoryRouter initialEntries={['/nowhere']}>
        <NotFoundPage />
        <LocationProbe />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: '返回导入页' }));

    expect(screen.getByTestId('location-pathname')).toHaveTextContent('/import');
  });
});
