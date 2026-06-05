package com.aylink.mobile.data.repo

import android.content.Context
import com.aylink.mobile.data.api.AgentApi
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor

class AppContainer(context: Context) {
    private val logging = HttpLoggingInterceptor().apply {
        level = HttpLoggingInterceptor.Level.BASIC
    }

    val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    }

    val okHttpClient: OkHttpClient = OkHttpClient.Builder()
        .addInterceptor(logging)
        .build()

    val sessionStore = SessionStore(context)
    val localSettingsStore = LocalSettingsStore(context)
    val agentApi = AgentApi(okHttpClient, json)
    val authRepository = AuthRepository(sessionStore, agentApi)
    val deviceRepository = DeviceRepository(context.applicationContext, authRepository, agentApi)
}
