package com.aylink.mobile.ui.devices

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aylink.mobile.data.model.Device
import com.aylink.mobile.data.model.DeviceApp
import com.aylink.mobile.ui.remote.AyDialog

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppManagerScreen(
    viewModel: AppManagerViewModel,
    onOpenRemote: (Device, String, String) -> Unit,
) {
    val listState by viewModel.listUiState.collectAsStateWithLifecycle()
    val dialogState by viewModel.dialogUiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val apkPicker =
        rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
            if (uri != null) {
                viewModel.handleIntent(AppManagerIntent.InstallApk(uri))
            }
        }

    LaunchedEffect(viewModel.effect) {
        viewModel.effect.collect { effect ->
            when (effect) {
                is AppManagerEffect.ShowToast -> {
                    Toast.makeText(context, effect.message, Toast.LENGTH_SHORT).show()
                }
                is AppManagerEffect.CopyText -> {
                    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    clipboard.setPrimaryClip(ClipData.newPlainText("packageName", effect.text))
                    Toast.makeText(context, effect.successMessage, Toast.LENGTH_SHORT).show()
                }
                is AppManagerEffect.NavigateToRemote -> {
                    onOpenRemote(effect.device, effect.packageName, effect.appName)
                }
            }
        }
    }

    Box(
        modifier = Modifier.fillMaxSize(),
    ) {
        Column(
            modifier = Modifier.fillMaxSize(),
        ) {
            Surface(
                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Row(
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    CompactTopButton(
                        onClick = { apkPicker.launch(arrayOf("application/vnd.android.package-archive", "application/octet-stream")) },
                        enabled = !dialogState.installLoading && !listState.loading,
                        text = if (dialogState.installLoading) "安装中..." else "安装 APK",
                        icon = Icons.Default.Add,
                        modifier = Modifier.weight(1f),
                    ) {
                        if (dialogState.installLoading) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(16.dp),
                                strokeWidth = 2.dp,
                                color = MaterialTheme.colorScheme.onSurface,
                            )
                        }
                    }
                    CompactTopButton(
                        onClick = { viewModel.handleIntent(AppManagerIntent.Refresh) },
                        enabled = !dialogState.installLoading && !listState.loading,
                        text = "刷新",
                        icon = Icons.Default.Refresh,
                        modifier = Modifier.weight(1f),
                    )
                }
            }

            if (dialogState.installLoading) {
                Surface(
                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.2f),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        dialogState.installProgress?.let { progress ->
                            if (progress >= 1f) {
                                LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                            } else {
                                LinearProgressIndicator(
                                    progress = { progress },
                                    modifier = Modifier.fillMaxWidth(),
                                )
                            }
                        } ?: LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                        Text(
                            text = dialogState.installMessage ?: "正在安装...",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }

            if (listState.errorMessage != null) {
                Surface(
                    color = MaterialTheme.colorScheme.errorContainer,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        text = listState.errorMessage.orEmpty(),
                        color = MaterialTheme.colorScheme.onErrorContainer,
                        modifier = Modifier.padding(16.dp),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }

            if (listState.loading && listState.apps.isEmpty()) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            } else if (!listState.loading && listState.apps.isEmpty()) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(
                            imageVector = Icons.Default.PlayArrow,
                            contentDescription = null,
                            modifier = Modifier.size(64.dp),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f),
                        )
                        Spacer(modifier = Modifier.height(16.dp))
                        Text(
                            "没有发现应用",
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(bottom = 80.dp),
                    verticalArrangement = Arrangement.spacedBy(1.dp),
                ) {
                    items(listState.apps, key = { it.packageName }) { app ->
                        AppListItem(
                            app = app,
                            onClick = { viewModel.handleIntent(AppManagerIntent.ShowAppInfo(app)) },
                        )
                    }
                }
            }
        }

        AppInfoDialog(
            dialogState = dialogState,
            onIntent = { viewModel.handleIntent(it) },
        )
    }
}

@Composable
private fun AppInfoDialog(
    dialogState: AppManagerDialogUiState,
    onIntent: (AppManagerIntent) -> Unit,
) {
    dialogState.selectedApp?.takeIf { dialogState.isAppInfoDialogOpen }?.let { app ->
        AyDialog(
            title = "应用信息",
            onDismissRequest = { onIntent(AppManagerIntent.HideAppInfo) },
            content = {
                Text(
                    text = app.name.ifBlank { "未知应用" },
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = app.packageName,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(modifier = Modifier.height(24.dp))

                if (dialogState.appInfoLoading) {
                    Box(modifier = Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator()
                    }
                } else {
                    Column(
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        InfoRow("包名", dialogState.appInfo?.packageName ?: app.packageName)
                        InfoRow("版本名称", dialogState.appInfo?.versionName?.ifBlank { "-" } ?: "-")
                        InfoRow("版本号", dialogState.appInfo?.versionCode?.ifBlank { "-" } ?: "-")
                        InfoRow("首次安装", dialogState.appInfo?.firstInstallTime?.ifBlank { "-" } ?: "-")
                        InfoRow("最后更新", dialogState.appInfo?.lastUpdateTime?.ifBlank { "-" } ?: "-")
                        InfoRow("安装来源", dialogState.appInfo?.installerPackageName?.ifBlank { "-" } ?: "-")
                        InfoRow("主 APK", dialogState.appInfo?.primaryApkPath?.ifBlank { "-" } ?: "-")

                        Spacer(modifier = Modifier.height(8.dp))

                        Button(
                            onClick = { onIntent(AppManagerIntent.StartRemoteForApp(app)) },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Icon(Icons.Default.PlayArrow, contentDescription = null)
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("投屏此应用")
                        }
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            CompactDialogButton(
                                onClick = { onIntent(AppManagerIntent.LaunchApp(app.packageName)) },
                                text = "启动",
                                icon = Icons.Default.PlayArrow,
                                modifier = Modifier.weight(1f),
                            )
                            CompactDialogButton(
                                onClick = { onIntent(AppManagerIntent.CopyPackageName(app.packageName)) },
                                text = "复制包名",
                                icon = Icons.Default.Info,
                                modifier = Modifier.weight(1f),
                            )
                        }
                        CompactDialogButton(
                            onClick = { onIntent(AppManagerIntent.UninstallApp(app.packageName)) },
                            text = "卸载应用",
                            icon = Icons.Default.Warning,
                            modifier = Modifier.fillMaxWidth(),
                            contentColor = MaterialTheme.colorScheme.error,
                        ) {
                            if (dialogState.actionLoading) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(16.dp),
                                    strokeWidth = 2.dp,
                                    color = MaterialTheme.colorScheme.error,
                                )
                            }
                        }
                    }
                }
            },
            footer = {
                Button(
                    onClick = { onIntent(AppManagerIntent.HideAppInfo) },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("关闭") }
            },
        )
    }
}

@Composable
private fun CompactTopButton(
    onClick: () -> Unit,
    text: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    trailing: @Composable (() -> Unit)? = null,
) {
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.height(40.dp),
        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 0.dp),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
        ) {
            Icon(icon, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(modifier = Modifier.width(6.dp))
            Text(text, style = MaterialTheme.typography.labelLarge)
            trailing?.let {
                Spacer(modifier = Modifier.width(6.dp))
                it()
            }
        }
    }
}

@Composable
private fun CompactDialogButton(
    onClick: () -> Unit,
    text: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    modifier: Modifier = Modifier,
    contentColor: androidx.compose.ui.graphics.Color = MaterialTheme.colorScheme.onSurface,
    trailing: @Composable (() -> Unit)? = null,
) {
    OutlinedButton(
        onClick = onClick,
        modifier = modifier.height(40.dp),
        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 0.dp),
        colors = ButtonDefaults.outlinedButtonColors(contentColor = contentColor),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
        ) {
            Icon(icon, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(modifier = Modifier.width(6.dp))
            Text(text, style = MaterialTheme.typography.labelLarge)
            trailing?.let {
                Spacer(modifier = Modifier.width(6.dp))
                it()
            }
        }
    }
}

@Composable
fun AppListItem(
    app: DeviceApp,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        color = MaterialTheme.colorScheme.surface,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Surface(
                shape = CircleShape,
                color = MaterialTheme.colorScheme.primaryContainer,
                modifier = Modifier.size(40.dp),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        imageVector = Icons.Default.Info,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onPrimaryContainer,
                    )
                }
            }

            Spacer(modifier = Modifier.width(16.dp))

            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = app.name.ifBlank { "未知应用" },
                    style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Medium),
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                )
                Spacer(modifier = Modifier.height(2.dp))
                Text(
                    text = app.packageName,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                IconButton(onClick = onClick) {
                    Icon(Icons.Default.Info, contentDescription = "查看详情")
                }
            }
        }
    }
}

@Composable
private fun InfoRow(
    label: String,
    value: String,
) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(modifier = Modifier.height(2.dp))
        Text(
            text = value,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
}
