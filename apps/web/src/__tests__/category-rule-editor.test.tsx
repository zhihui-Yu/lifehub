/**
 * 分类规则编辑器测试。
 *
 * 覆盖需求：A-20（自动分类规则支持 contains / prefix / exact / regex 四种匹配类型与优先级）、
 * A-05 ③（未命中的账单归入「未分类」）。
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CategoryRule } from '@lifehub/core';
import { CategoryRuleEditor } from '@/components/mapping/CategoryRuleEditor';

/** 一条示例分类规则。 */
const RULE: CategoryRule = {
  id: 'rule-1',
  priority: 10,
  matchType: 'contains',
  pattern: '星巴克',
  categoryId: 'cat-coffee',
};

describe('CategoryRuleEditor', () => {
  it('没有规则时提示未命中的账单归入「未分类」', () => {
    render(<CategoryRuleEditor rules={[]} onChange={vi.fn()} />);

    expect(screen.getByText(/尚未添加分类规则，未命中的账单将归入「未分类」。/)).toBeInTheDocument();
    expect(screen.getByText('自动分类规则（按优先级从高到低匹配，命中即停）')).toBeInTheDocument();
  });

  it('修改关键词回调新的规则列表', () => {
    const onChange = vi.fn();
    render(<CategoryRuleEditor rules={[RULE]} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('关键词'), { target: { value: '瑞幸' } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]?.[0]).toMatchObject({ id: 'rule-1', pattern: '瑞幸' });
  });

  it('修改优先级回调新的规则列表', () => {
    const onChange = vi.fn();
    render(<CategoryRuleEditor rules={[RULE]} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('优先级'), { target: { value: '99' } });

    expect(onChange.mock.calls[0]?.[0]?.[0]).toMatchObject({ id: 'rule-1', priority: 99 });
  });

  it('匹配类型下拉提供四种匹配方式', () => {
    render(<CategoryRuleEditor rules={[RULE]} onChange={vi.fn()} />);

    const select = screen.getByLabelText('匹配类型');
    fireEvent.mouseDown(select);
    for (const label of ['包含', '前缀', '完全匹配', '正则']) {
      expect(screen.getByRole('option', { name: label })).toBeInTheDocument();
    }
  });

  it('切换匹配类型回调新的规则列表', () => {
    const onChange = vi.fn();
    render(<CategoryRuleEditor rules={[RULE]} onChange={onChange} />);

    fireEvent.mouseDown(screen.getByLabelText('匹配类型'));
    fireEvent.click(screen.getByRole('option', { name: '正则' }));

    expect(onChange.mock.calls[0]?.[0]?.[0]).toMatchObject({ matchType: 'regex' });
  });

  it('选择目标分类回调新的规则列表', () => {
    const onChange = vi.fn();
    render(
      <CategoryRuleEditor
        rules={[{ ...RULE, categoryId: '' }]}
        onChange={onChange}
        categoryOptions={[{ id: 'cat-coffee', name: '咖啡' }]}
      />,
    );

    fireEvent.mouseDown(screen.getByLabelText('目标分类'));
    fireEvent.click(screen.getByRole('option', { name: '咖啡' }));

    expect(onChange.mock.calls[0]?.[0]?.[0]).toMatchObject({ categoryId: 'cat-coffee' });
  });

  it('删除按钮把该条规则从列表中移除', () => {
    const onChange = vi.fn();
    render(
      <CategoryRuleEditor
        rules={[RULE, { ...RULE, id: 'rule-2', pattern: '瑞幸' }]}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '删除规则 1' }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]?.[0] as CategoryRule[];
    expect(next).toHaveLength(1);
    expect(next[0]?.id).toBe('rule-2');
  });
});
