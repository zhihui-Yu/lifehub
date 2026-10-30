/**
 * 下载工具与盐值备份面板测试。
 *
 * 覆盖需求：X-03 ③ / UI-04 交互要点 3 —— 「下载盐值备份」产出独立文件
 * （salt + KDF 参数 + 哨兵密文），文件名含日期，**不含任何明文业务数据**。
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SaltBackupPanel } from '@/components/security/SaltBackupPanel';
import { buildDatedFileName, downloadText } from '@/utils/download';
import { makeRecoveryBundle } from '@/__tests__/test-utils/fixtures';
// 说明：jsdom 未实现 Blob.text()，这里补齐后才能读回下载内容做断言。
import '@/__tests__/test-utils/polyfills';

describe('downloadText', () => {
  /** 记录被触发下载的内容。 */
  let downloaded: { name: string; content: string } | null = null;

  beforeEach(() => {
    downloaded = null;
    Object.defineProperty(URL, 'createObjectURL', {
      writable: true,
      configurable: true,
      value: vi.fn(() => 'blob:mock-url'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      writable: true,
      configurable: true,
      value: vi.fn(),
    });
    // 拦截 <a download> 的点击，记录文件名与内容。
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function patched(this: HTMLAnchorElement): void {
      downloaded = { name: this.download, content: 'captured' };
    };
    return () => {
      HTMLAnchorElement.prototype.click = originalClick;
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('触发一次下载并立即释放对象 URL', () => {
    downloadText('lifehub.txt', '内容');

    expect(downloaded?.name).toBe('lifehub.txt');
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    // 触发后不留下残余的 <a> 节点。
    expect(document.querySelectorAll('a[download]')).toHaveLength(0);
  });

  it('buildDatedFileName 生成带日期的文件名', () => {
    expect(buildDatedFileName('lifehub-salt-backup', '.salt.json', new Date(2024, 0, 5))).toBe(
      'lifehub-salt-backup-2024-01-05.salt.json',
    );
    expect(buildDatedFileName('prefix', '.json', new Date(2024, 11, 31))).toBe('prefix-2024-12-31.json');
  });
});

describe('SaltBackupPanel', () => {
  it('没有恢复码包时禁用下载按钮', () => {
    render(<SaltBackupPanel bundle={null} />);

    expect(screen.getByRole('button', { name: '下载盐值备份' })).toBeDisabled();
    expect(screen.getByText(/盐值备份文件含恢复码/)).toBeInTheDocument();
  });

  it('有恢复码包时启用下载按钮', () => {
    render(<SaltBackupPanel bundle={makeRecoveryBundle()} />);

    expect(screen.getByRole('button', { name: '下载盐值备份' })).toBeEnabled();
  });

  it('下载的文件名含日期，且内容含盐值 / KDF 参数 / 哨兵密文 / 恢复码', async () => {
    const bundle = makeRecoveryBundle();
    let payload: Record<string, unknown> | null = null;
    let fileName = '';

    Object.defineProperty(URL, 'createObjectURL', {
      writable: true,
      configurable: true,
      value: vi.fn((blob: Blob) => {
        void blob.text().then((text) => {
          payload = JSON.parse(text) as Record<string, unknown>;
        });
        return 'blob:mock-url';
      }),
    });
    Object.defineProperty(URL, 'revokeObjectURL', { writable: true, configurable: true, value: vi.fn() });
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function patched(this: HTMLAnchorElement): void {
      fileName = this.download;
    };

    render(<SaltBackupPanel bundle={bundle} />);
    fireEvent.click(screen.getByRole('button', { name: '下载盐值备份' }));

    HTMLAnchorElement.prototype.click = originalClick;
    await vi.waitFor(() => {
      expect(payload).not.toBeNull();
    });

    const data = payload as unknown as Record<string, unknown>;
    expect(fileName).toMatch(/^lifehub-salt-backup-\d{4}-\d{2}-\d{2}\.salt\.json$/);
    expect(data['type']).toBe('lifehub-salt-backup');
    expect(data['recoveryCode']).toBe(bundle.recoveryCode);
    expect(Array.isArray(data['salt'])).toBe(true);
    expect(data['kdfParams']).toMatchObject({ kdf: 'scrypt', n: 32768, r: 8, p: 1 });
    expect(data['verifier']).toMatchObject({ algorithm: 'AES-256-GCM', keyVersion: 1 });
  });
});
