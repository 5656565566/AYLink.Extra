package com.aylink.mobile.ui.devices

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
import androidx.compose.material3.OutlinedButton
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
import com.aylink.mobile.data.model.DeviceGroup
import com.aylink.mobile.ui.remote.AyDialog

@Composable
internal fun DeviceListOptionsMenu(viewModel: DeviceListViewModel) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var expanded by remember { mutableStateOf(false) }
    var groupPickerOpen by remember { mutableStateOf(false) }
    val availableGroups =
        remember(state.devices) {
            state.devices
                .flatMap { it.groups }
                .distinctBy(DeviceGroup::id)
                .sortedBy { it.name.ifBlank { "未分组" } }
        }
    val selectedGroupName =
        if (state.selectedGroupId == 0) {
            "全部设备"
        } else {
            availableGroups.firstOrNull { it.id == state.selectedGroupId }?.name?.ifBlank { "未分组" } ?: "设备分组"
        }
    val deviceCount =
        remember(state.devices, state.selectedGroupId) {
            state.devices.count { device -> state.selectedGroupId == 0 || device.groups.any { it.id == state.selectedGroupId } }
        }
    Box {
        IconButton(onClick = { expanded = true }) {
            Icon(Icons.Default.MoreVert, contentDescription = "设备列表选项")
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
                        if (state.loading) CircularProgressIndicator(modifier = Modifier.size(12.dp), strokeWidth = 2.dp)
                        Text(
                            when {
                                state.loading -> "处理中"
                                state.errorMessage != null -> "操作失败"
                                else -> "共 $deviceCount 台"
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color =
                                if (state.errorMessage !=
                                    null
                                ) {
                                    MaterialTheme.colorScheme.error
                                } else {
                                    MaterialTheme.colorScheme.onSurfaceVariant
                                },
                        )
                    }
                }
                Text(selectedGroupName, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(
                    if (state.viewMode == DeviceListViewMode.PREVIEW) "预览视图" else "列表视图",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            HorizontalDivider()
            DropdownMenuItem(
                text = { Text("刷新") },
                enabled = !state.loading,
                onClick = {
                    expanded = false
                    viewModel.handleIntent(DeviceListIntent.Refresh)
                },
            )
            DropdownMenuItem(
                text = { Text("选择分组") },
                onClick = {
                    expanded = false
                    groupPickerOpen = true
                },
            )
            DropdownMenuItem(
                text = { Text(if (state.viewMode == DeviceListViewMode.PREVIEW) "切换为列表视图" else "切换为预览视图") },
                onClick = {
                    expanded = false
                    viewModel.handleIntent(DeviceListIntent.ToggleViewMode)
                },
            )
        }
    }
    if (groupPickerOpen) {
        AyDialog(
            title = "选择分组",
            onDismissRequest = { groupPickerOpen = false },
            content = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                    OutlinedButton(
                        onClick = {
                            viewModel.handleIntent(DeviceListIntent.SelectGroup(0))
                            groupPickerOpen = false
                        },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text("全部设备")
                    }
                    availableGroups.forEach { group ->
                        OutlinedButton(
                            onClick = {
                                viewModel.handleIntent(DeviceListIntent.SelectGroup(group.id))
                                groupPickerOpen = false
                            },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text(group.name.ifBlank { "未分组" })
                        }
                    }
                }
            },
            footer = {
                OutlinedButton(onClick = { groupPickerOpen = false }, modifier = Modifier.fillMaxWidth()) {
                    Text("取消")
                }
            },
        )
    }
}
