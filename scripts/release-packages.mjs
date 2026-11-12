#!/usr/bin/env node
/**
 * LifeHub 双端（Windows 原生桌面版 EXE + Android 手机端 APK）自动升版与打包脚本。
 *
 * 功能：
 * 1. 自动升级版本号（同步更新根 package.json、apps/web/package.json 与 Android build.gradle 的 versionCode / versionName）；
 * 2. 清理根目录下旧版本的 .exe 与 .apk 产物；
 * 3. 构建带最新版本号的 Windows 原生桌面版：`LifeHub-Desktop-win-x64-v<version>.exe`；
 * 4. 构建带最新版本号的 Android 手机端安装包：`LifeHub-xiaomi15-v<version>.apk`。
 */
import { execSync } from 'node:child_process';
import { copyFileSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

function bumpSemver(version) {
  const parts = String(version || '0.1.0')
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 1;
  const patch = parts[2] ?? 0;
  // 从 0.1.0 首次升级至 0.2.0，后续每次打包自动递增 patch 版本（如 0.2.1, 0.2.2...）
  if (major === 0 && minor === 1 && patch === 0) {
    return '0.2.0';
  }
  return `${major}.${minor}.${patch + 1}`;
}

function updateVersionFiles() {
  const rootPkgPath = join(REPO_ROOT, 'package.json');
  const webPkgPath = join(REPO_ROOT, 'apps', 'web', 'package.json');
  const gradlePath = join(REPO_ROOT, 'apps', 'web', 'android', 'app', 'build.gradle');

  const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf8'));
  const nextVersion = bumpSemver(rootPkg.version);
  rootPkg.version = nextVersion;
  writeFileSync(rootPkgPath, JSON.stringify(rootPkg, null, 2) + '\n', 'utf8');

  const webPkg = JSON.parse(readFileSync(webPkgPath, 'utf8'));
  webPkg.version = nextVersion;
  writeFileSync(webPkgPath, JSON.stringify(webPkg, null, 2) + '\n', 'utf8');

  let gradleContent = readFileSync(gradlePath, 'utf8');
  const codeMatch = /versionCode\s+(\d+)/.exec(gradleContent);
  const nextCode = codeMatch ? parseInt(codeMatch[1], 10) + 1 : 2;
  gradleContent = gradleContent
    .replace(/versionCode\s+\d+/, `versionCode ${nextCode}`)
    .replace(/versionName\s+"[^"]*"/, `versionName "${nextVersion}"`);
  writeFileSync(gradlePath, gradleContent, 'utf8');

  console.log(`[Release] 版本号已自动升级至 v${nextVersion} (Android versionCode=${nextCode})`);
  return nextVersion;
}

function cleanOldDeliverables() {
  for (const name of readdirSync(REPO_ROOT)) {
    if (
      (name.startsWith('LifeHub-Desktop-win-x64') && name.endsWith('.exe')) ||
      (name.startsWith('LifeHub-xiaomi15-') && name.endsWith('.apk'))
    ) {
      try {
        rmSync(join(REPO_ROOT, name), { force: true });
      } catch {
        // 忽略正在运行的进程占用
      }
    }
  }
}

function main() {
  const version = updateVersionFiles();
  cleanOldDeliverables();

  console.log(`[Release] 1/2 开始构建 Windows 桌面版 LifeHub-Desktop-win-x64-v${version}.exe ...`);
  execSync('node scripts/build-desktop-windows.mjs', {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });

  console.log(`[Release] 2/2 开始同步并构建 Android APK LifeHub-xiaomi15-v${version}.apk ...`);
  const webDir = join(REPO_ROOT, 'apps', 'web');
  const androidDir = join(webDir, 'android');
  execSync('npx cap sync android', { cwd: webDir, stdio: 'inherit' });
  execSync('.\\gradlew.bat assembleDebug --no-daemon', { cwd: androidDir, stdio: 'inherit' });

  const builtApk = join(androidDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
  const targetApk = join(REPO_ROOT, `LifeHub-xiaomi15-v${version}.apk`);
  copyFileSync(builtApk, targetApk);

  console.log(`\n[Release] 双端打包完成（v${version}）：`);
  console.log(`  - Windows 桌面版: ${join(REPO_ROOT, `LifeHub-Desktop-win-x64-v${version}.exe`)}`);
  console.log(`  - Android 手机版: ${targetApk}`);
}

main();
