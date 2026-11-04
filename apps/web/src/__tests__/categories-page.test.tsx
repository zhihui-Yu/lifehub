/**
 * 分类管理页面集成测试。
 *
 * 覆盖：列表渲染、系统预置不可删除、新增 / 编辑 / 删除闭环（走真实 useCategories + 假运行时）。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Category } from '@lifehub/core';
import { CategoriesPage } from '@/pages/CategoriesPage';

/**
 * 用 hoisted 维护一个**引用稳定**的内存分类表与假运行时，
 * 让 `useCategories` 的 reload 依赖不随渲染变化（避免无限重渲染）。
 */
const { FAKE_RUNTIME, SEED } = vi.hoisted(() => {
  const cats: Category[] = [
    {
      id: 'sys-1',
      name: '餐饮',
      kind: 'expense',
      parentId: null,
      color: '#DC2626',
      icon: 'restaurant',
      isSystem: true,
      sortOrder: 100,
      createdAt: '2023-01-01T00:00:00.000Z',
      updatedAt: '2023-01-01T00:00:00.000Z',
      version: 1,
      deviceId: 'seed',
    },
    {
      id: 'user-1',
      name: '健身',
      kind: 'expense',
      parentId: null,
      color: '#123ABC',
      icon: 'gym',
      isSystem: false,
      sortOrder: 5000,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      version: 1,
      deviceId: 'local-device',
    },
  ];
  return {
    SEED: cats,
    FAKE_RUNTIME: {
      clock: { nowIso: () => '2024-06-01T00:00:00.000Z' },
      categoryRepository: {
        list: async () => [...cats].sort((a, b) => a.sortOrder - b.sortOrder),
        save: async (category: Category) => {
          // 复刻真实仓储的「名称大小写不敏感唯一」约束，使重名分支可被测试到。
          const dup = cats.find(
            (c) => c.id !== category.id && c.name.trim().toLowerCase() === category.name.trim().toLowerCase(),
          );
          if (dup) {
            throw new Error(`分类「${category.name}」已存在`);
          }
          const idx = cats.findIndex((c) => c.id === category.id);
          if (idx >= 0) {
            cats[idx] = category;
          } else {
            cats.unshift(category);
          }
        },
        delete: async (id: string) => {
          const idx = cats.findIndex((c) => c.id === id);
          if (idx >= 0) {
            cats.splice(idx, 1);
          }
        },
      },
    },
  };
});

vi.mock('@/hooks/useVault', () => ({
  useVault: () => ({ runtime: FAKE_RUNTIME, status: 'unlocked', error: null }),
}));

describe('CategoriesPage', () => {
  beforeEach(() => {
    // 还原种子，避免用例间串扰。
    SEED.length = 0;
    SEED.push(
      {
        id: 'sys-1',
        name: '餐饮',
        kind: 'expense',
        parentId: null,
        color: '#DC2626',
        icon: 'restaurant',
        isSystem: true,
        sortOrder: 100,
        createdAt: '2023-01-01T00:00:00.000Z',
        updatedAt: '2023-01-01T00:00:00.000Z',
        version: 1,
        deviceId: 'seed',
      },
      {
        id: 'user-1',
        name: '健身',
        kind: 'expense',
        parentId: null,
        color: '#123ABC',
        icon: 'gym',
        isSystem: false,
        sortOrder: 5000,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        version: 1,
        deviceId: 'local-device',
      },
    );
  });

  it('渲染系统预置与自定义分类，且系统预置的删除按钮禁用', async () => {
    render(<CategoriesPage />);
    await waitFor(() => {
      expect(screen.getByText('餐饮')).toBeInTheDocument();
    });
    expect(screen.getByText('健身')).toBeInTheDocument();
    expect(screen.getByText('系统预置')).toBeInTheDocument();
    expect(screen.getByText('自定义')).toBeInTheDocument();

    const sysDelete = screen.getByLabelText('删除分类 餐饮') as HTMLButtonElement;
    expect(sysDelete.disabled).toBe(true);
  });

  it('新增分类：填名称后保存，新行出现', async () => {
    render(<CategoriesPage />);
    await waitFor(() => {
      expect(screen.getByText('健身')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '新增分类' }));
    const nameInput = await screen.findByLabelText('分类名称');
    fireEvent.change(nameInput, { target: { value: '旅行' } });
    fireEvent.click(screen.getByRole('button', { name: '新增' }));

    await waitFor(() => {
      expect(screen.getByText('旅行')).toBeInTheDocument();
    });
    expect(screen.getAllByText('自定义')).toHaveLength(2);
  });

  it('新增重名分类时显示中文错误并停留在对话框', async () => {
    render(<CategoriesPage />);
    await waitFor(() => {
      expect(screen.getByText('健身')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '新增分类' }));
    const nameInput = await screen.findByLabelText('分类名称');
    fireEvent.change(nameInput, { target: { value: '健身' } });
    fireEvent.click(screen.getByRole('button', { name: '新增' }));

    await waitFor(() => {
      expect(screen.getByText('分类「健身」已存在')).toBeInTheDocument();
    });
    // 对话框未关闭：提交按钮仍在（标题 "新增分类" 与顶栏按钮重名，改用提交按钮判定）。
    expect(screen.getByRole('button', { name: '新增' })).toBeInTheDocument();
  });

  it('删除自定义分类：确认对话框二次确认后移除', async () => {
    render(<CategoriesPage />);
    await waitFor(() => {
      expect(screen.getByText('健身')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('删除分类 健身'));
    // 二次确认对话框出现。
    expect(screen.getByText('确认删除分类')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '删除' }));

    await waitFor(() => {
      expect(screen.queryByText('健身')).not.toBeInTheDocument();
    });
  });

  it('编辑自定义分类：回填名称并保存后更新', async () => {
    render(<CategoriesPage />);
    await waitFor(() => {
      expect(screen.getByText('健身')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('编辑分类 健身'));
    const nameInput = await screen.findByLabelText('分类名称');
    expect((nameInput as HTMLInputElement).value).toBe('健身');
    fireEvent.change(nameInput, { target: { value: '运动健身' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(screen.getByText('运动健身')).toBeInTheDocument();
    });
    expect(screen.queryByText('健身')).not.toBeInTheDocument();
  });
});
