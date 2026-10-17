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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aylink.mobile.data.model.Device

@Composable
internal fun AppManagerOptionsMenu(
    viewModel: AppManagerViewModel,
    device: Device,
) {
    val listState by viewModel.listUiState.collectAsStateWithLifecycle()
    val dialogState by viewModel.dialogUiState.collectAsStateWithLifecycle()
    var expanded by remember { mutableStateOf(false) }
    val busy = dialogState.installLoading || listState.loading
    val apkPicker =
        rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
            if (uri != null) viewModel.handleIntent(AppManagerIntent.InstallApk(uri))
        }
    Box {
        IconButton(onClick = { expanded = true }) {
            Icon(Icons.Default.MoreVert, contentDescription = "应用管理选项")
        }
        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
            modifier =
                Modifier
                    .widthIn(min = 240.dp, max = 320.dp)
                    .heightIn(max = (LocalConfiguration.current.screenHeightDp - 96).coerceAtLeast(200).dp),
        ) {
            Column(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("设备", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        if (busy) CircularProgressIndicator(modifier = Modifier.size(12.dp), strokeWidth = 2.dp)
                        Text(
                            when {
                                dialogState.installLoading -> "正在安装"
                                listState.loading -> "正在加载"
                                listState.errorMessage != null -> "操作失败"
                                else -> "共 ${listState.apps.size} 个应用"
                            },
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
                    device.name.ifBlank { device.serial.ifBlank { "未命名设备" } },
                    style = MaterialTheme.typography.titleSmall,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                if (device.serial.isNotBlank()) {
                    Text(
                        "序列号：${device.serial}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            HorizontalDivider()
            DropdownMenuItem(
                text = { Text("安装 APK") },
                enabled = !busy,
                onClick = {
                    expanded = false
                    apkPicker.launch(arrayOf("application/vnd.android.package-archive", "application/octet-stream"))
                },
            )
            DropdownMenuItem(
                text = { Text("刷新") },
                enabled = !busy,
                onClick = {
                    expanded = false
                    viewModel.handleIntent(AppManagerIntent.Refresh)
                },
            )
        }
    }
}
