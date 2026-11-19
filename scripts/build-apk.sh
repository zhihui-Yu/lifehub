#!/usr/bin/env sh
#
# LifeHub Android 手机端 APK 独立打包脚本。
#
# 用法：
#   ./scripts/build-apk.sh                  # 自动按分支命名（master 输出正式名，PR 分支自动带 -test 后缀不覆盖正式包）
#   ./scripts/build-apk.sh --test           # 强制输出测试包：LifeHub-Android-v<version>-test.apk
#   ./scripts/build-apk.sh --release        # 强制输出正式包：LifeHub-Android-v<version>.apk
#   ./scripts/build-apk.sh --skip-web-build # 复用已有 apps/web/dist，跳过前端重复构建
#   ./scripts/build-apk.sh --out my.apk     # 自定义输出文件名（相对于仓库根目录或绝对路径）

set -eu

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(dirname -- "$SCRIPT_DIR")

MODE="auto"
CUSTOM_OUT=""
SKIP_WEB_BUILD=0

print_usage() {
  cat <<'EOF'
用法: ./scripts/build-apk.sh [选项]

选项:
  --test             输出测试包 LifeHub-Android-v<version>-test.apk（不覆盖正式包）
  --release          输出正式包 LifeHub-Android-v<version>.apk
  --out <文件名>     指定输出 APK 文件名或路径
  --skip-web-build   若 apps/web/dist 已存在，跳过前端构建直接同步打包 APK
  -h, --help         显示帮助信息

默认行为（不传 --test / --release / --out）：
  当前在 master/main 分支时输出正式包名，在其他开发/PR 分支时自动附加 -test 后缀。
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --test)
      MODE="test"
      shift
      ;;
    --release)
      MODE="release"
      shift
      ;;
    --skip-web-build)
      SKIP_WEB_BUILD=1
      shift
      ;;
    --out)
      if [ $# -lt 2 ]; then
        echo "[APK Build] 错误：--out 需要指定文件名参数" >&2
        exit 1
      fi
      CUSTOM_OUT="$2"
      shift 2
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    *)
      echo "[APK Build] 未知参数：$1（使用 --help 查看用法）" >&2
      exit 1
      ;;
  esac
done

cd "$REPO_ROOT"

VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('package.json','utf8')).version || '0.2.0')")
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")

if [ -n "$CUSTOM_OUT" ]; then
  case "$CUSTOM_OUT" in
    /*|[A-Za-z]:*)
      TARGET_APK="$CUSTOM_OUT"
      ;;
    *)
      TARGET_APK="${REPO_ROOT}/${CUSTOM_OUT}"
      ;;
  esac
else
  if [ "$MODE" = "auto" ]; then
    if [ "$BRANCH" = "master" ] || [ "$BRANCH" = "main" ]; then
      MODE="release"
    else
      MODE="test"
    fi
  fi

  if [ "$MODE" = "release" ]; then
    TARGET_APK="${REPO_ROOT}/LifeHub-Android-v${VERSION}.apk"
  else
    TARGET_APK="${REPO_ROOT}/LifeHub-Android-v${VERSION}-test.apk"
  fi
fi

echo "[APK Build] 当前分支: ${BRANCH} | 版本: v${VERSION}"
echo "[APK Build] 目标产物: ${TARGET_APK}"

if [ "$SKIP_WEB_BUILD" -eq 1 ] && [ -d "${REPO_ROOT}/apps/web/dist" ]; then
  echo "[APK Build] 1/3 检测到 --skip-web-build，直接复用现有 apps/web/dist ..."
else
  echo "[APK Build] 1/3 正在构建 @lifehub/web 前端生产资源..."
  npm run build --workspace @lifehub/web
fi

echo "[APK Build] 2/3 正在同步 Capacitor Android 资源..."
(
  cd "${REPO_ROOT}/apps/web"
  npx cap sync android
)

echo "[APK Build] 3/3 正在执行 Gradle 编译打包..."
(
  cd "${REPO_ROOT}/apps/web/android"
  case "$(uname -s 2>/dev/null || echo unknown)" in
    MINGW*|MSYS*|CYGWIN*)
      MSYS2_ARG_CONV_EXCL="*" cmd.exe /c "gradlew.bat assembleDebug --no-daemon"
      ;;
    *)
      ./gradlew assembleDebug --no-daemon
      ;;
  esac
)

BUILT_APK="${REPO_ROOT}/apps/web/android/app/build/outputs/apk/debug/app-debug.apk"
if [ ! -f "$BUILT_APK" ]; then
  echo "[APK Build] 错误：未找到编译产物 ${BUILT_APK}" >&2
  exit 1
fi

cp -f "$BUILT_APK" "$TARGET_APK"
echo "[APK Build] 打包完成！Android 安装包已生成：${TARGET_APK}"
