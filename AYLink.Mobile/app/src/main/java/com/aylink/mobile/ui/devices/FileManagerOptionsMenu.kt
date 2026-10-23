package com.aylink.mobile.ui.devices

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aylink.mobile.data.model.Device
import com.aylink.mobile.ui.remote.AyDialog

@Composable
internal fun FileManagerOptionsMenu(
    viewModel: FileManagerViewModel,
    device: Device,
) {
    val listState by viewModel.listUiState.collectAsStateWithLifecycle()
    val dialogState by viewModel.dialogUiState.collectAsStateWithLifecycle()
    var expanded by remember { mutableStateOf(false) }
    var uploadPath by rememberSaveable { mutableStateOf<String?>(null) }
    var sortOpen by rememberSaveable { mutableStateOf(false) }
    var sortDraft by remember { mutableStateOf(listState.sortOrder) }
    val filePicker =
        rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
            val target = uploadPath
            uploadPath = null
            if (uris.isNotEmpty() && target != null) viewModel.handleIntent(FileManagerIntent.UploadFiles(uris, target))
        }
    val folderPicker =
        rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
            val target = uploadPath
            uploadPath = null
            if (uri != null && target != null) viewModel.handleIntent(FileManagerIntent.UploadFolder(uri, target))
        }
    val status =
        when {
            dialogState.uploadLoading -> "正在上传"
            dialogState.downloadMessage != null -> "正在下载"
            dialogState.actionLoading -> "处理中"
            listState.loading -> "正在加载"
            listState.failedPath != null -> "加载失败"
            listState.errorMessage != null -> "操作失败"
            else -> "就绪"
        }
    Box {
        IconButton(onClick = { expanded = true }) { Icon(Icons.Default.MoreVert, contentDescription = "文件管理选项") }
        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
            modifier =
                Modifier
                    .widthIn(
                        min = 240.dp,
                        max = 320.dp,
                    ).heightIn(max = (LocalConfiguration.current.screenHeightDp - 96).coerceAtLeast(200).dp),
        ) {
            Column(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text("设备", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (dialogState.busy || listState.loading) CircularProgressIndicator(Modifier.size(12.dp), strokeWidth = 2.dp)
                        Text(
                            status,
                            style = MaterialTheme.typography.bodySmall,
                            color =
                                if (listState.errorMessage !=
                                    null
                                ) {
                                    MaterialTheme.colorScheme.error
                                } else {
                                    MaterialTheme.colorScheme.onSurfaceVariant
                                },
                        )
                    }
                }
                Text(
                    device.name.ifBlank {
                        device.serial.ifBlank { "未命名设备" }
                    },
                    style = MaterialTheme.typography.titleSmall,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            HorizontalDivider()
            DropdownMenuItem(
                text = { Text("上传文件") },
                enabled = !listState.loading && !dialogState.busy,
                onClick = {
                    expanded = false
                    uploadPath = listState.currentPath
                    filePicker.launch(arrayOf("*/*"))
                },
            )
            DropdownMenuItem(
                text = { Text("上传文件夹") },
                enabled = !listState.loading && !dialogState.busy,
                onClick = {
                    expanded = false
                    uploadPath = listState.currentPath
                    folderPicker.launch(null)
                },
            )
            DropdownMenuItem(text = { Text("刷新") }, enabled = !listState.loading, onClick = {
                expanded = false
                viewModel.handleIntent(FileManagerIntent.Refresh)
            })
            HorizontalDivider()
            DropdownMenuItem(text = { Text("排序方式") }, onClick = {
                expanded = false
                sortDraft = listState.sortOrder
                sortOpen = true
            })
            DropdownMenuItem(text = { Text("跳转路径") }, enabled = !listState.loading && !dialogState.actionLoading, onClick = {
                expanded = false
                viewModel.handleIntent(FileManagerIntent.ShowPathEditor)
            })
            DropdownMenuItem(text = { Text("复制当前路径") }, enabled = !listState.loading, onClick = {
                expanded = false
                viewModel.handleIntent(FileManagerIntent.CopyPath(listState.currentPath))
            })
        }
    }
    if (sortOpen) {
        AyDialog(
            title = "排序方式",
            onDismissRequest = { sortOpen = false },
            content = {
                Column(modifier = Modifier.fillMaxWidth().selectableGroup()) {
                    FileSortOrder.entries.forEach { order ->
                        Row(
                            modifier =
                                Modifier
                                    .fillMaxWidth()
                                    .selectable(selected = sortDraft == order, onClick = {
                                        sortDraft = order
                                    }, role = Role.RadioButton)
                                    .padding(vertical = 12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            RadioButton(selected = sortDraft == order, onClick = null)
                            Text(order.label)
                        }
                    }
                    Text("文件夹始终排在前面", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            },
            footer = {
                Row(modifier = Modifier.fillMaxWidth()) {
                    TextButton(onClick = { sortOpen = false }, modifier = Modifier.weight(1f)) { Text("取消") }
                    Button(onClick = {
                        viewModel.handleIntent(FileManagerIntent.SetSortOrder(sortDraft))
                        sortOpen = false
                    }, modifier = Modifier.weight(1f)) { Text("确定") }
                }
            },
        )
    }
}
