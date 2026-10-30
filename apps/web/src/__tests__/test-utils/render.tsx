/**
 * 路由感知的渲染辅助。
 *
 * 架构位置：apps/web 的「测试辅助」层（位于 `src/__tests__/test-utils/`，仅被测试文件引用，不参与生产构建）。
 *
 * 说明：Web 端页面普遍使用 `useNavigate` / `useLocation`，
 * 直接 `render()` 会抛「必须在 Router 上下文内」的错；
 * 这里统一包一层 `MemoryRouter`，并额外渲染一个路由探针，
 * 让测试可以断言「是否跳转到 /import/mapping」这类**真实导航结果**，
 * 而不是去 mock 掉 `useNavigate`（mock 掉就测不到跳转行为了）。
 */
import type { ReactElement } from 'react';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

/** 路由探针组件的属性。 */
interface LocationProbeProps {
  /** 探针的 DOM 标识，便于测试定位。 */
  testId?: string;
}

/**
 * 渲染当前路由 pathname 的探针。
 *
 * @param props 组件属性
 * @returns React 节点
 */
export function LocationProbe({ testId = 'location-pathname' }: LocationProbeProps): ReactElement {
  const location = useLocation();
  return <div data-testid={testId}>{location.pathname}</div>;
}

/** 带路由上下文的渲染结果。 */
export type RenderWithRouterResult = RenderResult;

/** 渲染选项。 */
export interface RenderWithRouterOptions {
  /** 初始路由路径，默认 '/'。 */
  route?: string;
  /** 路由探针的 DOM 标识，默认 'location-pathname'。 */
  locationTestId?: string;
  /** 透传给 RTL render 的其它选项。 */
  renderOptions?: Omit<RenderOptions, 'wrapper'>;
}

/**
 * 在 `MemoryRouter` 上下文中渲染组件。
 *
 * @param ui 待渲染的 React 节点
 * @param options 渲染选项
 * @returns RTL 渲染结果
 */
export function renderWithRouter(
  ui: ReactElement,
  options: RenderWithRouterOptions = {},
): RenderWithRouterResult {
  const { route = '/', locationTestId = 'location-pathname', renderOptions } = options;
  function Wrapper({ children }: { children?: React.ReactNode }): ReactElement {
    return (
      <MemoryRouter initialEntries={[route]}>
        <LocationProbe testId={locationTestId} />
        {children}
      </MemoryRouter>
    );
  }
  return render(ui, { wrapper: Wrapper, ...renderOptions });
}
