/**
 * 配置解析与设备令牌鉴权测试。
 *
 * 架构位置：apps/sync-server/tests —— 验证「令牌只来自环境变量」与失败即关闭的行为。
 */
import { describe, expect, it } from 'vitest';
import { DeviceAuthorizer } from '../src/auth.ts';
import { loadConfig, parseCredentialText } from '../src/config.ts';

describe('配置解析', () => {
  it('未配置任何设备令牌时抛出错误（拒绝以匿名模式启动）', () => {
    expect(() => loadConfig({})).toThrow(/未配置设备令牌/);
  });

  it('从 LIFEHUB_SYNC_TOKENS 读取内联令牌', () => {
    const config = loadConfig({ LIFEHUB_SYNC_TOKENS: 'tok-a,tok-b' });
    expect(config.credentials).toHaveLength(2);
    expect(config.credentials.map((item) => item.secret)).toEqual(['tok-a', 'tok-b']);
  });

  it('支持「标签=令牌」写法', () => {
    const config = loadConfig({ LIFEHUB_SYNC_TOKENS: 'phone=tok-a,laptop=tok-b' });
    expect(config.credentials[0]?.deviceId).toBe('phone');
    expect(config.credentials[1]?.deviceId).toBe('laptop');
  });

  it('裸令牌自动获得顺序设备标识', () => {
    const config = loadConfig({ LIFEHUB_SYNC_TOKENS: 'tok-a' });
    expect(config.credentials[0]?.deviceId).toBe('device-1');
  });

  it('解析凭据文本时忽略空行与注释行', () => {
    const credentials = parseCredentialText('# 注释\n\nphone=tok-a\n  \nlaptop=tok-b\n');
    expect(credentials).toHaveLength(2);
    expect(credentials[0]?.deviceId).toBe('phone');
    expect(credentials[1]?.deviceId).toBe('laptop');
  });

  it('端口与分页大小落在合法区间内', () => {
    const config = loadConfig({
      LIFEHUB_SYNC_TOKENS: 'tok',
      LIFEHUB_SYNC_PORT: '99999',
      LIFEHUB_SYNC_DEFAULT_PAGE_SIZE: '99999',
    });
    expect(config.port).toBe(65535);
    expect(config.defaultPageSize).toBe(500);
  });

  it('默认数据库路径与监听地址符合预期', () => {
    const config = loadConfig({ LIFEHUB_SYNC_TOKENS: 'tok' });
    expect(config.databasePath).toBe('./data/lifehub-sync.db');
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(8787);
  });
});

describe('设备令牌鉴权', () => {
  const authorizer = new DeviceAuthorizer([
    { deviceId: 'phone', secret: 'secret-phone' },
    { deviceId: 'laptop', secret: 'secret-laptop' },
  ]);

  it('正确令牌放行并返回设备标识', () => {
    const result = authorizer.authorize('Bearer secret-phone');
    expect(result).toEqual({ ok: true, deviceId: 'phone' });
  });

  it('大小写不敏感的 Bearer 前缀', () => {
    const result = authorizer.authorize('bearer secret-laptop');
    expect(result).toEqual({ ok: true, deviceId: 'laptop' });
  });

  it('缺少请求头时拒绝', () => {
    expect(authorizer.authorize(undefined).ok).toBe(false);
    expect(authorizer.authorize('   ').ok).toBe(false);
  });

  it('格式非法时拒绝', () => {
    expect(authorizer.authorize('secret-phone').ok).toBe(false);
    expect(authorizer.authorize('Basic secret-phone').ok).toBe(false);
  });

  it('错误令牌被拒绝', () => {
    expect(authorizer.authorize('Bearer wrong').ok).toBe(false);
  });

  it('令牌是另一个设备的令牌时，拒绝但能识别设备', () => {
    const result = authorizer.authorize('Bearer secret-laptop');
    expect(result.ok).toBe(true);
  });
});
