package com.aylink.mobile.data.api

import java.net.URLDecoder

internal fun downloadFilename(
    disposition: String?,
    fallback: String,
): String {
    if (disposition == null) return fallback
    val extended =
        Regex("""(?:^|;)\s*filename\*\s*=\s*([^;]+)""", RegexOption.IGNORE_CASE)
            .find(disposition)
            ?.groupValues
            ?.get(1)
            ?.trim()
            ?.split('\'', limit = 3)
    if (extended?.size == 3) {
        val decoded =
            runCatching {
                URLDecoder.decode(extended[2].replace("+", "%2B"), extended[0])
            }.getOrNull()
        if (!decoded.isNullOrBlank()) return decoded
    }
    val name =
        Regex("""(?:^|;)\s*filename\s*=\s*("(?:\\.|[^"\\])*"|[^;]*)""", RegexOption.IGNORE_CASE)
            .find(disposition)
            ?.groupValues
            ?.get(1)
            ?.trim()
    return name?.removeSurrounding("\"")?.replace(Regex("""\\(.)"""), "$1")?.takeIf { it.isNotBlank() } ?: fallback
}
