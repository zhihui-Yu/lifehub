#!/usr/bin/env node
/**
 * LifeHub Windows 原生桌面版（Native WinForms + WebView2 单文件 EXE）构建与打包脚本。
 *
 * 功能：
 * 1. 先执行 `@lifehub/web` 的生产构建，生成最新 `apps/web/dist` 静态资源；
 * 2. 将 `apps/web/dist` 静态资源与 `scripts/vendor/webview2` 原生组件（Core / WinForms / WebView2Loader）
 *    一并打包进 C# 原生桌面窗体程序；
 * 3. 调用 Windows 系统内置的 `.NET Framework 4.x` 编译器（`csc.exe`）直接编译为单文件免安装桌面应用：
 *    `D:\code\myapps\LifeHub-Desktop-win-x64.exe`
 *
 * 运行体验：
 * - 双击 `LifeHub-Desktop-win-x64.exe` 直接打开独立的 Windows 原生桌面窗口（内嵌 WebView2 渲染引擎，不再调用外部浏览器）；
 * - 内置服务与原生窗口同进程生命周期绑定（窗口打开即服务就绪，窗口关闭即退出，彻底杜绝 127.0.0.1 无法访问问题）；
 * - 原生支持「选择本地文件夹」（模态挂载在主窗口上）与全模块实时落盘、DeepSeek AI 代理兜底。
 */
import { execFileSync, execSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB_DIST_DIR = join(REPO_ROOT, 'apps', 'web', 'dist');
const VENDOR_WEBVIEW2_DIR = join(REPO_ROOT, 'scripts', 'vendor', 'webview2');
const BUILD_TMP_DIR = join(REPO_ROOT, 'apps', 'web', '.desktop-build');
const OUTPUT_EXE_PATH = join(REPO_ROOT, 'LifeHub-Desktop-win-x64.exe');
const CSC_PATH = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';

const MIME_MAP = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

function collectDistFiles(dir) {
  const results = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      results.push(...collectDistFiles(full));
    } else {
      results.push(full);
    }
  }
  return results;
}

function main() {
  if (!existsSync(CSC_PATH)) {
    console.error(`[Desktop Build] 未找到系统 C# 编译器: ${CSC_PATH}`);
    process.exit(1);
  }

  const coreDllPath = join(VENDOR_WEBVIEW2_DIR, 'Microsoft.Web.WebView2.Core.dll');
  const winformsDllPath = join(VENDOR_WEBVIEW2_DIR, 'Microsoft.Web.WebView2.WinForms.dll');
  const loaderDllPath = join(VENDOR_WEBVIEW2_DIR, 'WebView2Loader.dll');

  if (!existsSync(coreDllPath) || !existsSync(winformsDllPath) || !existsSync(loaderDllPath)) {
    console.error(`[Desktop Build] 缺少 WebView2 原生组件目录: ${VENDOR_WEBVIEW2_DIR}`);
    process.exit(1);
  }

  console.log('[Desktop Build] 1/3 正在构建 @lifehub/web 生产前端资源...');
  execSync('npm run build --workspace @lifehub/web', {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });

  if (!existsSync(WEB_DIST_DIR)) {
    console.error(`[Desktop Build] 未找到前端构建目录: ${WEB_DIST_DIR}`);
    process.exit(1);
  }

  console.log('[Desktop Build] 2/3 正在封装静态资源与 Windows 原生 WebView2 桌面窗体...');
  mkdirSync(BUILD_TMP_DIR, { recursive: true });

  const files = collectDistFiles(WEB_DIST_DIR);
  const embeddedEntries = [];

  for (const file of files) {
    const relPath = '/' + relative(WEB_DIST_DIR, file).split(sep).join('/');
    const ext = extname(file).toLowerCase();
    const mime = MIME_MAP[ext] || 'application/octet-stream';
    let buf = readFileSync(file);

    if (relPath === '/index.html') {
      const html = buf
        .toString('utf8')
        .replace('<head>', '<head><script>window.__LIFEHUB_DESKTOP__ = true;</script>');
      buf = Buffer.from(html, 'utf8');
    }

    const b64 = buf.toString('base64');
    embeddedEntries.push({ relPath, mime, b64 });
  }

  const coreDllB64 = readFileSync(coreDllPath).toString('base64');
  const winformsDllB64 = readFileSync(winformsDllPath).toString('base64');
  const loaderDllB64 = readFileSync(loaderDllPath).toString('base64');

  const csLines = [];
  csLines.push(`using System;`);
  csLines.push(`using System.Collections.Generic;`);
  csLines.push(`using System.Diagnostics;`);
  csLines.push(`using System.Drawing;`);
  csLines.push(`using System.IO;`);
  csLines.push(`using System.Net;`);
  csLines.push(`using System.Reflection;`);
  csLines.push(`using System.Runtime.CompilerServices;`);
  csLines.push(`using System.Runtime.InteropServices;`);
  csLines.push(`using System.Text;`);
  csLines.push(`using System.Threading;`);
  csLines.push(`using System.Windows.Forms;`);
  csLines.push(`using System.Web.Script.Serialization;`);
  csLines.push(`using Microsoft.Web.WebView2.Core;`);
  csLines.push(`using Microsoft.Web.WebView2.WinForms;`);
  csLines.push(``);
  csLines.push(`[assembly: AssemblyTitle("LifeHub Desktop")]`);
  csLines.push(`[assembly: AssemblyProduct("LifeHub")]`);
  csLines.push(`[assembly: AssemblyVersion("0.2.0.0")]`);
  csLines.push(``);
  csLines.push(`namespace LifeHubDesktop {`);
  csLines.push(`    internal sealed class AssetEntry {`);
  csLines.push(`        public string Mime;`);
  csLines.push(`        public byte[] Bytes;`);
  csLines.push(`    }`);
  csLines.push(``);
  csLines.push(`    internal static class Program {`);
  csLines.push(`        private const int PORT = 41880;`);
  csLines.push(`        private static Form MainFormInstance = null;`);
  csLines.push(`        private static string RuntimeDir = null;`);
  csLines.push(`        private static readonly Dictionary<string, AssetEntry> Assets = new Dictionary<string, AssetEntry>(StringComparer.OrdinalIgnoreCase);`);
  csLines.push(``);
  csLines.push(`        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]`);
  csLines.push(`        private static extern bool SetDllDirectory(string lpPathName);`);
  csLines.push(``);
  csLines.push(`        [DllImport("user32.dll")]`);
  csLines.push(`        private static extern bool SetProcessDPIAware();`);
  csLines.push(``);
  csLines.push(`        private static void EnsureNativeRuntimeExtracted() {`);
  csLines.push(`            RuntimeDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "LifeHubDesktop", "Runtime_v2");`);
  csLines.push(`            Directory.CreateDirectory(RuntimeDir);`);
  csLines.push(`            WriteFileIfMissing(Path.Combine(RuntimeDir, "Microsoft.Web.WebView2.Core.dll"), ${JSON.stringify(coreDllB64)});`);
  csLines.push(`            WriteFileIfMissing(Path.Combine(RuntimeDir, "Microsoft.Web.WebView2.WinForms.dll"), ${JSON.stringify(winformsDllB64)});`);
  csLines.push(`            WriteFileIfMissing(Path.Combine(RuntimeDir, "WebView2Loader.dll"), ${JSON.stringify(loaderDllB64)});`);
  csLines.push(`            SetDllDirectory(RuntimeDir);`);
  csLines.push(`            AppDomain.CurrentDomain.AssemblyResolve += (sender, args) => {`);
  csLines.push(`                string shortName = new AssemblyName(args.Name).Name + ".dll";`);
  csLines.push(`                string candidate = Path.Combine(RuntimeDir, shortName);`);
  csLines.push(`                if (File.Exists(candidate)) {`);
  csLines.push(`                    return Assembly.LoadFrom(candidate);`);
  csLines.push(`                }`);
  csLines.push(`                return null;`);
  csLines.push(`            };`);
  csLines.push(`        }`);
  csLines.push(``);
  csLines.push(`        private static void WriteFileIfMissing(string path, string b64) {`);
  csLines.push(`            try {`);
  csLines.push(`                byte[] bytes = Convert.FromBase64String(b64);`);
  csLines.push(`                if (!File.Exists(path) || new FileInfo(path).Length != bytes.Length) {`);
  csLines.push(`                    File.WriteAllBytes(path, bytes);`);
  csLines.push(`                }`);
  csLines.push(`            } catch { }`);
  csLines.push(`        }`);
  csLines.push(``);
  csLines.push(`        private static void InitAssets() {`);
  for (const item of embeddedEntries) {
    csLines.push(
      `            Assets[${JSON.stringify(item.relPath)}] = new AssetEntry { Mime = ${JSON.stringify(item.mime)}, Bytes = Convert.FromBase64String(${JSON.stringify(item.b64)}) };`,
    );
  }
  csLines.push(`        }`);
  csLines.push(``);
  csLines.push(`        [STAThread]`);
  csLines.push(`        private static void Main() {`);
  csLines.push(`            try { SetProcessDPIAware(); } catch { }`);
  csLines.push(`            ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072 | SecurityProtocolType.Tls;`);
  csLines.push(`            Application.EnableVisualStyles();`);
  csLines.push(`            Application.SetCompatibleTextRenderingDefault(false);`);
  csLines.push(``);
  csLines.push(`            // 若已有旧实例运行，清理旧进程以确保单实例加载最新桌面窗体`);
  csLines.push(`            try {`);
  csLines.push(`                Process cur = Process.GetCurrentProcess();`);
  csLines.push(`                foreach (Process p in Process.GetProcessesByName(cur.ProcessName)) {`);
  csLines.push(`                    if (p.Id != cur.Id) {`);
  csLines.push(`                        try { p.Kill(); p.WaitForExit(1500); } catch { }`);
  csLines.push(`                    }`);
  csLines.push(`                }`);
  csLines.push(`            } catch { }`);
  csLines.push(``);
  csLines.push(`            EnsureNativeRuntimeExtracted();`);
  csLines.push(`            InitAssets();`);
  csLines.push(``);
  csLines.push(`            string url = "http://127.0.0.1:" + PORT + "/";`);
  csLines.push(`            HttpListener listener = new HttpListener();`);
  csLines.push(`            listener.Prefixes.Add(url);`);
  csLines.push(`            for (int retry = 0; retry < 10; retry++) {`);
  csLines.push(`                try {`);
  csLines.push(`                    listener.Start();`);
  csLines.push(`                    break;`);
  csLines.push(`                } catch {`);
  csLines.push(`                    Thread.Sleep(150);`);
  csLines.push(`                }`);
  csLines.push(`            }`);
  csLines.push(``);
  csLines.push(`            Thread serverThread = new Thread(() => ServeLoop(listener));`);
  csLines.push(`            serverThread.IsBackground = true;`);
  csLines.push(`            serverThread.Start();`);
  csLines.push(``);
  csLines.push(`            try {`);
  csLines.push(`                RunNativeDesktopWindow(url);`);
  csLines.push(`            } finally {`);
  csLines.push(`                try { listener.Stop(); } catch { }`);
  csLines.push(`            }`);
  csLines.push(`        }`);
  csLines.push(``);
  csLines.push(`        [MethodImpl(MethodImplOptions.NoInlining)]`);
  csLines.push(`        private static void RunNativeDesktopWindow(string url) {`);
  csLines.push(`            string userDataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "LifeHubDesktop", "UserData");`);
  csLines.push(`            Directory.CreateDirectory(userDataDir);`);
  csLines.push(`            Environment.SetEnvironmentVariable("WEBVIEW2_USER_DATA_FOLDER", userDataDir);`);
  csLines.push(`            Environment.SetEnvironmentVariable("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "--proxy-bypass-list=<-loopback>;127.0.0.1;localhost");`);
  csLines.push(``);
  csLines.push(`            Form form = new Form();`);
  csLines.push(`            form.Text = "LifeHub · 个人生活与财务管理桌面版";`);
  csLines.push(`            form.Width = 1340;`);
  csLines.push(`            form.Height = 860;`);
  csLines.push(`            form.MinimumSize = new Size(960, 640);`);
  csLines.push(`            form.StartPosition = FormStartPosition.CenterScreen;`);
  csLines.push(`            form.BackColor = Color.FromArgb(15, 23, 42);`);
  csLines.push(`            try { form.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }`);
  csLines.push(`            MainFormInstance = form;`);
  csLines.push(``);
  csLines.push(`            WebView2 webView = new WebView2();`);
  csLines.push(`            webView.Dock = DockStyle.Fill;`);
  csLines.push(`            webView.DefaultBackgroundColor = Color.FromArgb(15, 23, 42);`);
  csLines.push(`            webView.CreationProperties = new CoreWebView2CreationProperties {`);
  csLines.push(`                UserDataFolder = userDataDir`);
  csLines.push(`            };`);
  csLines.push(`            webView.CoreWebView2InitializationCompleted += (sender, args) => {`);
  csLines.push(`                if (args.IsSuccess && webView.CoreWebView2 != null) {`);
  csLines.push(`                    webView.CoreWebView2.Settings.IsStatusBarEnabled = false;`);
  csLines.push(`                    webView.CoreWebView2.Settings.AreDevToolsEnabled = true;`);
  csLines.push(`                }`);
  csLines.push(`            };`);
  csLines.push(`            form.Controls.Add(webView);`);
  csLines.push(`            form.Load += (sender, args) => {`);
  csLines.push(`                webView.Source = new Uri(url);`);
  csLines.push(`            };`);
  csLines.push(``);
  csLines.push(`            Application.Run(form);`);
  csLines.push(`        }`);
  csLines.push(``);
  csLines.push(`        private static void ServeLoop(HttpListener listener) {`);
  csLines.push(`            while (listener.IsListening) {`);
  csLines.push(`                try {`);
  csLines.push(`                    HttpListenerContext ctx = listener.GetContext();`);
  csLines.push(`                    ThreadPool.QueueUserWorkItem(_ => HandleRequest(ctx));`);
  csLines.push(`                } catch {`);
  csLines.push(`                    break;`);
  csLines.push(`                }`);
  csLines.push(`            }`);
  csLines.push(`        }`);
  csLines.push(``);
  csLines.push(`        private static void HandleRequest(HttpListenerContext ctx) {`);
  csLines.push(`            try {`);
  csLines.push(`                string path = ctx.Request.Url.AbsolutePath;`);
  csLines.push(`                if (path == "/__lifehub_desktop__/ping") {`);
  csLines.push(`                    WriteJsonResponse(ctx.Response, 200, "{\\"ok\\":true}");`);
  csLines.push(`                    return;`);
  csLines.push(`                }`);
  csLines.push(`                if (path == "/__lifehub_desktop__/pick-directory" && ctx.Request.HttpMethod == "POST") {`);
  csLines.push(`                    string picked = null;`);
  csLines.push(`                    if (MainFormInstance != null && !MainFormInstance.IsDisposed && MainFormInstance.IsHandleCreated) {`);
  csLines.push(`                        MainFormInstance.Invoke(new Action(() => {`);
  csLines.push(`                            using (FolderBrowserDialog fbd = new FolderBrowserDialog()) {`);
  csLines.push(`                                fbd.Description = "选择 LifeHub 本地文件存储目录";`);
  csLines.push(`                                fbd.ShowNewFolderButton = true;`);
  csLines.push(`                                if (fbd.ShowDialog(MainFormInstance) == DialogResult.OK) {`);
  csLines.push(`                                    picked = fbd.SelectedPath;`);
  csLines.push(`                                }`);
  csLines.push(`                            }`);
  csLines.push(`                        }));`);
  csLines.push(`                    } else {`);
  csLines.push(`                        Thread sta = new Thread(() => {`);
  csLines.push(`                            using (FolderBrowserDialog fbd = new FolderBrowserDialog()) {`);
  csLines.push(`                                fbd.Description = "选择 LifeHub 本地文件存储目录";`);
  csLines.push(`                                fbd.ShowNewFolderButton = true;`);
  csLines.push(`                                if (fbd.ShowDialog() == DialogResult.OK) {`);
  csLines.push(`                                    picked = fbd.SelectedPath;`);
  csLines.push(`                                }`);
  csLines.push(`                            }`);
  csLines.push(`                        });`);
  csLines.push(`                        sta.SetApartmentState(ApartmentState.STA);`);
  csLines.push(`                        sta.Start();`);
  csLines.push(`                        sta.Join();`);
  csLines.push(`                    }`);
  csLines.push(`                    JavaScriptSerializer ser = new JavaScriptSerializer();`);
  csLines.push(`                    string json = ser.Serialize(new Dictionary<string, object> {`);
  csLines.push(`                        { "path", picked },`);
  csLines.push(`                        { "cancelled", string.IsNullOrEmpty(picked) }`);
  csLines.push(`                    });`);
  csLines.push(`                    WriteJsonResponse(ctx.Response, 200, json);`);
  csLines.push(`                    return;`);
  csLines.push(`                }`);
  csLines.push(``);
  csLines.push(`                if (path == "/__lifehub_desktop__/save-file" && ctx.Request.HttpMethod == "POST") {`);
  csLines.push(`                    string body;`);
  csLines.push(`                    using (StreamReader sr = new StreamReader(ctx.Request.InputStream, Encoding.UTF8)) {`);
  csLines.push(`                        body = sr.ReadToEnd();`);
  csLines.push(`                    }`);
  csLines.push(`                    JavaScriptSerializer ser = new JavaScriptSerializer();`);
  csLines.push(`                    ser.MaxJsonLength = int.MaxValue;`);
  csLines.push(`                    var payload = ser.Deserialize<Dictionary<string, string>>(body);`);
  csLines.push(`                    string fileName = payload != null && payload.ContainsKey("fileName") ? payload["fileName"] : "lifehub-export.json";`);
  csLines.push(`                    string content = payload != null && payload.ContainsKey("content") ? payload["content"] : "";`);
  csLines.push(`                    string subDir = payload != null && payload.ContainsKey("subDir") ? payload["subDir"] : "LifeHub";`);
  csLines.push(`                    foreach (char c in Path.GetInvalidFileNameChars()) { fileName = fileName.Replace(c, '_'); }`);
  csLines.push(`                    string targetDir;`);
  csLines.push(`                    if (!string.IsNullOrWhiteSpace(subDir) && subDir.Length >= 2 && subDir[1] == ':') {`);
  csLines.push(`                        targetDir = subDir.Replace('/', Path.DirectorySeparatorChar);`);
  csLines.push(`                    } else {`);
  csLines.push(`                        string downloads = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");`);
  csLines.push(`                        targetDir = Path.Combine(downloads, (subDir ?? "LifeHub").Replace('/', Path.DirectorySeparatorChar));`);
  csLines.push(`                    }`);
  csLines.push(`                    Directory.CreateDirectory(targetDir);`);
  csLines.push(`                    string fullPath = Path.Combine(targetDir, fileName);`);
  csLines.push(`                    File.WriteAllText(fullPath, content ?? "", new UTF8Encoding(false));`);
  csLines.push(`                    string json = ser.Serialize(new Dictionary<string, object> { { "ok", true }, { "fullPath", fullPath } });`);
  csLines.push(`                    WriteJsonResponse(ctx.Response, 200, json);`);
  csLines.push(`                    return;`);
  csLines.push(`                }`);
  csLines.push(``);
  csLines.push(`                if (path == "/__lifehub_desktop__/ai-proxy" && ctx.Request.HttpMethod == "POST") {`);
  csLines.push(`                    string reqBody;`);
  csLines.push(`                    using (StreamReader sr = new StreamReader(ctx.Request.InputStream, Encoding.UTF8)) {`);
  csLines.push(`                        reqBody = sr.ReadToEnd();`);
  csLines.push(`                    }`);
  csLines.push(`                    JavaScriptSerializer ser = new JavaScriptSerializer();`);
  csLines.push(`                    ser.MaxJsonLength = int.MaxValue;`);
  csLines.push(`                    var payload = ser.Deserialize<Dictionary<string, string>>(reqBody);`);
  csLines.push(`                    string targetUrl = payload != null && payload.ContainsKey("url") ? payload["url"] : "";`);
  csLines.push(`                    string authHeader = payload != null && payload.ContainsKey("authHeader") ? payload["authHeader"] : "";`);
  csLines.push(`                    string bodyJson = payload != null && payload.ContainsKey("bodyJson") ? payload["bodyJson"] : "{}";`);
  csLines.push(`                    HttpWebRequest webReq = (HttpWebRequest)WebRequest.Create(targetUrl);`);
  csLines.push(`                    webReq.Method = "POST";`);
  csLines.push(`                    webReq.ContentType = "application/json; charset=utf-8";`);
  csLines.push(`                    webReq.Timeout = 90000;`);
  csLines.push(`                    webReq.ReadWriteTimeout = 90000;`);
  csLines.push(`                    if (!string.IsNullOrEmpty(authHeader)) {`);
  csLines.push(`                        webReq.Headers["Authorization"] = authHeader;`);
  csLines.push(`                    }`);
  csLines.push(`                    byte[] postBytes = Encoding.UTF8.GetBytes(bodyJson);`);
  csLines.push(`                    webReq.ContentLength = postBytes.Length;`);
  csLines.push(`                    using (Stream reqStream = webReq.GetRequestStream()) {`);
  csLines.push(`                        reqStream.Write(postBytes, 0, postBytes.Length);`);
  csLines.push(`                    }`);
  csLines.push(`                    try {`);
  csLines.push(`                        using (HttpWebResponse webResp = (HttpWebResponse)webReq.GetResponse())`);
  csLines.push(`                        using (StreamReader respReader = new StreamReader(webResp.GetResponseStream(), Encoding.UTF8)) {`);
  csLines.push(`                            string respText = respReader.ReadToEnd();`);
  csLines.push(`                            WriteJsonResponse(ctx.Response, (int)webResp.StatusCode, respText);`);
  csLines.push(`                            return;`);
  csLines.push(`                        }`);
  csLines.push(`                    } catch (WebException wex) {`);
  csLines.push(`                        if (wex.Response != null) {`);
  csLines.push(`                            using (HttpWebResponse errResp = (HttpWebResponse)wex.Response)`);
  csLines.push(`                            using (StreamReader errReader = new StreamReader(errResp.GetResponseStream(), Encoding.UTF8)) {`);
  csLines.push(`                                string errText = errReader.ReadToEnd();`);
  csLines.push(`                                WriteJsonResponse(ctx.Response, (int)errResp.StatusCode, errText);`);
  csLines.push(`                                return;`);
  csLines.push(`                            }`);
  csLines.push(`                        }`);
  csLines.push(`                        WriteJsonResponse(ctx.Response, 502, ser.Serialize(new Dictionary<string, string> { { "message", wex.Message } }));`);
  csLines.push(`                        return;`);
  csLines.push(`                    }`);
  csLines.push(`                }`);
  csLines.push(``);
  csLines.push(`                AssetEntry asset;`);
  csLines.push(`                if (string.IsNullOrEmpty(path) || path == "/" || !Assets.TryGetValue(path, out asset)) {`);
  csLines.push(`                    asset = Assets["/index.html"];`);
  csLines.push(`                }`);
  csLines.push(`                ctx.Response.StatusCode = 200;`);
  csLines.push(`                ctx.Response.ContentType = asset.Mime;`);
  csLines.push(`                ctx.Response.ContentLength64 = asset.Bytes.Length;`);
  csLines.push(`                ctx.Response.OutputStream.Write(asset.Bytes, 0, asset.Bytes.Length);`);
  csLines.push(`                ctx.Response.OutputStream.Close();`);
  csLines.push(`            } catch {`);
  csLines.push(`                try { ctx.Response.StatusCode = 500; ctx.Response.Close(); } catch { }`);
  csLines.push(`            }`);
  csLines.push(`        }`);
  csLines.push(``);
  csLines.push(`        private static void WriteJsonResponse(HttpListenerResponse resp, int status, string json) {`);
  csLines.push(`            byte[] bytes = Encoding.UTF8.GetBytes(json);`);
  csLines.push(`            resp.StatusCode = status;`);
  csLines.push(`            resp.ContentType = "application/json; charset=utf-8";`);
  csLines.push(`            resp.ContentLength64 = bytes.Length;`);
  csLines.push(`            resp.OutputStream.Write(bytes, 0, bytes.Length);`);
  csLines.push(`            resp.OutputStream.Close();`);
  csLines.push(`        }`);
  csLines.push(`    }`);
  csLines.push(`}`);

  const csFilePath = join(BUILD_TMP_DIR, 'LifeHubDesktop.cs');
  writeFileSync(csFilePath, csLines.join('\r\n'), 'utf8');

  console.log('[Desktop Build] 3/3 正在编译原生桌面端单文件程序 LifeHub-Desktop-win-x64.exe...');
  execFileSync(
    CSC_PATH,
    [
      '/nologo',
      '/target:winexe',
      '/optimize+',
      '/platform:x64',
      `/out:${OUTPUT_EXE_PATH}`,
      '/r:System.dll',
      '/r:System.Core.dll',
      '/r:System.Drawing.dll',
      '/r:System.Windows.Forms.dll',
      '/r:System.Web.Extensions.dll',
      `/r:${coreDllPath}`,
      `/r:${winformsDllPath}`,
      csFilePath,
    ],
    { stdio: 'inherit' },
  );

  rmSync(BUILD_TMP_DIR, { recursive: true, force: true });
  console.log(`[Desktop Build] 构建成功！Windows 原生桌面版已生成：${OUTPUT_EXE_PATH}`);
}

main();
