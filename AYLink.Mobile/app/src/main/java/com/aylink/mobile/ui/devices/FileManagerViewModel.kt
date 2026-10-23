package com.aylink.mobile.ui.devices

import android.annotation.SuppressLint
import android.net.Uri
import androidx.compose.runtime.Immutable
import androidx.core.net.toUri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.aylink.mobile.data.model.FileEntry
import com.aylink.mobile.data.model.LocalFileHandle
import com.aylink.mobile.data.repo.DeviceRepository
import com.aylink.mobile.data.repo.FileTransferProgress
import com.aylink.mobile.data.repo.LocalSettingsStore
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.ensureActive
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
    val pendingPath: String? = null,
    val failedPath: String? = null,
    val hasLoaded: Boolean = false,
    val sortOrder: FileSortOrder = FileSortOrder.NAME_ASC,
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
    val isDeleteDialogOpen: Boolean = false,
    val transferTitle: String? = null,
    val isPathEditorOpen: Boolean = false,
)

@Immutable
data class FileManagerListUiState(
    val currentPath: String = DEFAULT_REMOTE_STORAGE_PATH,
    val files: List<FileEntry> = emptyList(),
    val loading: Boolean = false,
    val errorMessage: String? = null,
    val pendingPath: String? = null,
    val failedPath: String? = null,
    val hasLoaded: Boolean = false,
    val sortOrder: FileSortOrder = FileSortOrder.NAME_ASC,
    val isPathEditorOpen: Boolean = false,
) {
    val showEmpty: Boolean
        get() = hasLoaded && !loading && errorMessage == null && files.isEmpty()
}

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
    val isDeleteDialogOpen: Boolean = false,
    val transferTitle: String? = null,
) {
    val busy: Boolean
        get() = actionLoading || uploadLoading || downloadMessage != null
}

sealed interface FileManagerIntent {
    data object Refresh : FileManagerIntent

    data object Retry : FileManagerIntent

    data object ShowPathEditor : FileManagerIntent

    data object HidePathEditor : FileManagerIntent

    data class OpenPath(
        val path: String,
    ) : FileManagerIntent

    data class SetSortOrder(
        val order: FileSortOrder,
    ) : FileManagerIntent

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
        val targetPath: String,
    ) : FileManagerIntent

    data class UploadFolder(
        val uri: Uri,
        val targetPath: String,
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

    data object ShowDeleteDialog : FileManagerIntent

    data object HideDeleteDialog : FileManagerIntent

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
            .map {
                FileManagerListUiState(
                    currentPath = it.currentPath,
                    files = it.files,
                    loading = it.loading,
                    errorMessage = it.errorMessage,
                    pendingPath = it.pendingPath,
                    failedPath = it.failedPath,
                    hasLoaded = it.hasLoaded,
                    sortOrder = it.sortOrder,
                    isPathEditorOpen = it.isPathEditorOpen,
                )
            }.distinctUntilChanged()
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
                    isDeleteDialogOpen = it.isDeleteDialogOpen,
                    transferTitle = it.transferTitle,
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
    private var loadJob: Job? = null

    private val operationBusy: Boolean
        get() = _uiState.value.let { it.actionLoading || it.uploadLoading || it.downloadMessage != null }

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
            FileManagerIntent.Retry -> loadFiles(_uiState.value.failedPath ?: _uiState.value.currentPath)
            FileManagerIntent.ShowPathEditor -> _uiState.update { it.copy(isPathEditorOpen = true) }
            FileManagerIntent.HidePathEditor -> _uiState.update { it.copy(isPathEditorOpen = false) }
            is FileManagerIntent.OpenPath -> {
                if (intent.path.startsWith('/') && '\u0000' !in intent.path) {
                    loadFiles(normalizeFilePath(intent.path))
                }
            }
            is FileManagerIntent.SetSortOrder -> _uiState.update { it.copy(sortOrder = intent.order) }
            is FileManagerIntent.OpenDirectory -> {
                val newPath = normalizeFilePath(_uiState.value.currentPath + intent.directoryName)
                loadFiles(newPath)
            }
            FileManagerIntent.GoUp -> {
                val parentPath = parentFilePath(_uiState.value.currentPath)
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
            is FileManagerIntent.UploadFiles -> uploadFiles(intent.uris, intent.targetPath)
            is FileManagerIntent.UploadFolder -> uploadFolder(intent.uri, intent.targetPath)
            FileManagerIntent.CancelUpload -> cancelUpload()
            is FileManagerIntent.DownloadFile -> downloadFile(intent.path)
            is FileManagerIntent.OpenFile -> downloadFile(intent.path, DownloadAction.OPEN)
            is FileManagerIntent.ShareFile -> downloadFile(intent.path, DownloadAction.SHARE)
            is FileManagerIntent.CopyPath -> copyPath(intent.path)
            is FileManagerIntent.DeleteFile -> deleteFile(intent.path)
            FileManagerIntent.ShowDeleteDialog -> {
                if (!operationBusy) _uiState.update { it.copy(isActionMenuOpen = false, isDeleteDialogOpen = true) }
            }
            FileManagerIntent.HideDeleteDialog -> {
                if (!operationBusy) _uiState.update { it.copy(isDeleteDialogOpen = false) }
            }
            is FileManagerIntent.ShowRenameDialog -> {
                if (operationBusy) return
                _uiState.update {
                    it.copy(
                        isRenameDialogOpen = true,
                        renameTargetName = intent.currentName,
                        isActionMenuOpen = false,
                    )
                }
            }
            FileManagerIntent.HideRenameDialog -> {
                if (!operationBusy) _uiState.update { it.copy(isRenameDialogOpen = false) }
            }
            is FileManagerIntent.UpdateRenameTargetName -> _uiState.update { it.copy(renameTargetName = intent.newName) }
            is FileManagerIntent.RenameFile -> renameFile(intent.oldPath, intent.newName)
            FileManagerIntent.DismissError -> _uiState.update { it.copy(errorMessage = null) }
        }
    }

    private fun loadFiles(path: String) {
        loadJob?.cancel()
        _uiState.update {
            it.copy(
                loading = true,
                errorMessage = null,
                pendingPath = path,
                failedPath = null,
                isPathEditorOpen = false,
                isActionMenuOpen = false,
                isRenameDialogOpen = false,
                isDeleteDialogOpen = false,
                selectedFile = null,
            )
        }
        loadJob =
            viewModelScope.launch {
                try {
                    val response = deviceRepository.listFiles(deviceId, path)
                    ensureActive()
                    _uiState.update {
                        it.copy(
                            loading = false,
                            files = response.items.filter { file -> file.name != "." && file.name != ".." },
                            currentPath = normalizeFilePath(response.path),
                            pendingPath = null,
                            hasLoaded = true,
                        )
                    }
                } catch (error: CancellationException) {
                    throw error
                } catch (error: Exception) {
                    ensureActive()
                    _uiState.update {
                        it.copy(
                            loading = false,
                            pendingPath = null,
                            failedPath = path,
                            errorMessage = "无法读取 $path：${error.message ?: "加载文件列表失败"}",
                        )
                    }
                }
            }
    }

    private fun refreshChangedDirectory(path: String) {
        val state = _uiState.value
        // 传输完成不能覆盖用户刚发起的目录跳转。
        if (state.pendingPath == path || (state.pendingPath == null && state.currentPath == path)) {
            loadFiles(path)
        }
    }

    private fun deleteFile(path: String) {
        if (operationBusy || !_uiState.value.isDeleteDialogOpen) return
        _uiState.update { it.copy(actionLoading = true, errorMessage = null, failedPath = null) }
        viewModelScope.launch {
            val result = runCatching { deviceRepository.deleteFile(deviceId, path) }
            result.onSuccess {
                _uiState.update { it.copy(actionLoading = false, isDeleteDialogOpen = false) }
                _effect.emit(FileManagerEffect.ShowToast("删除成功"))
                refreshChangedDirectory(parentFilePath(path))
            }
            result.onFailure { error ->
                _uiState.update {
                    it.copy(actionLoading = false, isDeleteDialogOpen = false, errorMessage = error.message ?: "删除失败")
                }
            }
        }
    }

    private fun uploadFiles(
        uris: List<Uri>,
        targetPath: String,
    ) {
        if (uris.isEmpty() || operationBusy || uploadJob?.isActive == true) {
            return
        }
        _uiState.update {
            it.copy(
                uploadLoading = true,
                uploadMessage = "准备上传",
                uploadProgress = null,
                errorMessage = null,
                failedPath = null,
                transferTitle = "正在上传 ${uris.size} 个文件",
            )
        }
        uploadJob =
            viewModelScope.launch {
                try {
                    deviceRepository.uploadFiles(deviceId, targetPath, uris) { progress ->
                        updateUploadProgress(progress)
                    }
                    _uiState.update {
                        it.copy(
                            uploadLoading = false,
                            uploadMessage = null,
                            uploadProgress = null,
                            transferTitle = null,
                        )
                    }
                    _effect.emit(FileManagerEffect.ShowToast("上传成功"))
                    refreshChangedDirectory(targetPath)
                } catch (_: CancellationException) {
                    clearUploadState()
                    _effect.tryEmit(FileManagerEffect.ShowToast("上传已取消"))
                } catch (error: Throwable) {
                    _uiState.update {
                        it.copy(
                            uploadLoading = false,
                            uploadMessage = null,
                            uploadProgress = null,
                            transferTitle = null,
                            errorMessage = error.toTransferMessage("上传失败"),
                        )
                    }
                } finally {
                    uploadJob = null
                }
            }
    }

    private fun uploadFolder(
        uri: Uri,
        targetPath: String,
    ) {
        if (operationBusy || uploadJob?.isActive == true) {
            return
        }
        _uiState.update {
            it.copy(
                uploadLoading = true,
                uploadMessage = "准备上传",
                uploadProgress = null,
                errorMessage = null,
                failedPath = null,
                transferTitle = "正在上传文件夹",
            )
        }
        uploadJob =
            viewModelScope.launch {
                try {
                    deviceRepository.uploadFolder(deviceId, targetPath, uri) { progress ->
                        updateUploadProgress(progress)
                    }
                    _uiState.update {
                        it.copy(
                            uploadLoading = false,
                            uploadMessage = null,
                            uploadProgress = null,
                            transferTitle = null,
                        )
                    }
                    _effect.emit(FileManagerEffect.ShowToast("上传成功"))
                    refreshChangedDirectory(targetPath)
                } catch (_: CancellationException) {
                    clearUploadState()
                    _effect.tryEmit(FileManagerEffect.ShowToast("上传已取消"))
                } catch (error: Throwable) {
                    _uiState.update {
                        it.copy(
                            uploadLoading = false,
                            uploadMessage = null,
                            uploadProgress = null,
                            transferTitle = null,
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

    private enum class DownloadAction { SAVE, OPEN, SHARE }

    private fun downloadFile(
        path: String,
        action: DownloadAction = DownloadAction.SAVE,
    ) {
        if (operationBusy) return
        _uiState.update {
            it.copy(
                isActionMenuOpen = false,
                downloadMessage = "准备下载",
                downloadProgress = null,
                errorMessage = null,
                failedPath = null,
                transferTitle = "正在下载 ${path.substringAfterLast('/')}",
            )
        }
        viewModelScope.launch {
            try {
                val file =
                    if (action == DownloadAction.SAVE) {
                        deviceRepository.downloadFileToDownloads(
                            deviceId = deviceId,
                            path = path,
                            downloadDirectoryUri = currentDownloadDirectoryUri(),
                            onProgress = ::updateDownloadProgress,
                        )
                    } else {
                        deviceRepository.downloadFileToCache(deviceId, path, ::updateDownloadProgress)
                    }
                _uiState.update {
                    it.copy(
                        downloadMessage = null,
                        downloadProgress = null,
                        transferTitle = null,
                    )
                }
                _effect.emit(
                    when (action) {
                        DownloadAction.SAVE -> FileManagerEffect.ShowToast("已保存到 ${file.localPath}")
                        DownloadAction.OPEN -> FileManagerEffect.OpenLocalFile(file)
                        DownloadAction.SHARE -> FileManagerEffect.ShareLocalFile(file)
                    },
                )
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                _uiState.update {
                    it.copy(
                        downloadMessage = null,
                        downloadProgress = null,
                        transferTitle = null,
                        errorMessage =
                            error.toTransferMessage(
                                when (action) {
                                    DownloadAction.SAVE -> "下载失败"
                                    DownloadAction.OPEN -> "打开失败"
                                    DownloadAction.SHARE -> "分享失败"
                                },
                            ),
                    )
                }
            }
        }
    }

    private fun currentDownloadDirectoryUri(): Uri? =
        localSettingsStore.settings.value.downloadDirectoryUri
            ?.let { uriText -> runCatching { uriText.toUri() }.getOrNull() }

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
        if (operationBusy || !_uiState.value.isRenameDialogOpen) return
        val error = fileNameError(newName)
        if (error != null) {
            _uiState.update { it.copy(errorMessage = error) }
            return
        }
        _uiState.update { it.copy(actionLoading = true, errorMessage = null, failedPath = null) }
        viewModelScope.launch {
            val result = runCatching { deviceRepository.renameFile(deviceId, oldPath, newName) }
            result.onSuccess {
                _uiState.update { it.copy(actionLoading = false, isRenameDialogOpen = false) }
                _effect.emit(FileManagerEffect.ShowToast("重命名成功"))
                refreshChangedDirectory(parentFilePath(oldPath))
            }
            result.onFailure { error ->
                _uiState.update {
                    it.copy(actionLoading = false, isRenameDialogOpen = false, errorMessage = error.message ?: "重命名失败")
                }
            }
        }
    }

    private fun updateUploadProgress(progress: FileTransferProgress) {
        val message =
            progress.total?.let {
                "${formatBytes(progress.loaded)} / ${formatBytes(it)}"
            } ?: formatBytes(progress.loaded)
        _uiState.update {
            if (!it.uploadLoading) {
                it
            } else {
                it.copy(
                    uploadMessage = message,
                    uploadProgress = progress.fraction,
                )
            }
        }
    }

    private fun clearUploadState() {
        _uiState.update {
            it.copy(
                uploadLoading = false,
                uploadMessage = null,
                uploadProgress = null,
                transferTitle = null,
            )
        }
    }

    private fun updateDownloadProgress(progress: FileTransferProgress) {
        val message =
            progress.total?.let {
                "${formatBytes(progress.loaded)} / ${formatBytes(it)}"
            } ?: formatBytes(progress.loaded)
        _uiState.update {
            if (it.downloadMessage == null) {
                it
            } else {
                it.copy(
                    downloadMessage = message,
                    downloadProgress = progress.fraction,
                )
            }
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
