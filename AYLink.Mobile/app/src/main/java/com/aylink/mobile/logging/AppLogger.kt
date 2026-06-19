package com.aylink.mobile.logging

import android.content.Context
import android.os.Build
import android.util.Log
import com.aylink.mobile.BuildConfig
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class AppLogger(context: Context) {
    private val appContext = context.applicationContext
    private val logDir = File(appContext.filesDir, "logs")
    private val logFile = File(logDir, "aylink-mobile.log")
    private val executor: ExecutorService = Executors.newSingleThreadExecutor()
    private val dateFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }

    fun d(tag: String, message: String, throwable: Throwable? = null) {
        Log.d(tag, message, throwable)
        write("DEBUG", tag, message, throwable)
    }

    fun i(tag: String, message: String, throwable: Throwable? = null) {
        Log.i(tag, message, throwable)
        write("INFO", tag, message, throwable)
    }

    fun w(tag: String, message: String, throwable: Throwable? = null) {
        Log.w(tag, message, throwable)
        write("WARN", tag, message, throwable)
    }

    fun e(tag: String, message: String, throwable: Throwable? = null) {
        Log.e(tag, message, throwable)
        write("ERROR", tag, message, throwable)
    }

    fun logFiles(): List<File> {
        return buildList {
            for (index in MAX_HISTORY_FILES downTo 1) {
                val file = File(logDir, "aylink-mobile.$index.log")
                if (file.exists() && file.length() > 0) {
                    add(file)
                }
            }
            if (logFile.exists() && logFile.length() > 0) {
                add(logFile)
            }
        }
    }

    fun clear() {
        executor.execute {
            logDir.listFiles()?.forEach { file ->
                if (file.name.startsWith("aylink-mobile") && file.extension == "log") {
                    file.delete()
                }
            }
        }
    }

    fun buildDiagnosticJson(): String {
        return """
            {
              "generatedAt": "${escapeJson(dateFormat.format(Date()))}",
              "app": {
                "versionName": "${escapeJson(BuildConfig.VERSION_NAME)}",
                "versionCode": ${BuildConfig.VERSION_CODE},
                "debug": ${BuildConfig.DEBUG}
              },
              "device": {
                "manufacturer": "${escapeJson(Build.MANUFACTURER)}",
                "model": "${escapeJson(Build.MODEL)}",
                "androidRelease": "${escapeJson(Build.VERSION.RELEASE)}",
                "sdkInt": ${Build.VERSION.SDK_INT}
              }
            }
        """.trimIndent()
    }

    private fun write(level: String, tag: String, message: String, throwable: Throwable?) {
        val sanitizedMessage = sanitize(message)
        val throwableText = throwable?.let { "\n${Log.getStackTraceString(it)}" }.orEmpty()
        val line = "${dateFormat.format(Date())} $level/$tag $sanitizedMessage$throwableText\n"
        executor.execute {
            runCatching {
                logDir.mkdirs()
                rotateIfNeeded(line.length)
                logFile.appendText(line)
            }
        }
    }

    private fun rotateIfNeeded(incomingLength: Int) {
        if (!logFile.exists() || logFile.length() + incomingLength <= MAX_LOG_FILE_BYTES) {
            return
        }

        File(logDir, "aylink-mobile.$MAX_HISTORY_FILES.log").delete()
        for (index in MAX_HISTORY_FILES - 1 downTo 1) {
            val source = File(logDir, "aylink-mobile.$index.log")
            if (source.exists()) {
                source.renameTo(File(logDir, "aylink-mobile.${index + 1}.log"))
            }
        }
        logFile.renameTo(File(logDir, "aylink-mobile.1.log"))
    }

    private fun sanitize(value: String): String {
        var result = value
        SENSITIVE_PATTERNS.forEach { pattern ->
            result = pattern.replace(result) { match ->
                val separator = match.groups[1]?.value.orEmpty()
                "${match.value.substringBefore(separator)}$separator***"
            }
        }
        return result
    }

    private fun escapeJson(value: String): String {
        return buildString {
            value.forEach { char ->
                when (char) {
                    '\\' -> append("\\\\")
                    '"' -> append("\\\"")
                    '\n' -> append("\\n")
                    '\r' -> append("\\r")
                    '\t' -> append("\\t")
                    else -> append(char)
                }
            }
        }
    }

    private companion object {
        private const val MAX_LOG_FILE_BYTES = 1024 * 1024
        private const val MAX_HISTORY_FILES = 4
        private val SENSITIVE_PATTERNS = listOf(
            Regex("(?i)(authorization\\s*[:=]\\s*)\\S+"),
            Regex("(?i)(cookie\\s*[:=]\\s*)\\S+"),
            Regex("(?i)(token\\s*[:=]\\s*)\\S+"),
            Regex("(?i)(ticket\\s*[:=]\\s*)\\S+")
        )
    }
}
