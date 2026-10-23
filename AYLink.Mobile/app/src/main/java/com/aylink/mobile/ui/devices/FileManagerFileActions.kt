package com.aylink.mobile.ui.devices

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.aylink.mobile.ui.remote.AyDialog

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun FileActionSheet(
    listState: FileManagerListUiState,
    dialogState: FileManagerDialogUiState,
    onIntent: (FileManagerIntent) -> Unit,
) {
    val file = dialogState.selectedFile?.takeIf { dialogState.isActionMenuOpen } ?: return
    val path = fileEntryPath(listState.currentPath, file)
    ModalBottomSheet(
        onDismissRequest = { onIntent(FileManagerIntent.HideActionMenu) },
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    ) {
        LazyColumn(contentPadding = PaddingValues(bottom = 24.dp)) {
            item {
                Row(modifier = Modifier.fillMaxWidth().padding(start = 24.dp, end = 8.dp, bottom = 12.dp)) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(file.name, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Text(
                            fileDescription(file),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Text(
                            listState.currentPath,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    IconButton(onClick = { onIntent(FileManagerIntent.HideActionMenu) }) { Icon(Icons.Default.Close, "关闭操作面板") }
                }
            }
            if (!file.isDirectory) {
                item {
                    FileActionItem(
                        "打开",
                        Icons.AutoMirrored.Filled.OpenInNew,
                        !dialogState.busy,
                    ) { onIntent(FileManagerIntent.OpenFile(path)) }
                }
                item {
                    FileActionItem(
                        "下载到本地",
                        Icons.Default.Download,
                        !dialogState.busy,
                    ) { onIntent(FileManagerIntent.DownloadFile(path)) }
                }
                item { FileActionItem("分享", Icons.Default.Share, !dialogState.busy) { onIntent(FileManagerIntent.ShareFile(path)) } }
            }
            item { FileActionItem("复制路径", Icons.Default.ContentCopy) { onIntent(FileManagerIntent.CopyPath(path)) } }
            item {
                FileActionItem(
                    "重命名",
                    Icons.Default.Edit,
                    !dialogState.busy,
                ) { onIntent(FileManagerIntent.ShowRenameDialog(file.name)) }
            }
            item { HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp)) }
            item {
                FileActionItem(
                    "删除",
                    Icons.Default.Delete,
                    !dialogState.busy,
                    destructive = true,
                ) { onIntent(FileManagerIntent.ShowDeleteDialog) }
            }
        }
    }
}

@Composable
private fun FileActionItem(
    label: String,
    icon: ImageVector,
    enabled: Boolean = true,
    destructive: Boolean = false,
    onClick: () -> Unit,
) {
    val color = if (destructive) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface
    ListItem(
        modifier = Modifier.fillMaxWidth().clickable(enabled = enabled, onClick = onClick),
        headlineContent = { Text(label, color = color.copy(alpha = if (enabled) 1f else 0.38f)) },
        leadingContent = { Icon(icon, contentDescription = null, tint = color.copy(alpha = if (enabled) 1f else 0.38f)) },
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
    )
}

@Composable
internal fun FileRenameDialog(
    listState: FileManagerListUiState,
    dialogState: FileManagerDialogUiState,
    onIntent: (FileManagerIntent) -> Unit,
) {
    val file = dialogState.selectedFile?.takeIf { dialogState.isRenameDialogOpen } ?: return
    val name = dialogState.renameTargetName
    val error = fileNameError(name) ?: if (name != file.name && listState.files.any { it.name == name }) "同名文件已存在" else null
    AyDialog(
        title = "重命名",
        onDismissRequest = { onIntent(FileManagerIntent.HideRenameDialog) },
        content = {
            OutlinedTextField(
                value = name,
                onValueChange = { onIntent(FileManagerIntent.UpdateRenameTargetName(it)) },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("新名称") },
                enabled = !dialogState.actionLoading,
                singleLine = true,
                isError = error != null,
                supportingText = error?.let { message -> { Text(message) } },
            )
        },
        footer = {
            Row(modifier = Modifier.fillMaxWidth()) {
                TextButton(onClick = {
                    onIntent(FileManagerIntent.HideRenameDialog)
                }, enabled = !dialogState.actionLoading, modifier = Modifier.weight(1f)) { Text("取消") }
                Button(
                    onClick = { onIntent(FileManagerIntent.RenameFile(fileEntryPath(listState.currentPath, file), name)) },
                    enabled = error == null && name != file.name && !dialogState.actionLoading,
                    modifier = Modifier.weight(1f),
                ) {
                    if (dialogState.actionLoading) {
                        CircularProgressIndicator(
                            Modifier.size(20.dp),
                            strokeWidth = 2.dp,
                            color = MaterialTheme.colorScheme.onPrimary,
                        )
                    } else {
                        Text("保存")
                    }
                }
            }
        },
    )
}

@Composable
internal fun FileDeleteDialog(
    listState: FileManagerListUiState,
    dialogState: FileManagerDialogUiState,
    onIntent: (FileManagerIntent) -> Unit,
) {
    val file = dialogState.selectedFile?.takeIf { dialogState.isDeleteDialogOpen } ?: return
    val path = fileEntryPath(listState.currentPath, file)
    AyDialog(
        title = if (file.isDirectory) "删除文件夹" else "删除文件",
        onDismissRequest = { onIntent(FileManagerIntent.HideDeleteDialog) },
        content = {
            Text("确认删除“${file.name}”？")
            Spacer(Modifier.height(8.dp))
            Text(path, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        },
        footer = {
            Row(modifier = Modifier.fillMaxWidth()) {
                TextButton(onClick = {
                    onIntent(FileManagerIntent.HideDeleteDialog)
                }, enabled = !dialogState.actionLoading, modifier = Modifier.weight(1f)) { Text("取消") }
                Button(
                    onClick = { onIntent(FileManagerIntent.DeleteFile(path)) },
                    enabled = !dialogState.actionLoading,
                    colors =
                        ButtonDefaults.buttonColors(
                            containerColor = MaterialTheme.colorScheme.error,
                            contentColor = MaterialTheme.colorScheme.onError,
                        ),
                    modifier = Modifier.weight(1f),
                ) {
                    if (dialogState.actionLoading) {
                        CircularProgressIndicator(
                            Modifier.size(20.dp),
                            strokeWidth = 2.dp,
                            color = MaterialTheme.colorScheme.onError,
                        )
                    } else {
                        Text("删除")
                    }
                }
            }
        },
    )
}
