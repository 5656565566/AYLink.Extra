package com.aylink.mobile.logging

import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import com.aylink.mobile.BuildConfig
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class DiagnosticLogExporter(
    private val context: Context,
    private val logger: AppLogger
) {
    private val exportDir = File(context.cacheDir, "diagnostics")
    private val fileNameFormat = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).apply {
        timeZone = TimeZone.getDefault()
    }

    fun createExportIntent(): Intent {
        val exportFile = createExportFile()
        val uri = FileProvider.getUriForFile(
            context,
            "${BuildConfig.APPLICATION_ID}.fileprovider",
            exportFile
        )
        return Intent(Intent.ACTION_SEND).apply {
            type = "application/zip"
            putExtra(Intent.EXTRA_STREAM, uri)
            putExtra(Intent.EXTRA_SUBJECT, "AYLink Mobile diagnostic logs")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
    }

    private fun createExportFile(): File {
        exportDir.mkdirs()
        exportDir.listFiles()?.forEach { file ->
            if (file.isFile && file.name.endsWith(".zip")) {
                file.delete()
            }
        }

        val exportFile = File(exportDir, "aylink-mobile-diagnostics-${fileNameFormat.format(Date())}.zip")
        ZipOutputStream(exportFile.outputStream().buffered()).use { zip ->
            zip.putNextEntry(ZipEntry("diagnostic.json"))
            zip.write(logger.buildDiagnosticJson().toByteArray())
            zip.closeEntry()

            logger.logFiles().forEach { file ->
                zip.putNextEntry(ZipEntry("logs/${file.name}"))
                file.inputStream().buffered().use { input ->
                    input.copyTo(zip)
                }
                zip.closeEntry()
            }
        }
        return exportFile
    }
}
