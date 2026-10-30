/**
 * 设置页与 404 页测试。
 *
 * 覆盖需求：PRD §5.5「基础设置」（时区 / 币种 / 周起始日），
 * 以及路由兜底：未匹配的路径展示 404 页面而不是白屏。
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { useSettingsStore } from '@/store/settings-store';
import { LocationProbe } from '@/__tests__/test-utils/render';

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

  it('渲染基础设置表单并回显当前设置', () => {
    render(<SettingsPage />);

    expect(screen.getByTestId('settings-page')).toBeInTheDocument();
    expect(screen.getByLabelText('默认时区')).toHaveValue('Asia/Shanghai');
    expect(screen.getByLabelText('默认币种')).toHaveTextContent('人民币 CNY');
    expect(screen.getByLabelText('一周起始日')).toHaveTextContent('周一');
    expect(screen.getByText(/IANA 时区名/)).toBeInTheDocument();
  });

  it('修改时区会写回 settings-store', () => {
    render(<SettingsPage />);

    fireEvent.change(screen.getByLabelText('默认时区'), { target: { value: 'Asia/Tokyo' } });

    expect(useSettingsStore.getState().timezone).toBe('Asia/Tokyo');
  });

  it('切换一周起始日会写回 settings-store', () => {
    render(<SettingsPage />);

    const select = screen.getByLabelText('一周起始日');
    fireEvent.mouseDown(select);
    fireEvent.click(screen.getByRole('option', { name: '周日' }));

    expect(useSettingsStore.getState().weekStart).toBe(0);
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
