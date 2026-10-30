import type { Config } from 'tailwindcss';

/**
 * Tailwind CSS 配置。
 *
 * 说明：Tailwind 只负责间距 / 栅格 / 响应式，交互组件交给 MUI，
 * 两者职责不重叠（系统设计 §1.3、PRD §5.0）。
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // 收支语义色：收入绿 / 支出红（PRD A-09 组头合计的配色口径）。
        income: '#16A34A',
        expense: '#DC2626',
        refund: '#2563EB',
      },
      spacing: {
        sidenav: '220px',
        content: '1280px',
      },
    },
  },
  plugins: [],
} satisfies Config;
