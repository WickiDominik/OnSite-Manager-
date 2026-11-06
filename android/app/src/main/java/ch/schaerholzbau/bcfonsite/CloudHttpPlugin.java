package ch.schaerholzbau.bcfonsite;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Iterator;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.Headers;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * Native HTTP for the cloud import (Nextcloud WebDAV, Microsoft Graph).
 *
 * The built-in CapacitorHttp uses HttpURLConnection, which rejects WebDAV methods such as PROPFIND,
 * and the WebView itself is blocked by CORS. This plugin uses OkHttp, which allows any method, and
 * streams downloads straight into the cache directory so large IFC files never pass the JS bridge.
 */
@CapacitorPlugin(name = "CloudHttp")
public class CloudHttpPlugin extends Plugin {

    private final OkHttpClient client = new OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(5, TimeUnit.MINUTES)
        .followRedirects(true)
        .followSslRedirects(true)
        .build();

    private Request buildRequest(PluginCall call) {
        String url = call.getString("url", "");
        String method = call.getString("method", "GET").toUpperCase(Locale.ROOT);
        String body = call.getString("body");
        JSObject headers = call.getObject("headers", new JSObject());

        Request.Builder builder = new Request.Builder().url(url);
        String contentType = null;
        Iterator<String> keys = headers.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            String value = headers.getString(key);
            if (value == null) continue;
            if (key.equalsIgnoreCase("content-type")) contentType = value;
            builder.header(key, value);
        }

        RequestBody requestBody = null;
        MediaType mediaType = contentType != null ? MediaType.parse(contentType) : null;
        if (body != null && !method.equals("GET") && !method.equals("HEAD")) {
            requestBody = RequestBody.create(mediaType, body);
        } else if (method.equals("POST") || method.equals("PUT") || method.equals("PATCH") || method.equals("PROPPATCH") || method.equals("REPORT")) {
            requestBody = RequestBody.create(mediaType, new byte[0]);
        }
        builder.method(method, requestBody);
        return builder.build();
    }

    private static JSObject headersToJs(Headers headers) {
        JSObject out = new JSObject();
        for (String name : headers.names()) {
            out.put(name.toLowerCase(Locale.ROOT), headers.get(name));
        }
        return out;
    }

    /** request({ url, method, headers, body }) → { status, headers, data } (text body) */
    @PluginMethod
    public void request(final PluginCall call) {
        final Request request;
        try {
            request = buildRequest(call);
        } catch (Exception e) {
            call.reject("Ungültige Anfrage: " + e.getMessage());
            return;
        }
        client.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(Call c, IOException e) {
                call.reject("Netzwerkfehler: " + e.getMessage());
            }

            @Override
            public void onResponse(Call c, Response response) {
                try (ResponseBody rb = response.body()) {
                    JSObject ret = new JSObject();
                    ret.put("status", response.code());
                    ret.put("headers", headersToJs(response.headers()));
                    ret.put("data", rb != null ? rb.string() : "");
                    call.resolve(ret);
                } catch (Exception e) {
                    call.reject("Antwort konnte nicht gelesen werden: " + e.getMessage());
                }
            }
        });
    }

    /**
     * download({ url, headers }) → { status, path, headers, data? }
     * On success the body is written to the cache directory; on an error status the text body is returned in data.
     */
    @PluginMethod
    public void download(final PluginCall call) {
        final Request request;
        try {
            request = buildRequest(call);
        } catch (Exception e) {
            call.reject("Ungültige Anfrage: " + e.getMessage());
            return;
        }
        client.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(Call c, IOException e) {
                call.reject("Netzwerkfehler: " + e.getMessage());
            }

            @Override
            public void onResponse(Call c, Response response) {
                try (ResponseBody rb = response.body()) {
                    JSObject ret = new JSObject();
                    ret.put("status", response.code());
                    ret.put("headers", headersToJs(response.headers()));
                    if (!response.isSuccessful() || rb == null) {
                        ret.put("data", rb != null ? rb.string() : "");
                        call.resolve(ret);
                        return;
                    }
                    File dir = new File(getContext().getCacheDir(), "cloud-import");
                    if (!dir.exists() && !dir.mkdirs()) throw new IOException("Cache-Ordner nicht verfügbar");
                    File out = new File(dir, UUID.randomUUID().toString());
                    long size = 0;
                    try (InputStream in = rb.byteStream(); OutputStream os = new FileOutputStream(out)) {
                        byte[] buf = new byte[64 * 1024];
                        int n;
                        while ((n = in.read(buf)) != -1) {
                            os.write(buf, 0, n);
                            size += n;
                        }
                    }
                    ret.put("path", out.getAbsolutePath());
                    ret.put("size", size);
                    call.resolve(ret);
                } catch (Exception e) {
                    call.reject("Download fehlgeschlagen: " + e.getMessage());
                }
            }
        });
    }

    /** remove({ path }) – delete a downloaded temp file (only inside the cloud-import cache folder). */
    @PluginMethod
    public void remove(PluginCall call) {
        String path = call.getString("path", "");
        File dir = new File(getContext().getCacheDir(), "cloud-import");
        File f = new File(path);
        try {
            if (f.getCanonicalPath().startsWith(dir.getCanonicalPath() + File.separator)) {
                //noinspection ResultOfMethodCallIgnored
                f.delete();
            }
        } catch (IOException ignored) {
            // best effort
        }
        call.resolve();
    }
}
