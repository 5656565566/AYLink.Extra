package com.aylink.mobile.data.api

import com.aylink.mobile.data.model.ApiErrorResponse
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response

class ApiException(
    val statusCode: Int,
    override val message: String
) : IllegalStateException(message)

suspend fun <T> OkHttpClient.executeJson(
    request: Request,
    json: Json,
    serializer: DeserializationStrategy<T>
): T = withContext(Dispatchers.IO) {
    newCall(request).execute().use { response ->
        val body = response.body?.string().orEmpty()
        if (!response.isSuccessful) {
            val apiError = runCatching {
                json.decodeFromString(ApiErrorResponse.serializer(), body).error
            }.getOrNull()
            val message = apiError?.message?.takeIf { it.isNotBlank() }
                ?: apiError?.messageKey?.takeIf { it.isNotBlank() }
                ?: body.ifBlank { "HTTP ${response.code}" }
            throw ApiException(response.code, "HTTP ${response.code}: $message")
        }

        json.decodeFromString(serializer, body)
    }
}

suspend fun OkHttpClient.executeEmpty(
    request: Request,
    json: Json
): Unit = withContext(Dispatchers.IO) {
    newCall(request).execute().use { response ->
        if (!response.isSuccessful) {
            val body = response.body?.string().orEmpty()
            val apiError = runCatching {
                json.decodeFromString(ApiErrorResponse.serializer(), body).error
            }.getOrNull()
            val message = apiError?.message?.takeIf { it.isNotBlank() }
                ?: apiError?.messageKey?.takeIf { it.isNotBlank() }
                ?: body.ifBlank { "Unknown Error" }
            throw ApiException(response.code, "HTTP ${response.code}: $message")
        }
    }
}

suspend fun OkHttpClient.executeRaw(request: Request): Response = withContext(Dispatchers.IO) {
    newCall(request).execute()
}
