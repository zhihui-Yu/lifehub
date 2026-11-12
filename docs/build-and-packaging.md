# 多端构建与打包指南（Windows EXE / Android APK / Web / 同步服务 / iOS IPA / 微信小程序）

> **适用范围**：指导开发者与后续维护者将 LifeHub 编译为 **Windows 单文件桌面应用 (.exe)**、**Android APK / iOS IPA 原生安装包**、**Web 静态站点**、**Docker 自托管同步服务**，以及 **微信小程序版**。

---

## 目录

0. [一键打包 Windows EXE 与 Android APK（最快方式）](#0-一键打包-windows-exe-与-android-apk最快方式)
1. [前置环境要求](#1-前置环境要求)
2. [Web 端与核心层构建](#2-web-端与核心层构建)
3. [自托管同步服务构建与部署](#3-自托管同步服务构建与部署)
4. [手机端打包（Android APK / iOS IPA —— Capacitor 方案）](#4-手机端打包android-apk--ios-ipa--capacitor-方案)
5. [手机端轻量化方案（PWA 渐进式 Web 应用）](#5-手机端轻量化方案pwa-渐进式-web-应用)
6. [微信小程序版构建方案](#6-微信小程序版构建方案)
7. [发布前质量门禁检查](#7-发布前质量门禁检查)

---

## 0. 一键打包 Windows EXE 与 Android APK（最快方式）

项目根目录下内置了自动化打包脚本，无需手动进入子目录逐步执行：

### 0.1 双端一键自动升版并打包（同时生成 `.exe` + `.apk`）

在仓库根目录执行：

```bash
npm run release
```

- **对应脚本**：[`scripts/release-packages.mjs`](../scripts/release-packages.mjs)
- **执行流程**：
  1. 自动递增版本号（同步更新根 `package.json`、`apps/web/package.json` 及 `apps/web/android/app/build.gradle` 的 `versionCode` / `versionName`）；
  2. 清理根目录下旧版本的 `.exe` 与 `.apk` 文件；
  3. 调用 `scripts/build-desktop-windows.mjs` 编译前端并封装为单文件免安装 Windows 桌面版：
     `LifeHub-Desktop-win-x64-v<版本号>.exe`
  4. 执行 `npx cap sync android` 与 `.\gradlew.bat assembleDebug`，并将生成的 APK 复制到仓库根目录：
     `LifeHub-Android-v<版本号>.apk`

### 0.2 单独打包 Windows 桌面端（`.exe`）

```bash
npm run build:desktop
```

- **对应脚本**：[`scripts/build-desktop-windows.mjs`](../scripts/build-desktop-windows.mjs)
- **原理与环境**：无需额外安装 Electron 或重型 C++ 编译链，直接将 `apps/web/dist` 与 `scripts/vendor/webview2` 注入 C# WinForms 宿主，并调用 Windows 系统自带的 `.NET Framework 4.x` 编译器（`C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`）生成单文件免安装 `.exe`。
- **产物路径**：仓库根目录 `LifeHub-Desktop-win-x64-v<版本号>.exe`。

### 0.3 单独打包 Android 手机端（`.apk`）

```bash
npm run build:android
```

- **执行流程**：编译 `@lifehub/web` → `npx cap sync android` → 调用 Gradle 构建 Debug APK。
- **产物路径**：`apps/web/android/app/build/outputs/apk/debug/app-debug.apk`。

---

## 1. 前置环境要求

| 工具 / 环境 | 版本要求 | 适用目标 |
| --- | --- | --- |
| **Node.js** | **≥ 22.0.0** | 全端必选（参见根目录 `.nvmrc`） |
| **npm** | **≥ 10.0.0** | 全端必选（npm workspaces） |
| **JDK** | **JDK 17 或 21** | 构建 Android APK 时需要 |
| **Android Studio / Android SDK** | Android SDK Platform 34+ | 构建 Android APK 时需要 |
| **macOS + Xcode + CocoaPods** | Xcode 15+ | 构建 iOS IPA 时需要 |
| **微信开发者工具** | 最新稳定版 | 构建与预览微信小程序时需要 |
| **Docker / Docker Compose** | Docker Engine 24+ | 容器化部署 `apps/sync-server` 时可选 |

首次克隆仓库后，在仓库根目录安装全部依赖：

```bash
npm install
```

---

## 2. Web 端与核心层构建

### 2.1 本地开发与热更新

```bash
npm run dev
# 默认监听 http://localhost:4180
```

### 2.2 生产环境静态编译

```bash
npm run build
```

- **执行流程**：先编译 `packages/core`（生成类型与 JS 产物），再通过 Vite 打包 `apps/web`。
- **构建产物目录**：`apps/web/dist/`（纯静态 HTML/JS/CSS/Worker 资源）。
- **本地预览生产产物**：
  ```bash
  npm run preview
  ```
- **部署说明**：
  - 可将 `apps/web/dist/` 托管至任意静态服务器（Nginx / Caddy / Cloudflare Pages / Vercel）。
  - **注意**：由于浏览器 `WebCrypto API (crypto.subtle)` 的安全上下文限制，生产环境**必须通过 HTTPS**（或本机 `http://localhost`）访问，不能直接使用 `http://局域网IP` 访问。
  - 若使用 Nginx 托管 SPA 路由，请配置 `try_files $uri $uri/ /index.html;`。

---

## 3. 自托管同步服务构建与部署

### 3.1 Node.js 直接编译与运行

```bash
# 编译 apps/sync-server 到 apps/sync-server/dist
npm run build:sync

# 配置设备授权令牌并启动（默认监听 127.0.0.1:8787）
export LIFEHUB_SYNC_TOKENS="device-laptop:your-secret-token-1,device-phone:your-secret-token-2"
npm run start --workspace @lifehub/sync-server
```

### 3.2 Docker Compose 一键构建与启动

```bash
# 1. 复制环境变量模板并填入自己的设备令牌
cp apps/sync-server/.env.example .env

# 2. 构建镜像并后台启动（含同步服务 + 夜间 SQLite 快照备份 sidecar）
docker compose up -d --build
```

---

## 4. 手机端打包（Android APK / iOS IPA —— Capacitor 方案）

`apps/web` 采用纯前端本地优先架构（无 SSR 依赖），通过 **Capacitor** 可以直接将 `apps/web/dist` 封装为原生 Android APK 与 iOS App。
Capacitor 原生 WebView 默认运行在安全上下文（`https://localhost` 或 `capacitor://localhost`）下，**100% 原生支持**：
- `WebCrypto API (crypto.subtle)`（端到端 AES-256-GCM 加解密）
- `IndexedDB`（Dexie 本地加密数据库）
- `<input type="file">`（CSV / XLSX / 加密 PDF / 加密 ZIP 账单导入）

### 4.1 首次初始化 Capacitor（在 `apps/web` 目录下执行）

```bash
cd apps/web

# 1. 安装 Capacitor 核心与 CLI
npm install @capacitor/core
npm install -D @capacitor/cli

# 2. 初始化 Capacitor 配置（指定构建产物目录为 dist）
npx cap init "LifeHub" "app.lifehub.local" --web-dir dist
```

初始化后会生成 `apps/web/capacitor.config.ts`（或 `.json`），确认配置如下：

```json
{
  "appId": "app.lifehub.local",
  "appName": "LifeHub",
  "webDir": "dist",
  "server": {
    "androidScheme": "https"
  }
}
```

### 4.2 构建 Android APK（Windows / macOS / Linux 均可）

```bash
cd apps/web

# 1. 添加 Android 平台工程（首次执行一次）
npm install @capacitor/android
npx cap add android

# 2. 编译最新 Web 产物并同步到 Android 原生工程
npm run build
npx cap sync android
```

#### 方式 A：命令行直接打包 APK（推荐）

```powershell
cd apps/web/android

# Windows PowerShell 构建免签名调试包（可直接发到手机安装）：
.\gradlew.bat assembleDebug

# macOS / Linux 构建免签名调试包：
./gradlew assembleDebug
```

- **生成的 APK 路径**：
  `apps/web/android/app/build/outputs/apk/debug/app-debug.apk`
- **构建正式签名 Release APK**：
  ```powershell
  .\gradlew.bat assembleRelease
  ```
  （需在 `apps/web/android/app/build.gradle` 中配置 `signingConfigs` 签名密钥库 `.jks`）。

#### 方式 B：使用 Android Studio 图形界面打包或真机调试

```bash
cd apps/web
npx cap open android
```
在 Android Studio 中点击 **Build → Build Bundle(s) / APK(s) → Build APK(s)**，或连接手机直接点击 **Run**。

---

### 4.3 构建 iOS IPA（需 macOS + Xcode）

```bash
cd apps/web

# 1. 添加 iOS 平台工程（首次执行一次）
npm install @capacitor/ios
npx cap add ios

# 2. 编译最新 Web 产物并同步到 iOS 原生工程
npm run build
npx cap sync ios

# 3. 打开 Xcode 进行签名与构建
npx cap open ios
```

在 Xcode 中：
1. 选中左侧 `App` 工程 → **Signing & Capabilities** → 选择你的 Apple ID / Team（个人免费 Apple ID 即可真机安装自用）。
2. 连接 iPhone 点击 ▶ **Run** 直接安装到手机；或点击菜单栏 **Product → Archive** 导出 `.ipa` 安装包。

---

## 5. 手机端轻量化方案（PWA 渐进式 Web 应用）

如果不想走原生编译与签名流程，可将 Web 端部署在自己的 HTTPS 域名（或 Tailscale HTTPS 内网域名）下，使用手机系统自带的安装能力：

- **Android（Chrome / Edge）**：打开网址 → 浏览器右上角菜单 → **「添加到主屏幕 / 安装应用」**，即可以独立全屏 App 形态运行并离线使用。
- **iOS（Safari）**：打开网址 → 点击底部**「分享」**按钮 → **「添加到主屏幕」**，同样享受独立沙盒存储与全屏体验。

---

## 6. 微信小程序版构建方案

微信小程序没有浏览器 DOM、没有 `IndexedDB`、也没有 `window.crypto.subtle`，不能直接把 React + MUI 的 DOM 组件原样放进小程序环境运行。根据你的小程序主体类型，有以下两种构建方式：

### 方案 A：企业主体小程序 —— `<web-view>` 壳封装（最快，零代码改造）

1. 先按 [第 2 节](#2-web-端与核心层构建) 将 `apps/web/dist` 部署到已备案的 HTTPS 域名，并在微信公众平台后台将该域名加入**「业务域名」**白名单。
2. 用微信开发者工具新建空白小程序，在首页 `pages/index/index.wxml` 中写入：
   ```xml
   <web-view src="https://你的域名/"></web-view>
   ```
3. 直接预览、上传并提交审核即可，100% 复用现有 Web 端全部能力。
   *(注：微信官方限制个人主体小程序无法配置 `<web-view>` 业务域名)*

### 方案 B：个人或企业主体 —— 原生小程序表现层 + 复用 `@lifehub/core`

由于本项目的领域层 [`packages/core`](../packages/core) 在设计之初就严格执行了**零 DOM 依赖**（`npm run check:compliance` 强制拦截 `window` / `document` / `localStorage` / `indexedDB`），在构建原生小程序（如使用 **Taro + React** 新建 `apps/miniapp`）时，可以直接 `import` 复用 `@lifehub/core` 的全部模型、加密服务、CSV 解析、智能分类记忆、去重与规则引擎，只需在小程序端实现两个注入端口：

1. **`StorageAdapter` 小程序实现（对应 [`packages/core/src/storage/storage-adapter.ts`](../packages/core/src/storage/storage-adapter.ts)）**：
   - 使用微信小程序 `wx.getStorageSync` / `wx.setStorageSync` 或 `wx.getFileSystemManager()` 本地用户文件目录（`wx.env.USER_DATA_PATH`）持久化密文记录与 7 个索引列。
2. **`CryptoProvider` 小程序实现（对应 [`packages/core/src/crypto/crypto-provider.ts`](../packages/core/src/crypto/crypto-provider.ts)）**：
   - 随机数使用 `wx.getRandomValues`；
   - AES-256-GCM 与 `scrypt` 派生使用纯 JS 密码学库（如 `@noble/ciphers` + `@noble/hashes`）实现 `CryptoProvider` 接口并注入 `CryptoService`。
3. **账单文件选择**：
   - 使用 `wx.chooseMessageFile({ type: 'file', extension: ['csv', 'xlsx', 'xls', 'pdf', 'zip'] })`，支持直接从微信聊天记录（如“文件传输助手”）中选择账单文件并在本地解析导入。
4. **合规注意（见 PRD `M-01`）**：
   - 个人主体微信小程序提审时对“金融/记账/理财”类目审核较严，个人主体打包上线时建议将界面文案包装为“个人日常清单 / 积分记录工具”。

---

## 7. 发布前质量门禁检查

在每次编译发布或提交代码前，建议在仓库根目录运行完整质量门禁：

```bash
npm run typecheck          # 全仓 TypeScript 类型检查
npm run lint               # ESLint 静态检查
npm test                   # 运行全部单测与集成测试（core + web + sync-server）
npm run check:compliance   # 合规红线扫描（零 DOM、无采集、无统计 SDK、无银行域名）
npm run check:no-network   # 加密与服务层零网络出口断言
npm run check:sync-payload # 同步与备份载荷只含密文断言
```

或者一键运行全套 CI 检查：

```bash
npm run ci
```
