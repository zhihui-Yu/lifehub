package app.lifehub.local;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Toast;
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
 * 2. 注入 LifeHubAndroid 原生文件保存桥接，使「下载盐值备份」「导出加密备份」直接落盘至手机 Download 目录。
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
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

    /**
     * 供前端 downloadText 调用的本地文件导出桥接（纯本地写入，零网络交互）。
     */
    public class AndroidFileBridge {

        @JavascriptInterface
        public void saveTextFile(String fileName, String content, String mimeType) {
            runOnUiThread(() -> {
                try {
                    String safeName = (fileName == null || fileName.trim().isEmpty())
                        ? "lifehub-export.json"
                        : fileName.trim();
                    String safeMime = (mimeType == null || mimeType.trim().isEmpty())
                        ? "application/json"
                        : mimeType.trim();
                    byte[] bytes = (content == null ? "" : content).getBytes(StandardCharsets.UTF_8);

                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        ContentValues values = new ContentValues();
                        values.put(MediaStore.Downloads.DISPLAY_NAME, safeName);
                        values.put(MediaStore.Downloads.MIME_TYPE, safeMime);
                        values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);

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
                        File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
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
                        "已保存至手机「下载 (Download)」目录：" + safeName,
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
