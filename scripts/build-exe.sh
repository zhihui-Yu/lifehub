#!/usr/bin/env sh
#
# LifeHub Windows 原生桌面版 EXE 独立打包脚本。
#
# 用法：
#   ./scripts/build-exe.sh                  # 自动按分支命名（master 输出正式名，PR 分支自动带 -test 后缀不覆盖正式包）
#   ./scripts/build-exe.sh --test           # 强制输出测试包：LifeHub-Desktop-win-x64-v<version>-test.exe
#   ./scripts/build-exe.sh --release        # 强制输出正式包：LifeHub-Desktop-win-x64-v<version>.exe
#   ./scripts/build-exe.sh --skip-web-build # 复用已有 apps/web/dist，跳过前端重复构建
#   ./scripts/build-exe.sh --out my.exe     # 自定义输出文件名（相对于仓库根目录或绝对路径）

set -eu

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(dirname -- "$SCRIPT_DIR")

MODE="auto"
CUSTOM_OUT=""
SKIP_WEB_BUILD=0

print_usage() {
  cat <<'EOF'
用法: ./scripts/build-exe.sh [选项]

选项:
  --test             输出测试包 LifeHub-Desktop-win-x64-v<version>-test.exe（不覆盖正式包）
  --release          输出正式包 LifeHub-Desktop-win-x64-v<version>.exe
  --out <文件名>     指定输出 EXE 文件名或路径
  --skip-web-build   若 apps/web/dist 已存在，跳过前端构建直接封装编译 EXE
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
        echo "[EXE Build] 错误：--out 需要指定文件名参数" >&2
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
      echo "[EXE Build] 未知参数：$1（使用 --help 查看用法）" >&2
      exit 1
      ;;
  esac
done

cd "$REPO_ROOT"

VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('package.json','utf8')).version || '0.2.0')")
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")

if [ -n "$CUSTOM_OUT" ]; then
  OUT_ARG="$CUSTOM_OUT"
else
  if [ "$MODE" = "auto" ]; then
    if [ "$BRANCH" = "master" ] || [ "$BRANCH" = "main" ]; then
      MODE="release"
    else
      MODE="test"
    fi
  fi

  if [ "$MODE" = "release" ]; then
    OUT_ARG="LifeHub-Desktop-win-x64-v${VERSION}.exe"
  else
    OUT_ARG="LifeHub-Desktop-win-x64-v${VERSION}-test.exe"
  fi
fi

# 在 Git Bash / MSYS 下若用户传了 POSIX 绝对路径（如 /d/...），转为 Windows 路径传给 Node
case "$(uname -s 2>/dev/null || echo unknown)" in
  MINGW*|MSYS*|CYGWIN*)
    if command -v cygpath >/dev/null 2>&1; then
      case "$OUT_ARG" in
        /*) OUT_ARG=$(cygpath -w "$OUT_ARG") ;;
      esac
    fi
    ;;
esac

echo "[EXE Build] 当前分支: ${BRANCH} | 版本: v${VERSION}"
echo "[EXE Build] 目标产物: ${OUT_ARG}"

if [ "$SKIP_WEB_BUILD" -eq 1 ]; then
  node "${SCRIPT_DIR}/build-desktop-windows.mjs" --out "$OUT_ARG" --skip-web-build
else
  node "${SCRIPT_DIR}/build-desktop-windows.mjs" --out "$OUT_ARG"
fi
