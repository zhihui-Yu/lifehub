/**
 * Web 端密码学实现。
 *
 * 架构位置：apps/web 的「平台适配」层。
 *
 * 说明：直接复用 core 的 `WebCryptoProvider`（浏览器 WebCrypto + @noble/hashes scrypt）。
 * 这里只做一层薄封装，目的是让「Web 端用的是哪个实现」在代码里一目了然，
 * 并为将来替换（例如接入平台 Keystore）留出唯一改动点。
 */
import { WebCryptoProvider } from '@lifehub/core';
import type { CryptoProvider } from '@lifehub/core';

/**
 * 创建 Web 端密码学实现。
 *
 * @returns `CryptoProvider` 实例
 */
export function createWebCryptoProvider(): CryptoProvider {
  return new WebCryptoProvider();
}
