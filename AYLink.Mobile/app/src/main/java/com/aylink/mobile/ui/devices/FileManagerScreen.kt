package com.aylink.mobile.ui.devices

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aylink.mobile.data.model.FileEntry
import com.aylink.mobile.data.model.LocalFileHandle
import com.aylink.mobile.ui.remote.AyDialog
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FileManagerScreen(
    viewModel: FileManagerViewModel
) {
    val listState by viewModel.listUiState.collectAsStateWithLifecycle()
    val dialogState by viewModel.dialogUiState.collectAsStateWithLifecycle()
    val context = LocalContext.current

    LaunchedEffect(viewModel.effect) {
        viewModel.effect.collect { effect ->
            when (effect) {
                is FileManagerEffect.ShowToast -> {
                    Toast.makeText(context, effect.message, Toast.LENGTH_SHORT).show()
                }
                is FileManagerEffect.CopyText -> {
                    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    clipboard.setPrimaryClip(ClipData.newPlainText("path", effect.text))
                    Toast.makeText(context, effect.successMessage, Toast.LENGTH_SHORT).show()
                }
                is FileManagerEffect.OpenLocalFile -> openLocalFile(context, effect.file)
                is FileManagerEffect.ShareLocalFile -> shareLocalFile(context, effect.file)
            }
        }
    }

    Box(
        modifier = Modifier.fillMaxSize()
    ) {
        Column(
            modifier = Modifier.fillMaxSize()
        ) {
            // Path Bar
            Surface(
                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f),
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    modifier = Modifier.padding(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    IconButton(
                        onClick = { viewModel.handleIntent(FileManagerIntent.GoUp) },
                        enabled = listState.currentPath != "/" && !listState.loading
                    ) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Go Up")
                    }
                    Text(
                        text = listState.currentPath,
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.weight(1f).padding(horizontal = 8.dp)
                    )
                }
            }

            if (listState.errorMessage != null) {
                Surface(
                    color = MaterialTheme.colorScheme.errorContainer,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(
                        text = listState.errorMessage.orEmpty(),
                        color = MaterialTheme.colorScheme.onErrorContainer,
                        modifier = Modifier.padding(16.dp),
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
            }

            if (listState.loading && listState.files.isEmpty()) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            } else if (!listState.loading && listState.files.isEmpty()) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.List,
                            contentDescription = null,
                            modifier = Modifier.size(64.dp),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
                        )
                        Spacer(modifier = Modifier.height(16.dp))
                        Text(
                            "文件夹为空",
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(bottom = 80.dp), // Add padding for bottom navigation if needed or just breathing room
                    verticalArrangement = Arrangement.spacedBy(1.dp) // Less gap for a list view
                ) {
                    items(listState.files, key = { it.name }) { file ->
                        FileListItem(
                            file = file,
                            onClick = {
                                if (file.isDirectory) {
                                    viewModel.handleIntent(FileManagerIntent.OpenDirectory(file.name))
                                } else {
                                    viewModel.handleIntent(FileManagerIntent.ShowActionMenu(file))
                                }
                            },
                            onMoreClick = { viewModel.handleIntent(FileManagerIntent.ShowActionMenu(file)) }
                        )
                    }
                }
            }
        }

        dialogState.selectedFile?.takeIf { dialogState.isActionMenuOpen }?.let { file ->
            val fullPath = listState.currentPath + file.name + if (file.isDirectory) "/" else ""
            
            AyDialog(
                title = "操作",
                onDismissRequest = { viewModel.handleIntent(FileManagerIntent.HideActionMenu) },
                content = {
                    Text(
                        text = file.name,
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                    Spacer(modifier = Modifier.height(24.dp))

                    if (dialogState.actionLoading) {
                        Box(modifier = Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator()
                        }
                    } else {
                        Column(
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            if (!file.isDirectory) {
                                OutlinedButton(
                                    onClick = { viewModel.handleIntent(FileManagerIntent.OpenFile(fullPath)) },
                                    modifier = Modifier.fillMaxWidth()
                                ) {
                                    Text("打开")
                                }
                                OutlinedButton(
                                    onClick = { viewModel.handleIntent(FileManagerIntent.ShareFile(fullPath)) },
                                    modifier = Modifier.fillMaxWidth()
                                ) {
                                    Text("分享")
                                }
                                OutlinedButton(
                                    onClick = { viewModel.handleIntent(FileManagerIntent.DownloadFile(fullPath)) },
                                    modifier = Modifier.fillMaxWidth()
                                ) {
                                    Text("下载到本地")
                                }
                            }
                            OutlinedButton(
                                onClick = { viewModel.handleIntent(FileManagerIntent.CopyPath(fullPath)) },
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text("复制路径")
                            }
                            OutlinedButton(
                                onClick = { viewModel.handleIntent(FileManagerIntent.ShowRenameDialog(file.name)) },
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text("重命名")
                            }
                            OutlinedButton(
                                onClick = { viewModel.handleIntent(FileManagerIntent.DeleteFile(fullPath)) },
                                modifier = Modifier.fillMaxWidth(),
                                colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error)
                            ) {
                                Text("删除")
                            }
                        }
                    }
                },
                footer = {
                    Button(
                        onClick = { viewModel.handleIntent(FileManagerIntent.HideActionMenu) },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("取消")
                    }
                }
            )
        }

        dialogState.selectedFile?.takeIf { dialogState.isRenameDialogOpen }?.let { file ->
            val oldPath = listState.currentPath + file.name + if (file.isDirectory) "/" else ""

            AyDialog(
                title = "重命名",
                onDismissRequest = { viewModel.handleIntent(FileManagerIntent.HideRenameDialog) },
                content = {
                    OutlinedTextField(
                        value = dialogState.renameTargetName,
                        onValueChange = { viewModel.handleIntent(FileManagerIntent.UpdateRenameTargetName(it)) },
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("新名称") },
                        singleLine = true
                    )
                },
                footer = {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        OutlinedButton(
                            onClick = { viewModel.handleIntent(FileManagerIntent.HideRenameDialog) },
                            modifier = Modifier.weight(1f)
                        ) {
                            Text("取消")
                        }
                        Button(
                            onClick = { viewModel.handleIntent(FileManagerIntent.RenameFile(oldPath, dialogState.renameTargetName)) },
                            modifier = Modifier.weight(1f),
                            enabled = dialogState.renameTargetName.isNotBlank() && dialogState.renameTargetName != file.name && !dialogState.actionLoading
                        ) {
                            if (dialogState.actionLoading) {
                                CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
                            } else {
                                Text("保存")
                            }
                        }
                    }
                }
            )
        }
    }
}

@Composable
fun FileListItem(
    file: FileEntry,
    onClick: () -> Unit,
    onMoreClick: () -> Unit
) {
    Surface(
        onClick = onClick,
        color = MaterialTheme.colorScheme.surface,
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Surface(
                shape = CircleShape,
                color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = if (file.isDirectory) 1f else 0.5f),
                modifier = Modifier.size(40.dp)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        imageVector = if (file.isDirectory) Icons.AutoMirrored.Filled.List else Icons.Default.Info,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onPrimaryContainer
                    )
                }
            }
            
            Spacer(modifier = Modifier.width(16.dp))
            
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = file.name,
                    style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Medium),
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 1
                )
                if (!file.isDirectory) {
                    Spacer(modifier = Modifier.height(2.dp))
                    Text(
                        text = formatFileSize(file.size),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            IconButton(onClick = onMoreClick) {
                Icon(
                    imageVector = Icons.Default.MoreVert,
                    contentDescription = "More options",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

private fun formatFileSize(size: Long): String {
    if (size < 1024) return "$size B"
    if (size < 1024 * 1024) return String.format(Locale.ROOT, "%.1f KB", size / 1024f)
    if (size < 1024 * 1024 * 1024) return String.format(Locale.ROOT, "%.1f MB", size / 1024f / 1024f)
    return String.format(Locale.ROOT, "%.1f GB", size / 1024f / 1024f / 1024f)
}

private fun openLocalFile(context: Context, file: LocalFileHandle) {
    val intent = Intent(Intent.ACTION_VIEW)
        .setDataAndType(file.uri, file.mimeType)
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    runCatching {
        ContextCompat.startActivity(context, Intent.createChooser(intent, "打开文件"), null)
    }.onFailure {
        Toast.makeText(context, "没有可用的打开方式", Toast.LENGTH_SHORT).show()
    }
}

private fun shareLocalFile(context: Context, file: LocalFileHandle) {
    val intent = Intent(Intent.ACTION_SEND)
        .setType(file.mimeType)
        .putExtra(Intent.EXTRA_STREAM, file.uri)
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    runCatching {
        ContextCompat.startActivity(context, Intent.createChooser(intent, "分享文件"), null)
    }.onFailure {
        Toast.makeText(context, "无法分享该文件", Toast.LENGTH_SHORT).show()
    }
}
