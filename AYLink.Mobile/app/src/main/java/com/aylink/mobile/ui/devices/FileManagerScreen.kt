package com.aylink.mobile.ui.devices

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.detectTapGestures
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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.InsertDriveFile
import androidx.compose.material.icons.filled.Android
import androidx.compose.material.icons.filled.Archive
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.AudioFile
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.FolderOpen
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PictureAsPdf
import androidx.compose.material.icons.filled.VideoFile
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.SubcomposeLayout
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aylink.mobile.data.model.FileEntry
import com.aylink.mobile.data.model.LocalFileHandle
import java.util.Locale

@Composable
fun FileManagerScreen(viewModel: FileManagerViewModel) {
    val listState by viewModel.listUiState.collectAsStateWithLifecycle()
    val dialogState by viewModel.dialogUiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val scrollStates = rememberSaveableStateHolder()
    val files = remember(listState.files, listState.sortOrder) { sortFileEntries(listState.files, listState.sortOrder) }

    LaunchedEffect(viewModel.effect) {
        viewModel.effect.collect { effect ->
            when (effect) {
                is FileManagerEffect.ShowToast -> Toast.makeText(context, effect.message, Toast.LENGTH_SHORT).show()
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

    Column(modifier = Modifier.fillMaxSize()) {
        FilePathBar(
            path = listState.pendingPath ?: listState.currentPath,
            loading = listState.loading,
            editing = listState.isPathEditorOpen,
            onEditPath = { viewModel.handleIntent(FileManagerIntent.ShowPathEditor) },
            onCancelEditing = { viewModel.handleIntent(FileManagerIntent.HidePathEditor) },
            onGoUp = { viewModel.handleIntent(FileManagerIntent.GoUp) },
            onOpenPath = { viewModel.handleIntent(FileManagerIntent.OpenPath(it)) },
        )
        FileTransferPanel(dialogState, onCancelUpload = { viewModel.handleIntent(FileManagerIntent.CancelUpload) })
        listState.errorMessage?.let { message ->
            Surface(color = MaterialTheme.colorScheme.errorContainer, modifier = Modifier.fillMaxWidth()) {
                Row(
                    modifier = Modifier.padding(start = 16.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        message,
                        color = MaterialTheme.colorScheme.onErrorContainer,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.weight(1f),
                    )
                    if (listState.failedPath != null) {
                        TextButton(onClick = { viewModel.handleIntent(FileManagerIntent.Retry) }) { Text("重试") }
                    }
                    IconButton(onClick = { viewModel.handleIntent(FileManagerIntent.DismissError) }) {
                        Icon(Icons.Default.Close, contentDescription = "关闭错误提示", tint = MaterialTheme.colorScheme.onErrorContainer)
                    }
                }
            }
        }
        if (listState.loading && listState.hasLoaded && listState.pendingPath == listState.currentPath) {
            LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
        }

        val changingDirectory = listState.loading && listState.pendingPath != listState.currentPath
        when {
            listState.loading && (!listState.hasLoaded || changingDirectory) -> {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            }
            listState.showEmpty -> {
                Column(
                    modifier = Modifier.fillMaxSize(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Icon(
                        Icons.Default.FolderOpen,
                        contentDescription = null,
                        modifier = Modifier.size(40.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(12.dp))
                    Text("此文件夹为空", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            listState.hasLoaded -> {
                Text(
                    "${files.count { it.isDirectory }} 个文件夹 · ${files.count { !it.isDirectory }} 个文件",
                    modifier = Modifier.padding(start = 20.dp, top = 12.dp, bottom = 4.dp),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                scrollStates.SaveableStateProvider(listState.currentPath) {
                    LazyColumn(
                        state = rememberLazyListState(),
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(bottom = 24.dp),
                    ) {
                        items(files, key = { it.name }) { file ->
                            FileListItem(
                                file = file,
                                enabled = !listState.loading,
                                onClick = {
                                    viewModel.handleIntent(
                                        if (file.isDirectory) {
                                            FileManagerIntent.OpenDirectory(
                                                file.name,
                                            )
                                        } else {
                                            FileManagerIntent.ShowActionMenu(file)
                                        },
                                    )
                                },
                                onMoreClick = { viewModel.handleIntent(FileManagerIntent.ShowActionMenu(file)) },
                            )
                        }
                    }
                }
            }
        }
    }
    FileActionSheet(listState, dialogState, viewModel::handleIntent)
    FileRenameDialog(listState, dialogState, viewModel::handleIntent)
    FileDeleteDialog(listState, dialogState, viewModel::handleIntent)
}

@Composable
internal fun FilePathBar(
    path: String,
    loading: Boolean,
    editing: Boolean,
    onEditPath: () -> Unit,
    onCancelEditing: () -> Unit,
    onGoUp: () -> Unit,
    onOpenPath: (String) -> Unit,
) {
    val breadcrumbs = remember(path) { fileBreadcrumbs(path) }
    val visibleBreadcrumbs = if (breadcrumbs.getOrNull(1)?.path == "/sdcard/") breadcrumbs.drop(1) else breadcrumbs
    var ancestorsExpanded by remember(path) { mutableStateOf(false) }
    var pathDraft by remember(path) { mutableStateOf(path) }
    val focusRequester = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    val cancelEditing = {
        onCancelEditing()
        keyboard?.hide()
    }
    BackHandler(enabled = editing) { cancelEditing() }
    Column {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .clickable(
                        interactionSource = null,
                        indication = null,
                        enabled = !loading && !editing,
                        onClickLabel = "编辑路径",
                        onClick = onEditPath,
                    ).padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(
                onClick = onGoUp,
                enabled = path != "/" && !loading,
                modifier = Modifier.pointerInput(Unit) { detectTapGestures(onTap = {}) },
            ) {
                Icon(Icons.Default.ArrowUpward, contentDescription = "返回上级目录")
            }
            if (editing) {
                val valid = pathDraft.startsWith('/') && '\u0000' !in pathDraft
                val submitPath = {
                    if (valid && !loading) {
                        cancelEditing()
                        onOpenPath(pathDraft)
                    }
                }
                LaunchedEffect(Unit) {
                    pathDraft = path
                    ancestorsExpanded = false
                    focusRequester.requestFocus()
                    keyboard?.show()
                }
                OutlinedTextField(
                    value = pathDraft,
                    onValueChange = { pathDraft = it },
                    modifier = Modifier.weight(1f).focusRequester(focusRequester),
                    enabled = !loading,
                    label = { Text("远端绝对路径") },
                    singleLine = true,
                    isError = !valid,
                    supportingText =
                        if (!valid) {
                            { Text("请输入以 / 开头的路径") }
                        } else {
                            null
                        },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
                    keyboardActions = KeyboardActions(onGo = { submitPath() }),
                    trailingIcon = {
                        Row {
                            IconButton(onClick = { cancelEditing() }) {
                                Icon(Icons.Default.Close, contentDescription = "取消编辑路径")
                            }
                            IconButton(onClick = { submitPath() }, enabled = valid && !loading) {
                                Icon(Icons.Default.Check, contentDescription = "前往路径")
                            }
                        }
                    },
                )
            } else {
                SubcomposeLayout(modifier = Modifier.weight(1f)) { constraints ->
                    // 用实际组件的自然宽度决定折叠范围，避免按路径层数或字符数猜测。
                    val measured =
                        subcompose("measure") {
                            visibleBreadcrumbs.forEachIndexed { index, crumb ->
                                FilePathBreadcrumb(
                                    crumb = crumb,
                                    current = index == visibleBreadcrumbs.lastIndex,
                                    loading = loading,
                                    onOpenPath = onOpenPath,
                                    modifier = Modifier.clearAndSetSemantics {},
                                )
                            }
                            IconButton(onClick = {}, modifier = Modifier.clearAndSetSemantics {}) {
                                Icon(Icons.Default.MoreHoriz, contentDescription = null)
                            }
                        }.map { it.measure(Constraints()) }
                    val widths = measured.dropLast(1).map { it.width }
                    var firstVisible = 0
                    var usedWidth = widths.sum()
                    if (usedWidth > constraints.maxWidth) {
                        usedWidth += measured.last().width
                        while (firstVisible < visibleBreadcrumbs.lastIndex && usedWidth > constraints.maxWidth) {
                            usedWidth -= widths[firstVisible++]
                        }
                    }
                    val hiddenBreadcrumbs = breadcrumbs.dropLast(visibleBreadcrumbs.size - firstVisible)
                    val content =
                        subcompose("content") {
                            Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                if (firstVisible > 0) {
                                    Box {
                                        IconButton(onClick = { ancestorsExpanded = true }, enabled = !loading) {
                                            Icon(Icons.Default.MoreHoriz, contentDescription = "选择上级目录")
                                        }
                                        DropdownMenu(
                                            expanded = ancestorsExpanded,
                                            onDismissRequest = { ancestorsExpanded = false },
                                            modifier =
                                                Modifier.widthIn(
                                                    max = (LocalConfiguration.current.screenWidthDp - 32).coerceAtLeast(200).dp,
                                                ),
                                        ) {
                                            hiddenBreadcrumbs.forEach { crumb ->
                                                DropdownMenuItem(
                                                    text = { Text(crumb.label, maxLines = 2, overflow = TextOverflow.Ellipsis) },
                                                    onClick = {
                                                        ancestorsExpanded = false
                                                        onOpenPath(crumb.path)
                                                    },
                                                )
                                            }
                                        }
                                    }
                                }
                                visibleBreadcrumbs.drop(firstVisible).forEach { crumb ->
                                    val current = crumb == visibleBreadcrumbs.last()
                                    FilePathBreadcrumb(
                                        crumb = crumb,
                                        current = current,
                                        loading = loading,
                                        onOpenPath = onOpenPath,
                                        modifier = if (current) Modifier.weight(1f, fill = false) else Modifier,
                                    )
                                }
                            }
                        }.single().measure(constraints)
                    layout(content.width, content.height) {
                        content.placeRelative(0, 0)
                    }
                }
            }
        }
        HorizontalDivider()
    }
}

@Composable
private fun FilePathBreadcrumb(
    crumb: FileBreadcrumb,
    current: Boolean,
    loading: Boolean,
    onOpenPath: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        // 路径内容消费自身的点击，只有外围实际空白才交给路径栏进入编辑。
        modifier = modifier.pointerInput(Unit) { detectTapGestures(onTap = {}) },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (current) {
            Text(
                crumb.label,
                modifier = Modifier.padding(horizontal = 6.dp),
                color = MaterialTheme.colorScheme.primary,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        } else {
            TextButton(
                onClick = { onOpenPath(crumb.path) },
                enabled = !loading,
                contentPadding = PaddingValues(horizontal = 6.dp),
            ) { Text(crumb.label, maxLines = 1, overflow = TextOverflow.Ellipsis) }
            Icon(
                Icons.Default.ChevronRight,
                contentDescription = null,
                modifier = Modifier.size(16.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun FileTransferPanel(
    state: FileManagerDialogUiState,
    onCancelUpload: () -> Unit,
) {
    if (!state.uploadLoading && state.downloadMessage == null) return
    val progress = if (state.uploadLoading) state.uploadProgress else state.downloadProgress
    val message = if (state.uploadLoading) state.uploadMessage else state.downloadMessage
    Surface(color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f), modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(
                        state.transferTitle.orEmpty(),
                        style = MaterialTheme.typography.bodyMedium,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        listOfNotNull(message, progress?.let { "${(it * 100).toInt()}%" }).joinToString(" · "),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (state.uploadLoading) TextButton(onClick = onCancelUpload) { Text("取消") }
            }
            if (progress !=
                null
            ) {
                LinearProgressIndicator(progress = { progress }, modifier = Modifier.fillMaxWidth())
            } else {
                LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            }
        }
    }
}

@Composable
fun FileListItem(
    file: FileEntry,
    onClick: () -> Unit,
    onMoreClick: () -> Unit,
    enabled: Boolean = true,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .combinedClickable(
                    enabled = enabled,
                    onClick = onClick,
                    onLongClick = onMoreClick,
                ).padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(modifier = Modifier.size(40.dp), contentAlignment = Alignment.Center) {
            Icon(
                fileIcon(file),
                contentDescription = null,
                modifier = Modifier.size(26.dp),
                tint = if (file.isDirectory) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Spacer(Modifier.width(16.dp))
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(file.name, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(fileDescription(file), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        IconButton(onClick = onMoreClick, enabled = enabled) {
            Icon(Icons.Default.MoreVert, contentDescription = "${file.name} 的更多操作", tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

private fun fileIcon(file: FileEntry): ImageVector =
    if (file.isDirectory) {
        Icons.Default.Folder
    } else {
        when (file.name.substringAfterLast('.', "").lowercase(Locale.ROOT)) {
            "apk" -> Icons.Default.Android
            "jpg", "jpeg", "png", "gif", "webp", "bmp", "heic" -> Icons.Default.Image
            "mp4", "mkv", "webm", "avi", "mov" -> Icons.Default.VideoFile
            "mp3", "wav", "flac", "aac", "ogg", "m4a" -> Icons.Default.AudioFile
            "zip", "7z", "rar", "tar", "gz", "xz" -> Icons.Default.Archive
            "txt", "log", "md", "json", "xml", "yaml", "yml", "sh" -> Icons.Default.Description
            "pdf" -> Icons.Default.PictureAsPdf
            else -> Icons.AutoMirrored.Filled.InsertDriveFile
        }
    }

internal fun fileDescription(file: FileEntry): String =
    if (file.isDirectory) {
        "文件夹"
    } else {
        "${file.name.substringAfterLast(
            '.',
            "",
        ).uppercase(Locale.ROOT).ifBlank { "文件" }} · ${formatFileSize(file.size)}"
    }

private fun formatFileSize(size: Long): String =
    when {
        size < 1024 -> "$size B"
        size < 1024 * 1024 -> String.format(Locale.ROOT, "%.1f KB", size / 1024f)
        size < 1024 * 1024 * 1024 -> String.format(Locale.ROOT, "%.1f MB", size / 1024f / 1024f)
        else -> String.format(Locale.ROOT, "%.1f GB", size / 1024f / 1024f / 1024f)
    }

private fun openLocalFile(
    context: Context,
    file: LocalFileHandle,
) {
    val intent =
        Intent(
            Intent.ACTION_VIEW,
        ).setDataAndType(file.uri, file.mimeType).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    runCatching {
        context.startActivity(Intent.createChooser(intent, "打开文件"))
    }.onFailure { Toast.makeText(context, "没有可用的打开方式", Toast.LENGTH_SHORT).show() }
}

private fun shareLocalFile(
    context: Context,
    file: LocalFileHandle,
) {
    val intent =
        Intent(
            Intent.ACTION_SEND,
        ).setType(
            file.mimeType,
        ).putExtra(Intent.EXTRA_STREAM, file.uri)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    runCatching {
        context.startActivity(Intent.createChooser(intent, "分享文件"))
    }.onFailure { Toast.makeText(context, "无法分享该文件", Toast.LENGTH_SHORT).show() }
}
