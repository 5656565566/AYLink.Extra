package com.aylink.mobile.ui.login

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.aylink.mobile.data.repo.AuthRepository
import com.aylink.mobile.data.repo.SessionStore
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class LoginUiState(
    val baseUrl: String = "",
    val username: String = "",
    val password: String = "",
    val loading: Boolean = false,
    val errorMessage: String? = null
)

sealed interface LoginIntent {
    data class UpdateBaseUrl(val url: String) : LoginIntent
    data class UpdateUsername(val username: String) : LoginIntent
    data class UpdatePassword(val password: String) : LoginIntent
    data object SaveBaseUrl : LoginIntent
    data object Login : LoginIntent
    data object DismissError : LoginIntent
}

sealed interface LoginEffect {
    data object NavigateToLogin : LoginEffect
    data object NavigateToDevices : LoginEffect
}

class LoginViewModel(
    private val authRepository: AuthRepository,
    private val sessionStore: SessionStore
) : ViewModel() {

    private val _uiState = MutableStateFlow(
        LoginUiState(
            baseUrl = sessionStore.baseUrl.value,
            username = sessionStore.username.value
        )
    )
    val uiState: StateFlow<LoginUiState> = _uiState.asStateFlow()

    private val _effect = MutableSharedFlow<LoginEffect>()
    val effect = _effect.asSharedFlow()

    fun handleIntent(intent: LoginIntent) {
        when (intent) {
            is LoginIntent.UpdateBaseUrl -> _uiState.update { it.copy(baseUrl = intent.url, errorMessage = null) }
            is LoginIntent.UpdateUsername -> _uiState.update { it.copy(username = intent.username, errorMessage = null) }
            is LoginIntent.UpdatePassword -> _uiState.update { it.copy(password = intent.password, errorMessage = null) }
            LoginIntent.SaveBaseUrl -> saveBaseUrl()
            LoginIntent.Login -> login()
            LoginIntent.DismissError -> _uiState.update { it.copy(errorMessage = null) }
        }
    }

    private fun saveBaseUrl() {
        val currentState = _uiState.value
        val normalized = currentState.baseUrl.trim().removeSuffix("/")
        if (normalized.isBlank()) {
            _uiState.update { it.copy(errorMessage = "请输入 Agent 地址") }
            return
        }

        _uiState.update { it.copy(baseUrl = normalized, errorMessage = null) }
        sessionStore.updateBaseUrl(normalized)
        viewModelScope.launch {
            _effect.emit(LoginEffect.NavigateToLogin)
        }
    }

    private fun login() {
        val currentState = _uiState.value
        val normalizedBaseUrl = currentState.baseUrl.trim().removeSuffix("/")
        val normalizedUsername = currentState.username.trim()

        if (normalizedBaseUrl.isBlank()) {
            _uiState.update { it.copy(errorMessage = "请先配置 Agent 地址") }
            return
        }
        if (normalizedUsername.isBlank() || currentState.password.isBlank()) {
            _uiState.update { it.copy(errorMessage = "请输入用户名和密码") }
            return
        }

        _uiState.update { it.copy(loading = true, errorMessage = null) }
        
        viewModelScope.launch {
            val result = authRepository.login(normalizedBaseUrl, normalizedUsername, currentState.password)
            
            result.onSuccess {
                _uiState.update { it.copy(loading = false, baseUrl = normalizedBaseUrl, username = normalizedUsername) }
                _effect.emit(LoginEffect.NavigateToDevices)
            }
            .onFailure { error ->
                _uiState.update { it.copy(loading = false, errorMessage = error.message ?: "登录失败") }
            }
        }
    }
}
