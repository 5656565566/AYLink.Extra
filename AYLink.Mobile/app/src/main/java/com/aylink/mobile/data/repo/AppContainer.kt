package com.aylink.mobile.data.repo

import android.content.Context
import com.aylink.mobile.data.api.AgentApi
import com.aylink.mobile.logging.AppLogger
import com.aylink.mobile.logging.DiagnosticHttpLoggingInterceptor
import com.aylink.mobile.logging.DiagnosticLogExporter
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient

class AppContainer(
    context: Context,
) {
    val appLogger = AppLogger(context)
    val diagnosticLogExporter = DiagnosticLogExporter(context, appLogger)

    val json =
        Json {
            ignoreUnknownKeys = true
            explicitNulls = false
        }

    val okHttpClient: OkHttpClient =
        OkHttpClient
            .Builder()
            .addInterceptor(DiagnosticHttpLoggingInterceptor(appLogger))
            .build()

    val sessionStore = SessionStore(context)
    val localSettingsStore = LocalSettingsStore(context)
    val agentApi = AgentApi(okHttpClient, json)
    val authRepository = AuthRepository(sessionStore, agentApi)
    val deviceRepository = DeviceRepository(context.applicationContext, authRepository, agentApi)
}
