package com.aylink.mobile.ui.devices

import android.annotation.SuppressLint
import android.net.Uri
import androidx.core.net.toUri
import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.aylink.mobile.data.model.FileEntry
import com.aylink.mobile.data.model.LocalFileHandle
import com.aylink.mobile.data.repo.DeviceRepository
import com.aylink.mobile.data.repo.FileTransferProgress
import com.aylink.mobile.data.repo.LocalSettingsStore
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.net.SocketTimeoutException
import java.util.Locale

// 这是远端 Android 设备的默认共享存储目录 不是当前手机客户端本地路径
@SuppressLint("SdCardPath")
private const val DEFAULT_REMOTE_STORAGE_PATH = "/sdcard/"

@Immutable
data class FileManagerUiState(
    val currentPath: String = DEFAULT_REMOTE_STORAGE_PATH,
    val files: List<FileEntry> = emptyList(),
    val loading: Boolean = false,
    val errorMessage: String? = null,
    val selectedFile: FileEntry? = null,
    val isActionMenuOpen: Boolean = false,
    val actionLoading: Boolean = false,
    val uploadLoading: Boolean = false,
    val uploadMessage: String? = null,
    val uploadProgress: Float? = null,
    val downloadMessage: String? = null,
    val downloadProgress: Float? = null,
    val isRenameDialogOpen: Boolean = false,
    val renameTargetName: String = "",
)

@Immutable
data class FileManagerListUiState(
    val currentPath: String = DEFAULT_REMOTE_STORAGE_PATH,
    val files: List<FileEntry> = emptyList(),
    val loading: Boolean = false,
    val errorMessage: String? = null,
)

@Immutable
data class FileManagerDialogUiState(
    val selectedFile: FileEntry? = null,
    val isActionMenuOpen: Boolean = false,
    val actionLoading: Boolean = false,
    val uploadLoading: Boolean = false,
    val uploadMessage: String? = null,
    val uploadProgress: Float? = null,
    val downloadMessage: String? = null,
    val downloadProgress: Float? = null,
    val isRenameDialogOpen: Boolean = false,
    val renameTargetName: String = "",
)

sealed interface FileManagerIntent {
    data object Refresh : FileManagerIntent

    data class OpenDirectory(
        val directoryName: String,
    ) : FileManagerIntent

    data object GoUp : FileManagerIntent

    data class ShowActionMenu(
        val file: FileEntry,
    ) : FileManagerIntent

    data object HideActionMenu : FileManagerIntent

    data class UploadFiles(
        val uris: List<Uri>,
    ) : FileManagerIntent

    data class UploadFolder(
        val uri: Uri,
    ) : FileManagerIntent

    data object CancelUpload : FileManagerIntent

    data class DownloadFile(
        val path: String,
    ) : FileManagerIntent

    data class OpenFile(
        val path: String,
    ) : FileManagerIntent

    data class ShareFile(
        val path: String,
    ) : FileManagerIntent

    data class CopyPath(
        val path: String,
    ) : FileManagerIntent

    data class DeleteFile(
        val path: String,
    ) : FileManagerIntent

    data class ShowRenameDialog(
        val currentName: String,
    ) : FileManagerIntent

    data object HideRenameDialog : FileManagerIntent

    data class UpdateRenameTargetName(
        val newName: String,
    ) : FileManagerIntent

    data class RenameFile(
        val oldPath: String,
        val newName: String,
    ) : FileManagerIntent

    data object DismissError : FileManagerIntent
}

sealed interface FileManagerEffect {
    data class ShowToast(
        val message: String,
    ) : FileManagerEffect

    data class CopyText(
        val text: String,
        val successMessage: String,
    ) : FileManagerEffect

    data class OpenLocalFile(
        val file: LocalFileHandle,
    ) : FileManagerEffect

    data class ShareLocalFile(
        val file: LocalFileHandle,
    ) : FileManagerEffect
}

class FileManagerViewModel(
    private val deviceId: Int,
    private val deviceRepository: DeviceRepository,
    private val localSettingsStore: LocalSettingsStore,
) : ViewModel() {
    private val _uiState = MutableStateFlow(FileManagerUiState())
    val uiState: StateFlow<FileManagerUiState> = _uiState.asStateFlow()
    val listUiState: StateFlow<FileManagerListUiState> =
        _uiState
            .map { FileManagerListUiState(it.currentPath, it.files, it.loading, it.errorMessage) }
            .distinctUntilChanged()
            .stateIn(
                viewModelScope,
                SharingStarted.WhileSubscribed(5_000),
                FileManagerListUiState(),
            )
    val dialogUiState: StateFlow<FileManagerDialogUiState> =
        _uiState
            .map {
                FileManagerDialogUiState(
                    selectedFile = it.selectedFile,
                    isActionMenuOpen = it.isActionMenuOpen,
                    actionLoading = it.actionLoading,
                    uploadLoading = it.uploadLoading,
                    uploadMessage = it.uploadMessage,
                    uploadProgress = it.uploadProgress,
                    downloadMessage = it.downloadMessage,
                    downloadProgress = it.downloadProgress,
                    isRenameDialogOpen = it.isRenameDialogOpen,
                    renameTargetName = it.renameTargetName,
                )
            }.distinctUntilChanged()
            .stateIn(
                viewModelScope,
                SharingStarted.WhileSubscribed(5_000),
                FileManagerDialogUiState(),
            )

    private val _effect = MutableSharedFlow<FileManagerEffect>()
    val effect = _effect.asSharedFlow()
    private var uploadJob: Job? = null

    init {
        handleIntent(FileManagerIntent.Refresh)
    }

    override fun onCleared() {
        uploadJob?.cancel()
        super.onCleared()
    }

    fun handleIntent(intent: FileManagerIntent) {
        when (intent) {
            FileManagerIntent.Refresh -> loadFiles(_uiState.value.currentPath)
            is FileManagerIntent.OpenDirectory -> {
                val newPath = normalizePath(_uiState.value.currentPath + intent.directoryName)
                loadFiles(newPath)
            }
            FileManagerIntent.GoUp -> {
                val parentPath = getParentPath(_uiState.value.currentPath)
                if (parentPath != _uiState.value.currentPath) {
                    loadFiles(parentPath)
                }
            }
            is FileManagerIntent.ShowActionMenu -> {
                _uiState.update {
                    it.copy(selectedFile = intent.file, isActionMenuOpen = true)
                }
            }
            FileManagerIntent.HideActionMenu -> _uiState.update { it.copy(isActionMenuOpen = false) }
            is FileManagerIntent.UploadFiles -> uploadFiles(intent.uris)
            is FileManagerIntent.UploadFolder -> uploadFolder(intent.uri)
            FileManagerIntent.CancelUpload -> cancelUpload()
            is FileManagerIntent.DownloadFile -> downloadFile(intent.path)
            is FileManagerIntent.OpenFile -> openFile(intent.path)
            is FileManagerIntent.ShareFile -> shareFile(intent.path)
            is FileManagerIntent.CopyPath -> copyPath(intent.path)
            is FileManagerIntent.DeleteFile -> deleteFile(intent.path)
            is FileManagerIntent.ShowRenameDialog -> {
                _uiState.update {
                    it.copy(
                        isRenameDialogOpen = true,
                        renameTargetName = intent.currentName,
                        isActionMenuOpen = false,
                    )
                }
            }
            FileManagerIntent.HideRenameDialog -> _uiState.update { it.copy(isRenameDialogOpen = false) }
            is FileManagerIntent.UpdateRenameTargetName -> _uiState.update { it.copy(renameTargetName = intent.newName) }
            is FileManagerIntent.RenameFile -> renameFile(intent.oldPath, intent.newName)
            FileManagerIntent.DismissError -> _uiState.update { it.copy(errorMessage = null) }
        }
    }

    private fun normalizePath(path: String): String {
        var normalized = path.replace("\\", "/").trim()
        if (!normalized.startsWith("/")) {
            normalized = "/$normalized"
        }
        if (!normalized.endsWith("/")) {
            normalized = "$normalized/"
        }
        return normalized.replace(Regex("/+"), "/")
    }

    private fun getParentPath(path: String): String {
        val normalized = normalizePath(path)
        if (normalized == "/") {
            return "/"
        }
        val parts = normalized.split("/").filter { it.isNotEmpty() }
        val newParts = parts.dropLast(1)
        return if (newParts.isEmpty()) "/" else "/${newParts.joinToString("/")}/"
    }

    private fun getEntryPath(
        basePath: String,
        entryName: String,
    ): String {
        val path = "${normalizePath(basePath)}$entryName"
        return path.replace(Regex("/+"), "/")
    }

    private fun loadFiles(path: String) {
        _uiState.update {
            it.copy(
                loading = true,
                errorMessage = null,
                currentPath = path,
                isActionMenuOpen = false,
                selectedFile = null,
            )
        }
        viewModelScope.launch {
            val result = runCatching { deviceRepository.listFiles(deviceId, path) }
            result.onSuccess { response ->
                val filteredItems = response.items.filter { it.name != "." && it.name != ".." }
                _uiState.update {
                    it.copy(loading = false, files = filteredItems, currentPath = response.path)
                }
            }
            result.onFailure { error ->
                _uiState.update {
                    it.copy(loading = false, errorMessage = error.message ?: "加载文件列表失败")
                }
            }
        }
    }

    private fun deleteFile(path: String) {
        _uiState.update { it.copy(actionLoading = true) }
        viewModelScope.launch {
            val result = runCatching { deviceRepository.deleteFile(deviceId, path) }
            result.onSuccess {
                _uiState.update { it.copy(actionLoading = false, isActionMenuOpen = false) }
                _effect.emit(FileManagerEffect.ShowToast("删除成功"))
                loadFiles(_uiState.value.currentPath)
            }
            result.onFailure { error ->
                _uiState.update {
                    it.copy(actionLoading = false, errorMessage = error.message ?: "删除失败")
                }
            }
        }
    }

    private fun uploadFiles(uris: List<Uri>) {
        if (uris.isEmpty() || uploadJob?.isActive == true) {
            return
        }
        _uiState.update {
            it.copy(
                uploadLoading = true,
                uploadMessage = "准备上传",
                uploadProgress = null,
                errorMessage = null,
            )
        }
        uploadJob =
            viewModelScope.launch {
                val targetPath = _uiState.value.currentPath
                try {
                    deviceRepository.uploadFiles(deviceId, targetPath, uris) { progress ->
                        updateUploadProgress(progress)
                    }
                    _uiState.update {
                        it.copy(
                            uploadLoading = false,
                            uploadMessage = null,
                            uploadProgress = null,
                        )
                    }
                    _effect.emit(FileManagerEffect.ShowToast("上传成功"))
                    loadFiles(targetPath)
                } catch (_: CancellationException) {
                    clearUploadState()
                    _effect.tryEmit(FileManagerEffect.ShowToast("上传已取消"))
                } catch (error: Throwable) {
                    _uiState.update {
                        it.copy(
                            uploadLoading = false,
                            uploadMessage = null,
                            uploadProgress = null,
                            errorMessage = error.toTransferMessage("上传失败"),
                        )
                    }
                } finally {
                    uploadJob = null
                }
            }
    }

    private fun uploadFolder(uri: Uri) {
        if (uploadJob?.isActive == true) {
            return
        }
        _uiState.update {
            it.copy(
                uploadLoading = true,
                uploadMessage = "准备上传",
                uploadProgress = null,
                errorMessage = null,
            )
        }
        uploadJob =
            viewModelScope.launch {
                val targetPath = _uiState.value.currentPath
                try {
                    deviceRepository.uploadFolder(deviceId, targetPath, uri) { progress ->
                        updateUploadProgress(progress)
                    }
                    _uiState.update {
                        it.copy(
                            uploadLoading = false,
                            uploadMessage = null,
                            uploadProgress = null,
                        )
                    }
                    _effect.emit(FileManagerEffect.ShowToast("上传成功"))
                    loadFiles(targetPath)
                } catch (_: CancellationException) {
                    clearUploadState()
                    _effect.tryEmit(FileManagerEffect.ShowToast("上传已取消"))
                } catch (error: Throwable) {
                    _uiState.update {
                        it.copy(
                            uploadLoading = false,
                            uploadMessage = null,
                            uploadProgress = null,
                            errorMessage = error.toTransferMessage("上传失败"),
                        )
                    }
                } finally {
                    uploadJob = null
                }
            }
    }

    private fun cancelUpload() {
        uploadJob?.cancel()
    }

    private fun downloadFile(path: String) {
        _uiState.update {
            it.copy(
                actionLoading = true,
                downloadMessage = "准备下载",
                downloadProgress = null,
            )
        }
        viewModelScope.launch {
            val result =
                runCatching {
                    deviceRepository.downloadFileToDownloads(
                        deviceId = deviceId,
                        path = path,
                        downloadDirectoryUri = currentDownloadDirectoryUri(),
                    ) { progress ->
                        updateDownloadProgress(progress)
                    }
                }
            result.onSuccess { file ->
                _uiState.update {
                    it.copy(
                        actionLoading = false,
                        isActionMenuOpen = false,
                        downloadMessage = null,
                        downloadProgress = null,
                    )
                }
                _effect.emit(FileManagerEffect.ShowToast("已保存到 ${file.localPath}"))
            }
            result.onFailure { error ->
                _uiState.update {
                    it.copy(
                        actionLoading = false,
                        downloadMessage = null,
                        downloadProgress = null,
                        errorMessage = error.toTransferMessage("下载失败"),
                    )
                }
            }
        }
    }

    private fun currentDownloadDirectoryUri(): Uri? =
        localSettingsStore.settings.value.downloadDirectoryUri
            ?.let { uriText -> runCatching { uriText.toUri() }.getOrNull() }

    private fun openFile(path: String) {
        _uiState.update { it.copy(actionLoading = true) }
        viewModelScope.launch {
            val result = runCatching { deviceRepository.downloadFileToCache(deviceId, path) }
            result.onSuccess { file ->
                _uiState.update { it.copy(actionLoading = false, isActionMenuOpen = false) }
                _effect.emit(FileManagerEffect.OpenLocalFile(file))
            }
            result.onFailure { error ->
                _uiState.update {
                    it.copy(actionLoading = false, errorMessage = error.message ?: "打开失败")
                }
            }
        }
    }

    private fun shareFile(path: String) {
        _uiState.update { it.copy(actionLoading = true) }
        viewModelScope.launch {
            val result = runCatching { deviceRepository.downloadFileToCache(deviceId, path) }
            result.onSuccess { file ->
                _uiState.update { it.copy(actionLoading = false, isActionMenuOpen = false) }
                _effect.emit(FileManagerEffect.ShareLocalFile(file))
            }
            result.onFailure { error ->
                _uiState.update {
                    it.copy(actionLoading = false, errorMessage = error.message ?: "分享失败")
                }
            }
        }
    }

    private fun copyPath(path: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isActionMenuOpen = false) }
            _effect.emit(FileManagerEffect.CopyText(path, "路径已复制"))
        }
    }

    private fun renameFile(
        oldPath: String,
        newName: String,
    ) {
        if (newName.isBlank()) {
            _uiState.update { it.copy(errorMessage = "名称不能为空") }
            return
        }
        _uiState.update { it.copy(actionLoading = true) }
        viewModelScope.launch {
            val result = runCatching { deviceRepository.renameFile(deviceId, oldPath, newName) }
            result.onSuccess {
                _uiState.update { it.copy(actionLoading = false, isRenameDialogOpen = false) }
                _effect.emit(FileManagerEffect.ShowToast("重命名成功"))
                loadFiles(_uiState.value.currentPath)
            }
            result.onFailure { error ->
                _uiState.update {
                    it.copy(actionLoading = false, errorMessage = error.message ?: "重命名失败")
                }
            }
        }
    }

    private fun updateUploadProgress(progress: FileTransferProgress) {
        val message =
            progress.total?.let {
                "正在上传 ${formatBytes(progress.loaded)} / ${formatBytes(it)}"
            } ?: "正在上传 ${formatBytes(progress.loaded)}"
        _uiState.update {
            it.copy(
                uploadMessage = message,
                uploadProgress = progress.fraction,
            )
        }
    }

    private fun clearUploadState() {
        _uiState.update {
            it.copy(
                uploadLoading = false,
                uploadMessage = null,
                uploadProgress = null,
            )
        }
    }

    private fun updateDownloadProgress(progress: FileTransferProgress) {
        val message =
            progress.total?.let {
                "正在下载 ${formatBytes(progress.loaded)} / ${formatBytes(it)}"
            } ?: "正在下载 ${formatBytes(progress.loaded)}"
        _uiState.update {
            it.copy(
                downloadMessage = message,
                downloadProgress = progress.fraction,
            )
        }
    }

    private fun formatBytes(value: Long): String =
        when {
            value < 1024 -> "$value B"
            value < 1024 * 1024 -> "${(value / 1024.0).formatOneDecimal()} KB"
            value < 1024 * 1024 * 1024 -> "${(value / 1024.0 / 1024.0).formatOneDecimal()} MB"
            else -> "${(value / 1024.0 / 1024.0 / 1024.0).formatOneDecimal()} GB"
        }

    private fun Double.formatOneDecimal(): String = String.format(Locale.ROOT, "%.1f", this)

    private fun Throwable.toTransferMessage(fallback: String): String =
        if (this is SocketTimeoutException) {
            "$fallback：传输超时，请检查网络或代理/CDN 超时设置"
        } else {
            message ?: fallback
        }
}
