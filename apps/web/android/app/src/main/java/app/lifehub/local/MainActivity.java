package app.lifehub.local;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.ProtocolException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.concurrent.ConcurrentHashMap;
import org.json.JSONObject;

/**
 * LifeHub Android 主 Activity（适配小米 15 / Android 15 HyperOS）。
 *
 * 说明：
 * 1. 承载 Capacitor WebView（安全源 https://localhost，原生支持 WebCrypto 与 IndexedDB）；
 * 2. 注入 LifeHubAndroid 原生文件保存、文件夹选择与云存储免跨域 HTTP 桥接。
 */
public class MainActivity extends BridgeActivity {

    private ActivityResultLauncher<Intent> directoryPickerLauncher;
    private final ConcurrentHashMap<String, String> cloudHttpResponses = new ConcurrentHashMap<>();

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        directoryPickerLauncher = registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            result -> {
                String pickedPath = "";
                if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
                    Uri treeUri = result.getData().getData();
                    if (treeUri != null) {
                        pickedPath = extractReadableFolderName(treeUri);
                    }
                }
                notifyWebDirectoryPicked(pickedPath);
            }
        );

        View contentView = findViewById(android.R.id.content);
        if (contentView != null) {
            ViewCompat.setOnApplyWindowInsetsListener(contentView, (v, windowInsets) -> {
                Insets insets = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
                );
                v.setPadding(insets.left, insets.top, insets.right, insets.bottom);
                return WindowInsetsCompat.CONSUMED;
            });
        }
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView webView = getBridge().getWebView();
            webView.addJavascriptInterface(new AndroidFileBridge(), "LifeHubAndroid");
        }
    }

    private String extractReadableFolderName(Uri treeUri) {
        try {
            String docId = DocumentsContract.getTreeDocumentId(treeUri);
            if (docId != null) {
                // 例如 "primary:Download/LifeHubBackup" 或 "primary:MyFolder"
                int colonIdx = docId.indexOf(':');
                String rel = colonIdx >= 0 ? docId.substring(colonIdx + 1) : docId;
                rel = rel.replace("\\", "/").replaceAll("^/+|/+$", "");
                if (rel.toLowerCase().startsWith("download/")) {
                    rel = rel.substring("download/".length());
                } else if (rel.equalsIgnoreCase("download")) {
                    rel = "LifeHub";
                }
                if (!rel.isEmpty()) {
                    return rel;
                }
            }
        } catch (Exception ignored) {
        }
        String lastSeg = treeUri.getLastPathSegment();
        if (lastSeg != null && !lastSeg.trim().isEmpty()) {
            int colon = lastSeg.indexOf(':');
            return colon >= 0 ? lastSeg.substring(colon + 1) : lastSeg;
        }
        return "LifeHub";
    }

    private void notifyWebDirectoryPicked(String pickedPath) {
        runOnUiThread(() -> {
            if (getBridge() != null && getBridge().getWebView() != null) {
                String escaped = (pickedPath == null ? "" : pickedPath)
                    .replace("\\", "\\\\")
                    .replace("'", "\\'");
                String js = "window.dispatchEvent(new CustomEvent('lifehub:android-dir-picked', { detail: { path: '" + escaped + "' } }));";
                getBridge().getWebView().evaluateJavascript(js, null);
            }
        });
    }

    private void notifyWebCloudHttpDone(String requestId) {
        runOnUiThread(() -> {
            if (getBridge() != null && getBridge().getWebView() != null) {
                String escaped = (requestId == null ? "" : requestId)
                    .replace("\\", "\\\\")
                    .replace("'", "\\'");
                String js = "window.dispatchEvent(new CustomEvent('lifehub:android-http-done', { detail: { requestId: '" + escaped + "' } }));";
                getBridge().getWebView().evaluateJavascript(js, null);
            }
        });
    }

    private static String readStreamUtf8(InputStream stream) throws Exception {
        if (stream == null) {
            return "";
        }
        try (InputStream in = stream; ByteArrayOutputStream bos = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            int len;
            while ((len = in.read(buf)) != -1) {
                bos.write(buf, 0, len);
            }
            return new String(bos.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    /**
     * 供前端调用的本地文件导出、目录选择与对象存储免 CORS 原生 HTTP 桥接。
     */
    public class AndroidFileBridge {

        /**
         * 在原生后台线程发起云对象存储（COS / OSS / OBS / S3 / WebDAV）HTTP 请求，绕过 WebView CORS 限制。
         */
        @JavascriptInterface
        public void startCloudHttpRequest(
            String requestId,
            String targetUrl,
            String method,
            String headersJson,
            String bodyText
        ) {
            final String safeId = requestId == null ? "" : requestId;
            new Thread(() -> {
                HttpURLConnection conn = null;
                try {
                    String upperMethod = (method == null || method.trim().isEmpty())
                        ? "GET"
                        : method.trim().toUpperCase();
                    URL url = new URL(targetUrl);
                    conn = (HttpURLConnection) url.openConnection();
                    conn.setInstanceFollowRedirects(false);
                    conn.setConnectTimeout(15000);
                    conn.setReadTimeout(30000);

                    try {
                        conn.setRequestMethod(upperMethod);
                    } catch (ProtocolException pe) {
                        JSONObject unsupported = new JSONObject();
                        unsupported.put("proxied", true);
                        unsupported.put("status", 405);
                        unsupported.put("body", "");
                        cloudHttpResponses.put(safeId, unsupported.toString());
                        notifyWebCloudHttpDone(safeId);
                        return;
                    }

                    if (headersJson != null && !headersJson.trim().isEmpty()) {
                        JSONObject hdrs = new JSONObject(headersJson);
                        Iterator<String> keys = hdrs.keys();
                        while (keys.hasNext()) {
                            String k = keys.next();
                            if (k != null && !k.equalsIgnoreCase("Host")) {
                                conn.setRequestProperty(k, hdrs.optString(k, ""));
                            }
                        }
                    }

                    if ("PUT".equals(upperMethod) || "POST".equals(upperMethod)) {
                        byte[] payloadBytes = (bodyText == null ? "" : bodyText).getBytes(StandardCharsets.UTF_8);
                        conn.setDoOutput(true);
                        conn.setFixedLengthStreamingMode(payloadBytes.length);
                        try (OutputStream os = conn.getOutputStream()) {
                            os.write(payloadBytes);
                            os.flush();
                        }
                    }

                    int status = conn.getResponseCode();
                    InputStream respStream = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
                    String respText = readStreamUtf8(respStream);

                    JSONObject okJson = new JSONObject();
                    okJson.put("proxied", true);
                    okJson.put("status", status);
                    okJson.put("body", respText);
                    cloudHttpResponses.put(safeId, okJson.toString());
                } catch (Exception e) {
                    try {
                        JSONObject errJson = new JSONObject();
                        errJson.put("proxied", true);
                        errJson.put("status", 502);
                        errJson.put(
                            "body",
                            e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName()
                        );
                        cloudHttpResponses.put(safeId, errJson.toString());
                    } catch (Exception ignored) {
                    }
                } finally {
                    if (conn != null) {
                        conn.disconnect();
                    }
                    notifyWebCloudHttpDone(safeId);
                }
            }).start();
        }

        /**
         * 取出并清理已完成云存储请求的 JSON 响应结果。
         */
        @JavascriptInterface
        public String takeCloudHttpResponse(String requestId) {
            if (requestId == null) {
                return "";
            }
            String res = cloudHttpResponses.remove(requestId);
            return res == null ? "" : res;
        }

        @JavascriptInterface
        public void pickDirectory() {
            runOnUiThread(() -> {
                try {
                    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
                    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                    directoryPickerLauncher.launch(intent);
                } catch (Exception e) {
                    Toast.makeText(
                        MainActivity.this,
                        "无法打开系统文件夹选择器：" + e.getMessage(),
                        Toast.LENGTH_LONG
                    ).show();
                    notifyWebDirectoryPicked("");
                }
            });
        }

        @JavascriptInterface
        public void migrateDirectory(String fromSubDir, String toSubDir) {
            runOnUiThread(() -> {
                try {
                    String fromClean = (fromSubDir == null)
                        ? ""
                        : fromSubDir.trim().replace("\\", "/").replaceAll("\\.\\.+", "").replaceAll("^/+|/+$", "");
                    String toClean = (toSubDir == null)
                        ? ""
                        : toSubDir.trim().replace("\\", "/").replaceAll("\\.\\.+", "").replaceAll("^/+|/+$", "");
                    if (fromClean.equalsIgnoreCase(toClean)) {
                        return;
                    }
                    String fromRel = fromClean.isEmpty()
                        ? Environment.DIRECTORY_DOWNLOADS + "/"
                        : Environment.DIRECTORY_DOWNLOADS + "/" + fromClean + "/";
                    String toRel = toClean.isEmpty()
                        ? Environment.DIRECTORY_DOWNLOADS + "/"
                        : Environment.DIRECTORY_DOWNLOADS + "/" + toClean + "/";

                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        ContentResolver resolver = getContentResolver();
                        ContentValues values = new ContentValues();
                        values.put(MediaStore.Downloads.RELATIVE_PATH, toRel);
                        resolver.update(
                            MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                            values,
                            MediaStore.Downloads.RELATIVE_PATH + " = ?",
                            new String[] { fromRel }
                        );
                    }

                    File baseDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                    File srcDir = fromClean.isEmpty() ? baseDir : new File(baseDir, fromClean);
                    File dstDir = toClean.isEmpty() ? baseDir : new File(baseDir, toClean);
                    if (srcDir.exists() && srcDir.isDirectory()) {
                        if (!dstDir.exists()) {
                            //noinspection ResultOfMethodCallIgnored
                            dstDir.mkdirs();
                        }
                        File[] files = srcDir.listFiles();
                        if (files != null) {
                            byte[] buf = new byte[8192];
                            for (File f : files) {
                                if (f.isFile()) {
                                    String name = f.getName().toLowerCase();
                                    if (name.startsWith("lifehub") || name.endsWith(".json") || name.endsWith(".csv") || name.endsWith(".enc")) {
                                        File target = new File(dstDir, f.getName());
                                        try (FileInputStream in = new FileInputStream(f);
                                             FileOutputStream out = new FileOutputStream(target)) {
                                            int len;
                                            while ((len = in.read(buf)) > 0) {
                                                out.write(buf, 0, len);
                                            }
                                            out.flush();
                                        } catch (Exception ignored) {
                                        }
                                    }
                                }
                            }
                        }
                    }
                } catch (Exception ignored) {
                }
            });
        }

        @JavascriptInterface
        public void saveTextFile(String fileName, String content, String mimeType) {
            saveTextFile(fileName, content, mimeType, "LifeHub");
        }

        /**
         * 静默保存：供数据变更后的自动落盘调用，成功时不弹 Toast，同名文件直接覆盖。
         */
        @JavascriptInterface
        public void saveTextFileSilent(String fileName, String content, String mimeType, String subDir) {
            new Thread(() -> {
                try {
                    writeFileOverwrite(fileName, content, mimeType, subDir);
                } catch (Exception ignored) {
                }
            }).start();
        }

        @JavascriptInterface
        public void saveTextFile(String fileName, String content, String mimeType, String subDir) {
            runOnUiThread(() -> {
                try {
                    String[] result = writeFileOverwrite(fileName, content, mimeType, subDir);
                    Toast.makeText(
                        MainActivity.this,
                        "已保存至手机「" + result[0] + "」目录：" + result[1],
                        Toast.LENGTH_LONG
                    ).show();
                } catch (Exception e) {
                    Toast.makeText(
                        MainActivity.this,
                        "保存文件失败：" + e.getMessage(),
                        Toast.LENGTH_LONG
                    ).show();
                }
            });
        }

        /**
         * 写入 Download/&lt;subDir&gt;/fileName；若本应用已创建过同名文件则覆盖，避免产生「xxx (1).json」重复文件。
         *
         * @return [相对目录, 文件名]
         */
        private synchronized String[] writeFileOverwrite(String fileName, String content, String mimeType, String subDir) throws Exception {
            String safeName = (fileName == null || fileName.trim().isEmpty())
                ? "lifehub-export.json"
                : fileName.trim();
            String safeMime = (mimeType == null || mimeType.trim().isEmpty())
                ? "application/json"
                : mimeType.trim();
            String cleanedSubDir = (subDir == null)
                ? ""
                : subDir.trim().replace("\\", "/").replaceAll("\\.\\.+", "").replaceAll("^/+|/+$", "");
            String relativeDownloadPath = cleanedSubDir.isEmpty()
                ? Environment.DIRECTORY_DOWNLOADS
                : Environment.DIRECTORY_DOWNLOADS + "/" + cleanedSubDir;
            byte[] bytes = (content == null ? "" : content).getBytes(StandardCharsets.UTF_8);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentResolver resolver = getContentResolver();
                Uri collection = MediaStore.Downloads.EXTERNAL_CONTENT_URI;
                Uri uri = null;

                // 查找本应用之前写过的同名文件（MediaStore 中 RELATIVE_PATH 以 "/" 结尾）
                try (Cursor cursor = resolver.query(
                    collection,
                    new String[] { MediaStore.Downloads._ID },
                    MediaStore.Downloads.DISPLAY_NAME + " = ? AND " + MediaStore.Downloads.RELATIVE_PATH + " IN (?, ?)",
                    new String[] { safeName, relativeDownloadPath + "/", relativeDownloadPath },
                    null
                )) {
                    if (cursor != null && cursor.moveToFirst()) {
                        long id = cursor.getLong(0);
                        uri = ContentUris.withAppendedId(collection, id);
                    }
                } catch (Exception ignored) {
                }

                if (uri == null) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Downloads.DISPLAY_NAME, safeName);
                    values.put(MediaStore.Downloads.MIME_TYPE, safeMime);
                    values.put(MediaStore.Downloads.RELATIVE_PATH, relativeDownloadPath);
                    uri = resolver.insert(collection, values);
                }
                if (uri == null) {
                    throw new IllegalStateException("无法创建文件 " + safeName);
                }
                // "wt"：截断后写入，确保覆盖旧内容
                try (OutputStream out = resolver.openOutputStream(uri, "wt")) {
                    if (out != null) {
                        out.write(bytes);
                        out.flush();
                    }
                }
            } else {
                File baseDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                File dir = cleanedSubDir.isEmpty() ? baseDir : new File(baseDir, cleanedSubDir);
                if (!dir.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    dir.mkdirs();
                }
                File target = new File(dir, safeName);
                try (FileOutputStream out = new FileOutputStream(target, false)) {
                    out.write(bytes);
                    out.flush();
                }
            }
            return new String[] { relativeDownloadPath, safeName };
        }
    }
}
