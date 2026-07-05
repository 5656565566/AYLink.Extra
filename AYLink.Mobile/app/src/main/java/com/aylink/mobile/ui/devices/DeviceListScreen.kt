package com.aylink.mobile.ui.devices

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aylink.mobile.data.model.Device
import com.aylink.mobile.data.model.DeviceGroup
import com.aylink.mobile.ui.remote.AyDialog
import androidx.compose.foundation.lazy.grid.items as gridItems
import androidx.compose.foundation.lazy.items as lazyItems

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DeviceListScreen(
    viewModel: DeviceListViewModel,
    onEditAddress: () -> Unit,
    onLogout: () -> Unit,
    onOpenRemote: (Device) -> Unit,
    onOpenAppManager: (Device) -> Unit,
    onOpenFileManager: (Device) -> Unit,
    onOpenTerminal: (Device) -> Unit,
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val contentState by viewModel.contentUiState.collectAsStateWithLifecycle()
    val dialogState by viewModel.dialogUiState.collectAsStateWithLifecycle()
    var isGroupPickerOpen by remember { mutableStateOf(false) }
    val groupedDevices =
        remember(uiState.devices, uiState.selectedGroupId) {
            buildDeviceSections(uiState.devices, uiState.selectedGroupId)
        }
    val availableGroups =
        remember(uiState.devices) {
            uiState.devices
                .flatMap { device -> device.groups }
                .distinctBy(DeviceGroup::id)
                .sortedBy { group -> group.name.ifBlank { "未分组" } }
        }
    val selectedGroupName =
        remember(availableGroups, uiState.selectedGroupId) {
            if (uiState.selectedGroupId == 0) {
                "全部设备"
            } else {
                availableGroups.firstOrNull { it.id == uiState.selectedGroupId }?.name?.ifBlank { "未分组" } ?: "设备分组"
            }
        }

    LaunchedEffect(viewModel.effect) {
        viewModel.effect.collect { effect ->
            when (effect) {
                is DeviceListEffect.NavigateToRemote -> onOpenRemote(effect.device)
                is DeviceListEffect.NavigateToAppManager -> onOpenAppManager(effect.device)
                is DeviceListEffect.NavigateToFileManager -> onOpenFileManager(effect.device)
                is DeviceListEffect.NavigateToTerminal -> onOpenTerminal(effect.device)
            }
        }
    }

    Box(
        modifier = Modifier.fillMaxSize(),
    ) {
        Column(
            modifier = Modifier.fillMaxSize(),
        ) {
            if (contentState.errorMessage != null) {
                Surface(
                    color = MaterialTheme.colorScheme.errorContainer,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        text = contentState.errorMessage.orEmpty(),
                        color = MaterialTheme.colorScheme.onErrorContainer,
                        modifier = Modifier.padding(16.dp),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }

            if (contentState.loading && contentState.devices.isEmpty()) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            } else if (!contentState.loading && contentState.devices.isEmpty()) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(
                            "没有发现设备",
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            "请在网页端添加设备后刷新",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                        )
                    }
                }
            } else {
                Column(
                    modifier = Modifier.fillMaxSize(),
                ) {
                    DeviceListToolbar(
                        viewMode = uiState.viewMode,
                        selectedGroupName = selectedGroupName,
                        hasCustomGroup = uiState.selectedGroupId != 0,
                        onOpenGroupPicker = { isGroupPickerOpen = true },
                        onToggleViewMode = { viewModel.handleIntent(DeviceListIntent.ToggleViewMode) },
                    )
                    if (uiState.viewMode == DeviceListViewMode.PREVIEW) {
                        LazyVerticalGrid(
                            columns = GridCells.Adaptive(minSize = 172.dp),
                            modifier = Modifier.fillMaxSize(),
                            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 16.dp),
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            verticalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            groupedDevices.forEach { section ->
                                item(span = {
                                    androidx.compose.foundation.lazy.grid
                                        .GridItemSpan(maxLineSpan)
                                }) {
                                    SectionTitle(title = section.title)
                                }
                                gridItems(section.devices, key = { it.id }) { device ->
                                    DevicePreviewCard(
                                        viewModel = viewModel,
                                        device = device,
                                        onClick = { viewModel.handleIntent(DeviceListIntent.ConnectDevice(device)) },
                                        onMoreClick = { viewModel.handleIntent(DeviceListIntent.ShowDeviceMenu(device)) },
                                    )
                                }
                            }
                        }
                    } else {
                        LazyColumn(
                            modifier = Modifier.fillMaxSize(),
                            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 16.dp),
                            verticalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            groupedDevices.forEach { section ->
                                item(key = "section-${section.title}") {
                                    SectionTitle(title = section.title)
                                }
                                lazyItems(section.devices, key = { it.id }) { device ->
                                    DeviceCard(
                                        device = device,
                                        onClick = { viewModel.handleIntent(DeviceListIntent.ShowDeviceMenu(device)) },
                                        onMoreClick = { viewModel.handleIntent(DeviceListIntent.ShowDeviceMenu(device)) },
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }

        dialogState.selectedDevice?.takeIf { dialogState.isDeviceMenuOpen }?.let { device ->
            AyDialog(
                title = "设备操作",
                onDismissRequest = { viewModel.handleIntent(DeviceListIntent.HideDeviceMenu) },
                content = {
                    Text(
                        text = device.name.ifBlank { "未知设备" },
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Spacer(modifier = Modifier.height(24.dp))

                    Column(
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Button(
                            onClick = { viewModel.handleIntent(DeviceListIntent.ConnectDevice(device)) },
                            modifier = Modifier.fillMaxWidth(),
                            enabled = !dialogState.loading,
                        ) {
                            Text("远程投屏")
                        }
                        OutlinedButton(
                            onClick = { viewModel.handleIntent(DeviceListIntent.NavigateToFileManager(device)) },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text("文件管理")
                        }
                        OutlinedButton(
                            onClick = { viewModel.handleIntent(DeviceListIntent.NavigateToAppManager(device)) },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text("应用管理")
                        }
                        OutlinedButton(
                            onClick = { viewModel.handleIntent(DeviceListIntent.NavigateToTerminal(device)) },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text("终端")
                        }
                    }
                },
                footer = {
                    Button(
                        onClick = { viewModel.handleIntent(DeviceListIntent.HideDeviceMenu) },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text("取消")
                    }
                },
            )
        }

        if (isGroupPickerOpen) {
            AyDialog(
                title = "选择分组",
                onDismissRequest = { isGroupPickerOpen = false },
                content = {
                    Column(
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        OutlinedButton(
                            onClick = {
                                viewModel.handleIntent(DeviceListIntent.SelectGroup(0))
                                isGroupPickerOpen = false
                            },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text("全部设备")
                        }
                        availableGroups.forEach { group ->
                            OutlinedButton(
                                onClick = {
                                    viewModel.handleIntent(DeviceListIntent.SelectGroup(group.id))
                                    isGroupPickerOpen = false
                                },
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Text(group.name.ifBlank { "未分组" })
                            }
                        }
                    }
                },
                footer = {
                    OutlinedButton(
                        onClick = { isGroupPickerOpen = false },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text("取消")
                    }
                },
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DeviceCard(
    device: Device,
    onClick: () -> Unit,
    onMoreClick: () -> Unit,
) {
    val isOnline = device.status.equals("online", ignoreCase = true)

    Card(
        onClick = onClick,
        colors =
            CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
            ),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = device.name.ifBlank { "未知设备" },
                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold),
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = device.serial,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            Spacer(modifier = Modifier.width(12.dp))

            Column(horizontalAlignment = Alignment.End) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = if (isOnline) Icons.Default.CheckCircle else Icons.Default.Warning,
                        contentDescription = if (isOnline) "在线" else "离线",
                        tint = if (isOnline) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
                        modifier = Modifier.size(16.dp),
                    )
                    Spacer(modifier = Modifier.width(4.dp))
                    Text(
                        text = if (isOnline) "在线" else "离线",
                        style = MaterialTheme.typography.labelMedium,
                        color = if (isOnline) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
                    )
                }
                Spacer(modifier = Modifier.height(4.dp))
                IconButton(
                    onClick = onMoreClick,
                    modifier = Modifier.size(24.dp),
                ) {
                    Icon(
                        imageVector = Icons.Default.MoreVert,
                        contentDescription = "更多操作",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

@Composable
private fun DeviceListToolbar(
    viewMode: DeviceListViewMode,
    selectedGroupName: String,
    hasCustomGroup: Boolean,
    onOpenGroupPicker: () -> Unit,
    onToggleViewMode: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        CompactToolbarButton(
            text = selectedGroupName,
            leadingIcon = if (hasCustomGroup) Icons.Default.CheckCircle else Icons.Default.ArrowDropDown,
            trailingIcon = Icons.Default.ArrowDropDown,
            modifier = Modifier.weight(1f),
            onClick = onOpenGroupPicker,
        )
        CompactToolbarButton(
            text = if (viewMode == DeviceListViewMode.PREVIEW) "列表" else "预览",
            leadingIcon = Icons.AutoMirrored.Filled.List,
            modifier = Modifier.weight(1f),
            onClick = onToggleViewMode,
        )
    }
}

@Composable
private fun CompactToolbarButton(
    text: String,
    leadingIcon: androidx.compose.ui.graphics.vector.ImageVector,
    modifier: Modifier = Modifier,
    trailingIcon: androidx.compose.ui.graphics.vector.ImageVector? = null,
    onClick: () -> Unit,
) {
    OutlinedButton(
        onClick = onClick,
        modifier = modifier.height(40.dp),
        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 0.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
        ) {
            Icon(
                imageVector = leadingIcon,
                contentDescription = null,
                modifier = Modifier.size(18.dp),
            )
            Spacer(modifier = Modifier.width(6.dp))
            Text(
                text = text,
                maxLines = 1,
                style = MaterialTheme.typography.labelLarge,
            )
            if (trailingIcon != null) {
                Spacer(modifier = Modifier.width(4.dp))
                Icon(
                    imageVector = trailingIcon,
                    contentDescription = null,
                    modifier = Modifier.size(18.dp),
                )
            }
        }
    }
}

@Composable
private fun DevicePreviewCard(
    viewModel: DeviceListViewModel,
    device: Device,
    onClick: () -> Unit,
    onMoreClick: () -> Unit,
) {
    val previewBitmap by produceState<androidx.compose.ui.graphics.ImageBitmap?>(initialValue = null, key1 = device.id) {
        value =
            runCatching {
                val bytes = viewModel.loadDevicePreview(device.id)
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
            }.getOrNull()
    }
    val isOnline = device.status.equals("online", ignoreCase = true)

    Card(
        onClick = onClick,
        colors =
            CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
            ),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Box(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .aspectRatio(9f / 16f)
                    .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.35f)),
        ) {
            if (previewBitmap != null) {
                Image(
                    bitmap = previewBitmap!!,
                    contentDescription = device.name.ifBlank { "设备预览" },
                    modifier = Modifier.fillMaxSize(),
                    contentScale = ContentScale.Crop,
                )
            } else {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator(modifier = Modifier.size(28.dp))
                }
            }

            IconButton(
                onClick = onMoreClick,
                modifier =
                    Modifier
                        .align(Alignment.TopEnd)
                        .padding(8.dp)
                        .size(28.dp),
            ) {
                Icon(
                    imageVector = Icons.Default.MoreVert,
                    contentDescription = "更多操作",
                    tint = MaterialTheme.colorScheme.onSurface,
                )
            }
        }

        Column(
            modifier = Modifier.padding(12.dp),
        ) {
            Text(
                text = device.name.ifBlank { "未知设备" },
                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold),
                color = MaterialTheme.colorScheme.onSurface,
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = device.serial,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(modifier = Modifier.height(8.dp))
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Icon(
                    imageVector = if (isOnline) Icons.Default.CheckCircle else Icons.Default.Warning,
                    contentDescription = if (isOnline) "在线" else "离线",
                    tint = if (isOnline) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
                    modifier = Modifier.size(16.dp),
                )
                Text(
                    text = if (isOnline) "在线" else "离线",
                    style = MaterialTheme.typography.labelMedium,
                    color = if (isOnline) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
                )
            }
        }
    }
}

@Composable
private fun SectionTitle(title: String) {
    Text(
        text = title,
        style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(top = 4.dp, bottom = 4.dp),
    )
}

private data class DeviceSection(
    val title: String,
    val devices: List<Device>,
)

private fun buildDeviceSections(
    devices: List<Device>,
    selectedGroupId: Int,
): List<DeviceSection> {
    if (selectedGroupId != 0) {
        val selectedDevices = devices.filter { device -> device.groups.any { it.id == selectedGroupId } }
        val title =
            selectedDevices
                .firstOrNull()
                ?.groups
                ?.firstOrNull { it.id == selectedGroupId }
                ?.name
                ?.ifBlank { "未分组" }
                ?: "设备分组"
        return listOf(DeviceSection(title = title, devices = selectedDevices))
    }

    val grouped = linkedMapOf<String, MutableList<Device>>()
    devices.forEach { device ->
        val groupNames = device.groups.map { it.name.ifBlank { "未分组" } }.ifEmpty { listOf("未分组") }
        groupNames.forEach { name ->
            grouped.getOrPut(name) { mutableListOf() }.add(device)
        }
    }
    return grouped.map { (title, sectionDevices) ->
        DeviceSection(title = title, devices = sectionDevices.distinctBy(Device::id))
    }
}
