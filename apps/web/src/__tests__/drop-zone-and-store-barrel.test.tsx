/**
 * 拖拽区与状态 barrel 测试。
 *
 * 覆盖需求：A-08 ①（拖拽与选择文件是同一入口）、A-08 ③（最近导入列表的重复标记），
 * 以及系统设计 §8.1 的「统一从 barrel 导入」约定。
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DropZone } from '@/components/import/DropZone';
import { RecentImports } from '@/components/import/RecentImports';
import {
  EMPTY_FILTERS,
  InMemoryDekProvider,
  dekProvider,
  useBillStore,
  useImportStore,
  useSettingsStore,
  useVaultStore,
} from '@/store';
import { makeBatch } from '@/__tests__/test-utils/fixtures';

describe('DropZone', () => {
  it('拖拽悬停时加上 lifehub-dragging 样式，离开时移除', () => {
    render(<DropZone onFile={vi.fn()} />);
    const zone = screen.getByTestId('drop-zone');

    expect(zone).not.toHaveClass('lifehub-dragging');

    fireEvent.dragOver(zone);
    expect(zone).toHaveClass('lifehub-dragging');

    fireEvent.dragLeave(zone);
    expect(zone).not.toHaveClass('lifehub-dragging');
  });

  it('放下文件时把文件交给 onFile', () => {
    const onFile = vi.fn();
    render(<DropZone onFile={onFile} />);
    const file = new File(['日期,金额'], '账单.csv', { type: 'text/csv' });

    fireEvent.drop(screen.getByTestId('drop-zone'), { dataTransfer: { files: [file] } });

    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onFile.mock.calls[0]?.[0]).toBe(file);
  });

  it('禁用状态下不接受拖放', () => {
    const onFile = vi.fn();
    render(<DropZone onFile={onFile} disabled />);
    const zone = screen.getByTestId('drop-zone');

    fireEvent.dragOver(zone);
    expect(zone).not.toHaveClass('lifehub-dragging');

    fireEvent.drop(zone, { dataTransfer: { files: [new File([''], 'a.csv')] } });
    expect(onFile).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '选择 CSV 文件' })).toBeDisabled();
  });

  it('通过文件选择框选文件同样触发 onFile', () => {
    const onFile = vi.fn();
    const { container } = render(<DropZone onFile={onFile} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['日期,金额'], '账单.csv', { type: 'text/csv' });

    fireEvent.change(input, { target: { files: [file] } });

    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onFile.mock.calls[0]?.[0]).toBe(file);
  });
});

describe('RecentImports', () => {
  it('没有记录时不渲染任何内容', () => {
    const { container } = render(<RecentImports batches={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('当前文件哈希命中历史批次时标记「重复文件」', () => {
    const hash = 'f'.repeat(64);
    render(<RecentImports batches={[makeBatch({ id: 'b1', fileHash: hash })]} currentFileHash={hash} />);

    expect(screen.getByText('重复文件')).toBeInTheDocument();
    expect(screen.queryByText('已导入')).not.toBeInTheDocument();
  });

  it('没有当前文件哈希时按「已导入」展示', () => {
    render(<RecentImports batches={[makeBatch({ id: 'b1' })]} />);

    expect(screen.getByText('已导入')).toBeInTheDocument();
    expect(screen.queryByText('重复文件')).not.toBeInTheDocument();
  });
});

describe('@/store barrel', () => {
  it('统一导出四个 store 与 DEK 供给器', () => {
    expect(typeof useBillStore.getState).toBe('function');
    expect(typeof useImportStore.getState).toBe('function');
    expect(typeof useSettingsStore.getState).toBe('function');
    expect(typeof useVaultStore.getState).toBe('function');
    expect(dekProvider).toBeInstanceOf(InMemoryDekProvider);
    expect(EMPTY_FILTERS).toEqual({
      keyword: '',
      directions: [],
      dateFrom: '',
      dateTo: '',
      categoryId: '',
    });
  });
});
