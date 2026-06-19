package com.aylink.mobile.logging

import okhttp3.Interceptor
import okhttp3.Response

class DiagnosticHttpLoggingInterceptor(
    private val logger: AppLogger
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val startedAt = System.nanoTime()
        return try {
            val response = chain.proceed(request)
            val durationMs = (System.nanoTime() - startedAt) / 1_000_000
            logger.i(
                LOG_TAG,
                "HTTP ${request.method} ${request.url.encodedPath} -> ${response.code} in ${durationMs}ms"
            )
            response
        } catch (error: Exception) {
            val durationMs = (System.nanoTime() - startedAt) / 1_000_000
            logger.w(
                LOG_TAG,
                "HTTP ${request.method} ${request.url.encodedPath} failed in ${durationMs}ms: ${error.message}",
                error
            )
            throw error
        }
    }

    private companion object {
        private const val LOG_TAG = "AYLinkHttp"
    }
}
