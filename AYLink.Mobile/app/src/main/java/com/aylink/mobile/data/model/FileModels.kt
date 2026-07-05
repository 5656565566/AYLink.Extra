package com.aylink.mobile.data.model

import androidx.compose.runtime.Immutable
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// ... existing models ...

@Serializable
@Immutable
data class FileEntry(
    @SerialName("Name")
    val name: String,
    @SerialName("IsDirectory")
    val isDirectory: Boolean,
    @SerialName("Size")
    val size: Long,
)

@Serializable
data class FileListRequest(
    val path: String,
)

@Serializable
data class FileListResponse(
    val path: String,
    val items: List<FileEntry>,
)

@Serializable
data class FilePathRequest(
    val path: String,
)

@Serializable
data class FileRenameRequest(
    val path: String,
    val newName: String,
)

@Serializable
data class AppActionRequest(
    val packageName: String,
)
