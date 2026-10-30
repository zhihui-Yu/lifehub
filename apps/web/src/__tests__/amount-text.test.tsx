/**
 * 金额展示组件测试。
 *
 * 覆盖需求：A-09 ③（收支语义色）、PRD §5「展示层做 amountMinor / 100 格式化」。
 *
 * 说明：颜色契约分两层验证——
 * 1. 组件层：断言收入 / 支出 / 退款分别挂上 `lifehub-amount-income|expense|refund` 类名；
 * 2. 样式层：读取 `src/styles/index.css`，断言这三个类名背后的 CSS 变量确实是
 *    PRD 规定的「收入绿 #16A34A / 支出红 #DC2626 / 退款蓝 #2563EB」。
 *    jsdom 不解析 CSS 变量，故这里做静态断言而不是 `getComputedStyle`。
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AmountText } from '@/components/common/AmountText';

/**
 * 定位全局样式表文件。
 *
 * 说明：jsdom 环境下 `import.meta.url` 不保证是 file: 协议，
 * 因此这里从当前工作目录向上尝试几个候选路径，保证
 * 「在 apps/web 下运行」与「在 monorepo 根目录运行」两种方式都能找到文件。
 *
 * @returns 样式表文件的绝对路径
 */
function resolveCssPath(): string {
  const candidates = [
    resolve(process.cwd(), 'src/styles/index.css'),
    resolve(process.cwd(), 'apps/web/src/styles/index.css'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(`未找到全局样式表，已尝试：${candidates.join('、')}`);
}

/** 全局样式表内容。 */
const CSS_TEXT = readFileSync(resolveCssPath(), 'utf8');

/**
 * 从样式表中取出一个 CSS 自定义属性的值。
 *
 * @param name 变量名（不含 `--`）
 * @returns 变量值（找不到时返回空串）
 */
function cssVariable(name: string): string {
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(CSS_TEXT);
  return match?.[1]?.trim() ?? '';
}

/**
 * 从样式表中取出一个类选择器的规则体。
 *
 * @param className 类名
 * @returns 规则体（找不到时返回空串）
 */
function classRule(className: string): string {
  const match = new RegExp(`\\.${className}\\s*\\{([^}]*)\\}`).exec(CSS_TEXT);
  return match?.[1]?.trim() ?? '';
}

describe('AmountText 语义与金额格式', () => {
  it('收入使用绿色语义类并带中文方向标识', () => {
    render(<AmountText amountMinor={1234} direction="income" />);

    const node = screen.getByText('收入 ¥12.34');
    expect(node).toBeInTheDocument();
    expect(node).toHaveClass('lifehub-amount-income');
    expect(node).toHaveAttribute('data-direction', 'income');
  });

  it('支出使用红色语义类并带中文方向标识', () => {
    render(<AmountText amountMinor={1234} direction="expense" />);

    const node = screen.getByText('支出 ¥12.34');
    expect(node).toHaveClass('lifehub-amount-expense');
    expect(node).toHaveAttribute('data-direction', 'expense');
  });

  it('退款使用蓝色语义类', () => {
    render(<AmountText amountMinor={1234} direction="refund" />);

    const node = screen.getByText('退款 ¥12.34');
    expect(node).toHaveClass('lifehub-amount-refund');
  });

  it('showLabel 为 false 时只显示金额，不带方向前缀', () => {
    render(<AmountText amountMinor={1234} direction="income" showLabel={false} />);

    const node = screen.getByText('¥12.34');
    expect(node).toBeInTheDocument();
    expect(node).not.toHaveTextContent('收入');
  });

  it('以「分」为单位的整数被正确格式化为两位小数', () => {
    const { rerender } = render(<AmountText amountMinor={0} direction="expense" />);
    expect(screen.getByText('支出 ¥0.00')).toBeInTheDocument();

    rerender(<AmountText amountMinor={5} direction="expense" />);
    expect(screen.getByText('支出 ¥0.05')).toBeInTheDocument();

    rerender(<AmountText amountMinor={123456} direction="income" />);
    expect(screen.getByText('收入 ¥1234.56')).toBeInTheDocument();

    rerender(<AmountText amountMinor={100} direction="expense" />);
    expect(screen.getByText('支出 ¥1.00')).toBeInTheDocument();
  });

  it('样式表里的收支色与 PRD 一致：收入绿 #16A34A、支出红 #DC2626、退款蓝 #2563EB', () => {
    expect(cssVariable('lifehub-income')).toBe('#16a34a');
    expect(cssVariable('lifehub-expense')).toBe('#dc2626');
    expect(cssVariable('lifehub-refund')).toBe('#2563eb');
  });

  it('金额语义类确实引用了上面三个颜色变量', () => {
    expect(classRule('lifehub-amount-income')).toContain('var(--lifehub-income)');
    expect(classRule('lifehub-amount-expense')).toContain('var(--lifehub-expense)');
    expect(classRule('lifehub-amount-refund')).toContain('var(--lifehub-refund)');
  });
});
