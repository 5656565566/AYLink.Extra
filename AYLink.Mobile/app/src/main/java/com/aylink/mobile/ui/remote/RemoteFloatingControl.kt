package com.aylink.mobile.ui.remote

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.animateOffsetAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.updateTransition
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.absoluteOffset
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.VolumeOff
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Apps
import androidx.compose.material.icons.filled.BrightnessHigh
import androidx.compose.material.icons.filled.BugReport
import androidx.compose.material.icons.filled.Cast
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Fullscreen
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.LinkOff
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Monitor
import androidx.compose.material.icons.filled.NightsStay
import androidx.compose.material.icons.filled.PowerSettingsNew
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material.icons.filled.SmartButton
import androidx.compose.material.icons.filled.Smartphone
import androidx.compose.material.icons.filled.ViewCarousel
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.aylink.mobile.data.model.Device
import com.aylink.mobile.data.model.DeviceApp
import kotlinx.coroutines.delay
import kotlin.math.min

private const val CONTROL_ANIMATION_DURATION_MS = 200
private const val CONTROL_BUTTON_STAGGER_MS = 40
private const val CONTROL_IDLE_DELAY_MS = 5_000L
private const val CONTROL_IDLE_ALPHA = 0.35f
private const val CONTROL_FADE_DURATION_MS = 300

private enum class ControlCategory(
    val label: String,
    val icon: ImageVector,
) {
    Navigation("导航", Icons.Default.SmartButton),
    Volume("音量", Icons.AutoMirrored.Filled.VolumeUp),
    Screen("画面", Icons.Default.Monitor),
    Cast("投屏", Icons.Default.Cast),
    Device("设备", Icons.Default.Smartphone),
}

private data class ControlAction(
    val label: String,
    val icon: ImageVector,
    val onClick: () -> Unit,
    val selected: Boolean = false,
    val dangerous: Boolean = false,
    val description: String = label,
)

@Composable
internal fun RemoteFloatingControl(
    device: Device,
    viewportSize: IntSize,
    controlState: RemoteControlUiState,
    appPickerState: RemoteAppPickerUiState,
    onSendKey: (String) -> Unit,
    onSetFillMode: (Boolean) -> Unit,
    onReconnectToDevice: () -> Unit,
    onOpenAppPicker: () -> Unit,
    onReconnectToApp: (DeviceApp) -> Unit,
    onToggleControlMenu: (Boolean) -> Unit,
    onToggleDebugOverlay: () -> Unit,
    onDismissAppPicker: () -> Unit,
    onDisconnect: () -> Unit,
) {
    val density = LocalDensity.current
    val viewport = Size(viewportSize.width / density.density, viewportSize.height / density.density)
    var selectedCategory by remember(device.id) { mutableStateOf<ControlCategory?>(null) }
    var showCategories by remember(device.id) { mutableStateOf(true) }
    var confirmingDisconnect by remember(device.id) { mutableStateOf(false) }
    var dockedRight by rememberSaveable(device.id) { mutableStateOf(true) }
    var verticalFraction by rememberSaveable(device.id) { mutableFloatStateOf(0.5f) }
    var dragAnchor by remember(device.id, viewportSize) { mutableStateOf<Offset?>(null) }
    val menuOpen = controlState.isControlMenuOpen && !appPickerState.isAppSelectDialogOpen
    val anchorInteractions = remember(device.id) { MutableInteractionSource() }
    val anchorPressed by anchorInteractions.collectIsPressedAsState()
    val dragging = dragAnchor != null
    var idle by remember(device.id) { mutableStateOf(false) }
    // 仅悬浮控件自身的交互重置计时，远端画面更新和触控不参与。
    LaunchedEffect(device.id, menuOpen, appPickerState.isAppSelectDialogOpen, anchorPressed, dragging) {
        idle = false
        if (!menuOpen && !appPickerState.isAppSelectDialogOpen && !anchorPressed && !dragging) {
            delay(CONTROL_IDLE_DELAY_MS)
            idle = true
        }
    }
    val faded = idle && !menuOpen && !appPickerState.isAppSelectDialogOpen && !anchorPressed && !dragging
    val anchorAlpha by animateFloatAsState(
        targetValue = if (faded) CONTROL_IDLE_ALPHA else 1f,
        animationSpec = if (faded) tween(CONTROL_FADE_DURATION_MS, easing = FastOutSlowInEasing) else snap(),
        label = "controlIdleAlpha",
    )
    val expandedAnchor = remember(viewport, dockedRight, verticalFraction) { remoteControlAnchor(viewport, dockedRight, verticalFraction) }
    val targetAnchor = remoteControlAnchor(viewport, dockedRight, verticalFraction, collapsed = !menuOpen)
    val animatedAnchor =
        key(viewportSize) {
            animateOffsetAsState(
                targetValue = dragAnchor ?: targetAnchor,
                animationSpec = if (dragging) snap() else tween(CONTROL_ANIMATION_DURATION_MS, easing = FastOutSlowInEasing),
                label = "controlAnchor",
            )
        }
    // 动画坐标只在绘制和手势回调中读取，避免逐帧触发整个面板重组。
    val latestAnchor by rememberUpdatedState(newValue = { dragAnchor ?: animatedAnchor.value })
    val menuTransition = updateTransition(menuOpen, label = "controlMenu")
    val menuProgress by menuTransition.animateFloat(
        transitionSpec = { tween(CONTROL_ANIMATION_DURATION_MS, easing = FastOutSlowInEasing) },
        label = "controlIconPosition",
    ) { if (it) 1f else 0f }

    fun closeMenu() {
        onToggleControlMenu(false)
    }

    fun finishDrag() {
        dragAnchor?.let {
            dockedRight = it.x >= viewport.width / 2
            verticalFraction = (it.y / viewport.height).coerceIn(0f, 1f)
        }
        dragAnchor = null
    }

    BackHandler(enabled = menuOpen) {
        when {
            confirmingDisconnect -> confirmingDisconnect = false
            !showCategories && selectedCategory != null -> showCategories = true
            else -> closeMenu()
        }
    }

    val backToCategories =
        ControlAction("上级", Icons.Default.KeyboardArrowUp, { showCategories = true }, description = "返回分类")
    val category = selectedCategory
    val actions =
        when {
            confirmingDisconnect ->
                listOf(
                    ControlAction("确认", Icons.Default.Check, {
                        closeMenu()
                        onDisconnect()
                    }, dangerous = true, description = "确认断开"),
                    ControlAction("取消", Icons.Default.Close, { confirmingDisconnect = false }),
                )
            showCategories || category == null ->
                ControlCategory.entries.map { entry ->
                    ControlAction(entry.label, entry.icon, {
                        selectedCategory = entry
                        showCategories = false
                    }, selected = category == entry)
                }
            else ->
                when (category) {
                    ControlCategory.Navigation ->
                        listOf(
                            backToCategories,
                            ControlAction("返回", Icons.AutoMirrored.Filled.ArrowBack, { onSendKey("back") }, description = "远端返回"),
                            ControlAction("主页", Icons.Default.Home, { onSendKey("home") }),
                            ControlAction("任务", Icons.Default.ViewCarousel, { onSendKey("recent") }),
                            ControlAction("菜单", Icons.Default.Menu, { onSendKey("menu") }),
                        )
                    ControlCategory.Volume ->
                        listOf(
                            backToCategories,
                            ControlAction("增大", Icons.Default.Add, { onSendKey("volumeup") }, description = "增大音量"),
                            ControlAction("静音", Icons.AutoMirrored.Filled.VolumeOff, { onSendKey("mute") }),
                            ControlAction("减小", Icons.Default.Remove, { onSendKey("volumedown") }, description = "减小音量"),
                        )
                    ControlCategory.Screen ->
                        listOf(
                            backToCategories,
                            ControlAction("亮屏", Icons.Default.BrightnessHigh, { onSendKey("screenon") }),
                            ControlAction("息屏", Icons.Default.NightsStay, { onSendKey("screenoff") }),
                            ControlAction(
                                "填满",
                                Icons.Default.Fullscreen,
                                { onSetFillMode(!controlState.fillMode) },
                                selected = controlState.fillMode,
                                description = "拉伸填满",
                            ),
                        )
                    ControlCategory.Cast ->
                        listOf(
                            backToCategories,
                            ControlAction("整机", Icons.Default.Smartphone, {
                                closeMenu()
                                onReconnectToDevice()
                            }, description = "整机投屏"),
                            ControlAction("应用", Icons.Default.Apps, {
                                onToggleControlMenu(false)
                                onOpenAppPicker()
                            }, description = "应用投屏"),
                        )
                    ControlCategory.Device ->
                        buildList {
                            add(backToCategories)
                            add(ControlAction("电源", Icons.Default.PowerSettingsNew, { onSendKey("power") }))
                            if (controlState.isDebugModeEnabled) {
                                add(
                                    ControlAction(
                                        "调试",
                                        Icons.Default.BugReport,
                                        onToggleDebugOverlay,
                                        selected = controlState.isDebugOverlayVisible,
                                        description = "调试信息",
                                    ),
                                )
                            }
                            add(
                                ControlAction(
                                    "断开",
                                    Icons.Default.LinkOff,
                                    { confirmingDisconnect = true },
                                    dangerous = true,
                                    description = "断开连接",
                                ),
                            )
                        }
                }
        }

    if (viewport.width > 0 && viewport.height > 0) {
        val positions =
            remember(viewport, expandedAnchor, dockedRight, actions.size) {
                remoteControlOffsets(viewport, expandedAnchor, dockedRight, actions.size)
            }
        // 仅圆钮接收触控，空白区域继续交给远端画面。
        Box(modifier = Modifier.fillMaxSize().clipToBounds()) {
            if ((menuTransition.currentState || menuTransition.targetState) && dragAnchor == null) {
                actions.forEachIndexed { index, action ->
                    val progress by menuTransition.animateFloat(
                        transitionSpec = {
                            tween(
                                durationMillis = CONTROL_ANIMATION_DURATION_MS,
                                delayMillis = (if (targetState) index else actions.lastIndex - index) * CONTROL_BUTTON_STAGGER_MS,
                                easing = FastOutSlowInEasing,
                            )
                        },
                        label = "controlButton$index",
                    ) { if (it) 1f else 0f }
                    RemoteControlButton(
                        action = action,
                        enabled = menuOpen && menuTransition.currentState,
                        modifier =
                            Modifier
                                .absoluteOffset(
                                    (positions[index].x - REMOTE_CONTROL_BUTTON_SIZE / 2).dp,
                                    (positions[index].y - REMOTE_CONTROL_BUTTON_SIZE / 2).dp,
                                ).graphicsLayer {
                                    val position = latestAnchor() + (positions[index] - expandedAnchor) * progress
                                    translationX = (position.x - positions[index].x) * density.density
                                    translationY = (position.y - positions[index].y) * density.density
                                    alpha = progress
                                },
                    )
                }
            }

            Surface(
                onClick = {
                    if (menuOpen) {
                        closeMenu()
                    } else {
                        showCategories = selectedCategory == null
                        confirmingDisconnect = false
                        onToggleControlMenu(true)
                    }
                },
                modifier =
                    Modifier
                        .absoluteOffset(
                            (targetAnchor.x - REMOTE_CONTROL_ANCHOR_SIZE / 2).dp,
                            (targetAnchor.y - REMOTE_CONTROL_ANCHOR_SIZE / 2).dp,
                        ).size(REMOTE_CONTROL_ANCHOR_SIZE.dp)
                        .graphicsLayer {
                            val position = latestAnchor()
                            translationX = (position.x - targetAnchor.x) * density.density
                            translationY = (position.y - targetAnchor.y) * density.density
                            alpha = anchorAlpha
                        }.pointerInput(device.id, viewportSize, density.density) {
                            detectDragGestures(
                                onDragStart = { dragAnchor = latestAnchor() },
                                onDragEnd = { finishDrag() },
                                onDragCancel = { finishDrag() },
                            ) { change, amount ->
                                change.consume()
                                val next = (dragAnchor ?: latestAnchor()) + amount / density.density
                                val marginX = min(REMOTE_CONTROL_CLEARANCE, viewport.width / 2)
                                val marginY = min(REMOTE_CONTROL_CLEARANCE, viewport.height / 2)
                                dragAnchor =
                                    Offset(
                                        next.x.coerceIn(marginX, viewport.width - marginX),
                                        next.y.coerceIn(marginY, viewport.height - marginY),
                                    )
                            }
                        }.semantics {
                            contentDescription = "${if (menuOpen) "收起" else "展开"}投屏控制，可拖动。${device.name}，${controlState.status}"
                        },
                shape = CircleShape,
                color = MaterialTheme.colorScheme.primaryContainer,
                contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                shadowElevation = 4.dp,
                interactionSource = anchorInteractions,
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        imageVector =
                            when {
                                menuOpen -> Icons.Default.Close
                                dockedRight -> Icons.AutoMirrored.Filled.KeyboardArrowLeft
                                else -> Icons.AutoMirrored.Filled.KeyboardArrowRight
                            },
                        contentDescription = null,
                        modifier =
                            Modifier
                                .size(22.dp)
                                .graphicsLayer {
                                    val inset = REMOTE_CONTROL_ANCHOR_SIZE / 4 * density.density
                                    translationX = if (dragging) 0f else (if (dockedRight) -inset else inset) * (1f - menuProgress)
                                }.testTag("remoteControlIcon"),
                    )
                }
            }
        }
    }

    RemoteAppPickerDialog(
        state = appPickerState,
        onDismiss = {
            onDismissAppPicker()
            showCategories = selectedCategory == null
            confirmingDisconnect = false
            onToggleControlMenu(true)
        },
        onRetry = onOpenAppPicker,
        onSelect = {
            closeMenu()
            onReconnectToApp(it)
        },
    )
}

@Composable
private fun RemoteControlButton(
    action: ControlAction,
    enabled: Boolean,
    modifier: Modifier = Modifier,
) {
    Surface(
        onClick = action.onClick,
        enabled = enabled,
        modifier =
            modifier.size(REMOTE_CONTROL_BUTTON_SIZE.dp).semantics {
                contentDescription = action.description
                selected = action.selected
            },
        shape = CircleShape,
        color = if (action.selected) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surfaceContainerHigh,
        contentColor =
            when {
                action.dangerous -> MaterialTheme.colorScheme.error
                action.selected -> MaterialTheme.colorScheme.onSecondaryContainer
                else -> MaterialTheme.colorScheme.onSurface
            },
        shadowElevation = 3.dp,
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 2.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Icon(action.icon, contentDescription = null, modifier = Modifier.size(19.dp))
            Text(
                action.label,
                style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp, lineHeight = 14.sp),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun RemoteAppPickerDialog(
    state: RemoteAppPickerUiState,
    onDismiss: () -> Unit,
    onRetry: () -> Unit,
    onSelect: (DeviceApp) -> Unit,
) {
    if (!state.isAppSelectDialogOpen) return

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(modifier = Modifier.padding(horizontal = 20.dp, vertical = 14.dp), contentAlignment = Alignment.Center) {
            Surface(
                modifier = Modifier.widthIn(max = 400.dp).fillMaxWidth(),
                shape = RoundedCornerShape(20.dp),
                tonalElevation = 4.dp,
            ) {
                Column {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp, top = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text("选择投屏应用", modifier = Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
                        IconButton(onClick = onDismiss) { Icon(Icons.Default.Close, contentDescription = "关闭应用选择") }
                    }
                    Box(modifier = Modifier.fillMaxWidth().weight(1f, fill = false)) {
                        when {
                            state.isLoadingApps ->
                                Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
                                    CircularProgressIndicator()
                                }
                            state.appError != null ->
                                Column(
                                    modifier = Modifier.fillMaxWidth().padding(16.dp),
                                    horizontalAlignment = Alignment.CenterHorizontally,
                                ) {
                                    Text(state.appError, color = MaterialTheme.colorScheme.error)
                                    TextButton(onClick = onRetry) { Text("重试") }
                                }
                            state.availableApps.isEmpty() ->
                                Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
                                    Text("未找到应用", color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                            else ->
                                LazyColumn {
                                    items(state.availableApps) { app ->
                                        Surface(onClick = { onSelect(app) }) {
                                            Row(
                                                modifier = Modifier.fillMaxWidth().padding(horizontal = 22.dp, vertical = 10.dp),
                                                verticalAlignment = Alignment.CenterVertically,
                                                horizontalArrangement = Arrangement.spacedBy(14.dp),
                                            ) {
                                                Icon(
                                                    Icons.Default.Apps,
                                                    contentDescription = null,
                                                    tint = MaterialTheme.colorScheme.primary,
                                                )
                                                Column {
                                                    Text(app.name, style = MaterialTheme.typography.bodyLarge)
                                                    Text(
                                                        app.packageName,
                                                        style = MaterialTheme.typography.bodySmall,
                                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                                    )
                                                }
                                            }
                                        }
                                    }
                                }
                        }
                    }
                    HorizontalDivider()
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
                        horizontalArrangement = Arrangement.End,
                    ) {
                        TextButton(onClick = onDismiss) { Text("取消") }
                    }
                }
            }
        }
    }
}
