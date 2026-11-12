package app.lifehub.local;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
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
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * LifeHub Android 主 Activity（适配小米 15 / Android 15 HyperOS）。
 *
 * 说明：
 * 1. 承载 Capacitor WebView（安全源 https://localhost，原生支持 WebCrypto 与 IndexedDB）；
 * 2. 注入 LifeHubAndroid 原生文件保存与文件夹选择桥接，使导出文件直接落盘至手机 Download 目录或指定子目录。
 */
public class MainActivity extends BridgeActivity {

    private ActivityResultLauncher<Intent> directoryPickerLauncher;

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

    /**
     * 供前端 downloadText 与 pickWebDirectoryHandle 调用的本地文件导出与目录选择桥接（纯本地，零网络交互）。
     */
    public class AndroidFileBridge {

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
        public void saveTextFile(String fileName, String content, String mimeType) {
            saveTextFile(fileName, content, mimeType, "LifeHub");
        }

        @JavascriptInterface
        public void saveTextFile(String fileName, String content, String mimeType, String subDir) {
            runOnUiThread(() -> {
                try {
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
                        ContentValues values = new ContentValues();
                        values.put(MediaStore.Downloads.DISPLAY_NAME, safeName);
                        values.put(MediaStore.Downloads.MIME_TYPE, safeMime);
                        values.put(MediaStore.Downloads.RELATIVE_PATH, relativeDownloadPath);

                        ContentResolver resolver = getContentResolver();
                        Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                        if (uri != null) {
                            try (OutputStream out = resolver.openOutputStream(uri)) {
                                if (out != null) {
                                    out.write(bytes);
                                    out.flush();
                                }
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
                        try (FileOutputStream out = new FileOutputStream(target)) {
                            out.write(bytes);
                            out.flush();
                        }
                    }

                    Toast.makeText(
                        MainActivity.this,
                        "已保存至手机「" + relativeDownloadPath + "」目录：" + safeName,
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
    }
}
