package com.aylink.mobile.data.repo

import com.aylink.mobile.data.api.AgentApi
import com.aylink.mobile.data.api.ApiException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

class AuthRepository(
    private val sessionStore: SessionStore,
    private val agentApi: AgentApi,
) {
    private val refreshMutex = Mutex()

    suspend fun login(
        baseUrl: String,
        username: String,
        password: String,
    ): Result<Unit> =
        runCatching {
            val response = agentApi.login(baseUrl, username, password)
            check(!response.accessToken.isNullOrBlank()) { "登录失败，请检查用户名或密码" }
            check(!response.refreshToken.isNullOrBlank()) { "登录失败，请重新登录" }

            sessionStore.updateBaseUrl(baseUrl)
            sessionStore.updateUsername(username)
            sessionStore.updateSession(response.accessToken, response.refreshToken)
        }

    suspend fun requireSession(): Pair<String, String> {
        val baseUrl = sessionStore.baseUrl.first()
        val token = sessionStore.token.first()
        check(!token.isNullOrBlank()) { "Not logged in" }
        return baseUrl to token
    }

    suspend fun <T> withAuthorizedRequest(block: suspend (baseUrl: String, token: String) -> T): T {
        val generation = sessionStore.transportGeneration.value
        val (baseUrl, token) = requireSession()
        if (generation != sessionStore.transportGeneration.value) throw CancellationException("Account session changed")
        return try {
            block(baseUrl, token)
        } catch (error: ApiException) {
            if (error.statusCode != 401) {
                throw error
            }

            if (generation != sessionStore.transportGeneration.value) throw CancellationException("Account session changed")

            val refreshedToken = refreshSession(generation) ?: throw IllegalStateException("登录已过期，请重新登录", error)
            if (generation != sessionStore.transportGeneration.value) throw CancellationException("Account session changed")
            block(baseUrl, refreshedToken)
        }
    }

    private suspend fun refreshSession(generation: Long): String? =
        refreshMutex.withLock {
            if (generation != sessionStore.transportGeneration.value) throw CancellationException("Account session changed")
            val baseUrl = sessionStore.baseUrl.first()
            val refreshToken = sessionStore.refreshToken.first()
            if (refreshToken.isNullOrBlank()) {
                sessionStore.clearSession()
                return null
            }

            return try {
                val response = agentApi.refresh(baseUrl, refreshToken)
                if (generation != sessionStore.transportGeneration.value) throw CancellationException("Account session changed")
                val nextAccessToken = response.accessToken?.takeIf { it.isNotBlank() }
                if (nextAccessToken.isNullOrBlank()) {
                    sessionStore.clearSession()
                    null
                } else {
                    sessionStore.updateSession(
                        accessToken = nextAccessToken,
                        refreshToken = response.refreshToken?.takeIf { it.isNotBlank() } ?: refreshToken,
                    )
                    nextAccessToken
                }
            } catch (error: ApiException) {
                if (generation != sessionStore.transportGeneration.value) throw CancellationException("Account session changed")
                if (error.statusCode == 401) {
                    sessionStore.clearSession()
                    null
                } else {
                    throw error
                }
            }
        }
}
