package com.phoenix.qdqr.meshworkshop;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Android Storage Access Framework Save As. Filesystem writes export to the
 * app's cache; users then pick their own Documents/Downloads/folder.
 * No broad-storage permissions, Telegram, or external-file providers needed.
 */
@CapacitorPlugin(name = "NativeFileSave")
public class NativeFileSavePlugin extends Plugin {
    @PluginMethod
    public void saveAs(PluginCall call) {
        String fileName = call.getString("fileName");
        if (fileName == null || fileName.trim().isEmpty()
                || !new File(fileName).getName().equals(fileName)) {
            call.reject("Неверное имя файла");
            return;
        }
        File cacheFile = new File(getContext().getCacheDir(), fileName);
        if (!cacheFile.isFile()) {
            call.reject("Временный файл не найден. Повтори экспорт.");
            return;
        }

        String mime = call.getString("mimeType", "application/octet-stream");
        Intent create = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        create.addCategory(Intent.CATEGORY_OPENABLE);
        create.setType(mime);
        create.putExtra(Intent.EXTRA_TITLE, fileName);
        startActivityForResult(call, create, "createdDocument");
    }

    @ActivityCallback
    private void createdDocument(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK ||
                result.getData() == null || result.getData().getData() == null) {
            JSObject canceled = new JSObject();
            canceled.put("saved", false);
            canceled.put("canceled", true);
            call.resolve(canceled);
            return;
        }
        String fileName = call.getString("fileName");
        if (fileName == null || !new File(fileName).getName().equals(fileName)) {
            call.reject("Не удалось определить файл для сохранения");
            return;
        }
        File cacheFile = new File(getContext().getCacheDir(), fileName);
        Uri destination = result.getData().getData();
        if (!cacheFile.isFile()) {
            call.reject("Исходный файл исчез из кеша. Повтори экспорт.");
            return;
        }
        try (InputStream input = new FileInputStream(cacheFile);
             OutputStream output = getContext().getContentResolver()
                     .openOutputStream(destination, "w")) {
            if (output == null) throw new java.io.IOException("Не удалось открыть выбранную папку");
            byte[] buffer = new byte[65536];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
            output.flush();
            JSObject saved = new JSObject();
            saved.put("saved", true);
            saved.put("canceled", false);
            saved.put("uri", destination.toString());
            call.resolve(saved);
        } catch (Exception e) {
            call.reject("Не удалось сохранить файл: " + e.getMessage(), e);
        }
    }
}
