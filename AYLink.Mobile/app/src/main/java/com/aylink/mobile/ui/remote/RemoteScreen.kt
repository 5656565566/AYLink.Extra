package com.aylink.mobile.ui.remote

import android.content.pm.ActivityInfo
import android.view.WindowManager
import androidx.activity.compose.BackHandler
import androidx.activity.compose.LocalActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.*
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.changedToUp
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import com.aylink.mobile.data.model.Device
import com.aylink.mobile.data.model.DeviceApp
import com.aylink.mobile.data.model.PointerControlMessage
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.webrtc.RendererCommon
import org.webrtc.SurfaceViewRenderer
import kotlin.math.abs
import kotlin.math.roundToInt
import android.graphics.Rect as AndroidRect

private const val ORIENTATION_CHANGE_DEBOUNCE_MS = 450L
private const val ORIENTATION_ASPECT_DEAD_ZONE = 0.08f
private const val ORIENTATION_OCCUPANCY_THRESHOLD = 0.48f

@Composable
fun AyDialog(
    title: String,
    onDismissRequest: () -> Unit,
    content: @Composable ColumnScope.() -> Unit,
    footer: @Composable RowScope.() -> Unit
) {
    Dialog(
        onDismissRequest = onDismissRequest,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Surface(
            shape = RoundedCornerShape(8.dp),
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 4.dp,
            modifier = Modifier
                .padding(24.dp)
                .widthIn(max = 400.dp)
                .fillMaxWidth()
        ) {
            Column {
                Box(
                    modifier = Modifier.padding(start = 24.dp, top = 16.dp, end = 24.dp, bottom = 16.dp)
                ) {
                    Text(
                        text = title,
                        style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.SemiBold)
                    )
                }
                
                Column(
                    modifier = Modifier
                        .padding(horizontal = 24.dp)
                        .heightIn(max = 420.dp)
                        .padding(bottom = 24.dp)
                        .weight(1f, fill = false)
                        .verticalScroll(rememberScrollState())
                ) {
                    content()
                }
                
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f))
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 24.dp, vertical = 16.dp),
                        horizontalArrangement = Arrangement.spacedBy(16.dp)
                    ) {
                        footer()
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class, ExperimentalMaterial3Api::class)
@Composable
fun RemoteScreen(
    device: Device,
    viewModel: RemoteViewModel,
    onBack: () -> Unit
) {
    val viewportState by viewModel.viewportUiState.collectAsStateWithLifecycle()
    val controlState by viewModel.controlUiState.collectAsStateWithLifecycle()
    val appPickerState by viewModel.appPickerUiState.collectAsStateWithLifecycle()
    val effectiveFillMode = viewportState.fillMode
    val activity = LocalActivity.current
    val localView = LocalView.current
    val lifecycleOwner = androidx.lifecycle.compose.LocalLifecycleOwner.current
    var viewportSize by remember { mutableStateOf(IntSize.Zero) }
    var viewportBoundsInWindow by remember { mutableStateOf<Rect?>(null) }
    var rendererRef by remember { mutableStateOf<SurfaceViewRenderer?>(null) }
    val visibleViewportSize = remember(localView, viewportSize, viewportBoundsInWindow) {
        calculateVisibleViewportSize(localView, viewportSize, viewportBoundsInWindow)
    }
    val videoBounds = remember(viewportSize, viewportState.videoSize) {
        calculateVideoBounds(viewportSize, viewportState.videoSize, fillMode = false)
    }
    val videoOccupancyRatio = remember(viewportSize, videoBounds) {
        val viewportArea = viewportSize.width.toFloat() * viewportSize.height.toFloat()
        if (viewportArea <= 0f) {
            1f
        } else {
            (videoBounds.width * videoBounds.height / viewportArea).coerceIn(0f, 1f)
        }
    }
    val desiredScreenOrientation = remember(visibleViewportSize, viewportState.videoSize, videoOccupancyRatio) {
        if (!viewportState.isAppProjectionMode && !viewportState.isNewDisplayMode) {
            resolveNormalCastScreenOrientation(videoSize = viewportState.videoSize)
        } else if (viewportState.isAppProjectionMode && viewportState.isNewDisplayMode) {
            resolveDesiredScreenOrientation(
                viewportSize = visibleViewportSize,
                videoSize = viewportState.videoSize,
                occupancyRatio = videoOccupancyRatio
            )
        } else {
            null
        }
    }
    BackHandler {
        viewModel.handleIntent(RemoteIntent.DisconnectAndNavigateBack)
    }

    LaunchedEffect(viewModel.effect) {
        viewModel.effect.collect { effect ->
            when (effect) {
                RemoteEffect.NavigateBack -> onBack()
            }
        }
    }

    LaunchedEffect(visibleViewportSize) {
        viewModel.onViewportSizeChanged(visibleViewportSize)
    }

    LaunchedEffect(activity, desiredScreenOrientation) {
        delay(ORIENTATION_CHANGE_DEBOUNCE_MS)
        val targetOrientation = desiredScreenOrientation ?: ActivityInfo.SCREEN_ORIENTATION_LOCKED
        if (activity?.requestedOrientation != targetOrientation) {
            activity?.requestedOrientation = targetOrientation
        }
    }

    DisposableEffect(activity, lifecycleOwner) {
        val previousOrientation = activity?.requestedOrientation
        val hadKeepScreenOn = activity?.window
            ?.attributes
            ?.flags
            ?.and(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) != 0
        val observer = object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                viewModel.onAppForegrounded()
            }

            override fun onStop(owner: LifecycleOwner) {
                viewModel.onAppBackgrounded()
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        
        activity?.window?.let { window ->
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            val insetsController = WindowCompat.getInsetsController(window, window.decorView)
            insetsController.hide(WindowInsetsCompat.Type.systemBars())
            insetsController.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            activity?.window?.let { window ->
                val insetsController = WindowCompat.getInsetsController(window, window.decorView)
                insetsController.show(WindowInsetsCompat.Type.systemBars())
                if (!hadKeepScreenOn) {
                    window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                }
            }
            activity?.requestedOrientation = previousOrientation ?: ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            rendererRef?.let(viewModel.webRtcManager::releaseRenderer)
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal + WindowInsetsSides.Top + WindowInsetsSides.Bottom))
            .onGloballyPositioned { coordinates ->
                val position = coordinates.positionInWindow()
                val size = coordinates.size
                viewportBoundsInWindow = Rect(
                    left = position.x,
                    top = position.y,
                    right = position.x + size.width,
                    bottom = position.y + size.height
                )
            }
            .background(Color.Black)
    ) {
        RemoteVideoSurface(
            viewportSize = viewportSize,
            viewportState = viewportState,
            effectiveFillMode = effectiveFillMode,
            videoBounds = videoBounds,
            onViewportSizeChanged = { viewportSize = it },
            onRendererReady = { rendererRef = it },
            viewModel = viewModel
        )

        RemoteFloatingControl(
            device = device,
            viewportSize = viewportSize,
            controlState = controlState,
            appPickerState = appPickerState,
            onSendKey = { viewModel.handleIntent(RemoteIntent.SendKey(it)) },
            onSetFillMode = { viewModel.handleIntent(RemoteIntent.SetFillMode(it)) },
            onReconnectToDevice = { viewModel.handleIntent(RemoteIntent.ReconnectToDevice) },
            onOpenAppPicker = {
                viewModel.handleIntent(RemoteIntent.LoadApps)
                viewModel.handleIntent(RemoteIntent.SetAppSelectDialogOpen(true))
            },
            onReconnectToApp = { viewModel.handleIntent(RemoteIntent.ReconnectToApp(it)) },
            onToggleControlDialog = { viewModel.handleIntent(RemoteIntent.SetControlDialogOpen(it)) },
            onToggleControlPanelCollapsed = { viewModel.handleIntent(RemoteIntent.SetControlPanelCollapsed(it)) },
            onDismissAppPicker = { viewModel.handleIntent(RemoteIntent.SetAppSelectDialogOpen(false)) },
            onDisconnect = { viewModel.handleIntent(RemoteIntent.DisconnectAndNavigateBack) }
        )
    }
}

@Composable
private fun RemoteVideoSurface(
    viewportSize: IntSize,
    viewportState: RemoteViewportUiState,
    effectiveFillMode: Boolean,
    videoBounds: VideoBounds,
    onViewportSizeChanged: (IntSize) -> Unit,
    onRendererReady: (SurfaceViewRenderer) -> Unit,
    viewModel: RemoteViewModel
) {
    val density = LocalDensity.current
    val stretchScaleX = remember(viewportSize, videoBounds, effectiveFillMode) {
        if (!effectiveFillMode || videoBounds.width <= 0f) {
            1f
        } else {
            viewportSize.width.toFloat().coerceAtLeast(1f) / videoBounds.width
        }
    }
    val stretchScaleY = remember(viewportSize, videoBounds, effectiveFillMode) {
        if (!effectiveFillMode || videoBounds.height <= 0f) {
            1f
        } else {
            viewportSize.height.toFloat().coerceAtLeast(1f) / videoBounds.height
        }
    }
    val touchPointerState = remember { RemoteTouchPointerState() }
    val latestPointerDispatch by rememberUpdatedState(
        newValue = { event: RemoteTouchPointerEvent ->
            sendPointer(
                viewModel = viewModel,
                event = event,
                viewportSize = viewportSize,
                videoSize = viewportState.videoSize,
                fillMode = effectiveFillMode,
                videoBounds = videoBounds
            )
        }
    )

    DisposableEffect(touchPointerState, viewModel) {
        onDispose {
            touchPointerState.cancelActivePointers(latestPointerDispatch)
            touchPointerState.clear()
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .clipToBounds()
            .onSizeChanged(onViewportSizeChanged),
        contentAlignment = Alignment.Center
    ) {
        AndroidView(
            factory = {
                SurfaceViewRenderer(it).apply {
                    onRendererReady(this)
                    setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FIT)
                    viewModel.webRtcManager.initializeRenderer(this)
                    viewModel.webRtcManager.bindRemoteVideo(this)
                }
            },
            modifier = Modifier
                .then(
                    if (viewportState.videoSize == IntSize.Zero) {
                        Modifier.fillMaxSize()
                    } else {
                        Modifier.size(
                            width = with(density) { videoBounds.width.toDp() },
                            height = with(density) { videoBounds.height.toDp() }
                        )
                    }
                )
                .graphicsLayer {
                    scaleX = stretchScaleX
                    scaleY = stretchScaleY
                }
                .clipToBounds(),
            update = { renderer ->
                renderer.setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FIT)
            }
        )

        Box(
            modifier = Modifier
                .fillMaxSize()
                .pointerInput(touchPointerState) {
                    awaitEachGesture {
                        val emitPointer: (RemoteTouchPointerEvent) -> Unit = { event ->
                            latestPointerDispatch(event)
                        }
                        try {
                            val down = awaitFirstDown(requireUnconsumed = false)
                            touchPointerState.beginGesture(down.id.value, down.position, emitPointer)

                            do {
                                val event = awaitPointerEvent(pass = PointerEventPass.Main)
                                event.changes.forEach { change ->
                                    if (!change.previousPressed && change.pressed) {
                                        touchPointerState.pointerDown(change.id.value, change.position, emitPointer)
                                    } else if (change.changedToUp()) {
                                        touchPointerState.pointerUp(change.id.value, change.position, emitPointer)
                                    } else if (change.pressed) {
                                        touchPointerState.pointerMove(change.id.value, change.position, emitPointer)
                                    }
                                }
                            } while (event.changes.any { it.pressed })
                        } finally {
                            touchPointerState.cancelActivePointers(emitPointer)
                        }
                    }
                }
        )
    }
}

@OptIn(ExperimentalLayoutApi::class, ExperimentalMaterial3Api::class)
@Composable
private fun RemoteFloatingControl(
    device: Device,
    viewportSize: IntSize,
    controlState: RemoteControlUiState,
    appPickerState: RemoteAppPickerUiState,
    onSendKey: (String) -> Unit,
    onSetFillMode: (Boolean) -> Unit,
    onReconnectToDevice: () -> Unit,
    onOpenAppPicker: () -> Unit,
    onReconnectToApp: (DeviceApp) -> Unit,
    onToggleControlDialog: (Boolean) -> Unit,
    onToggleControlPanelCollapsed: (Boolean) -> Unit,
    onDismissAppPicker: () -> Unit,
    onDisconnect: () -> Unit
) {
    val density = LocalDensity.current
    val scope = rememberCoroutineScope()
    val fabSize = 56.dp
    val fabSizePx = with(density) { fabSize.toPx() }
    val fabMarginPx = with(density) { 16.dp.toPx() }
    val collapsedPeekPx = with(density) { 20.dp.toPx() }
    var fabOffset by remember { mutableStateOf(Offset(0f, 0f)) }
    var isFabInitialized by remember { mutableStateOf(false) }
    var isFabDockedRight by remember { mutableStateOf(true) }
    var previousViewportSize by remember { mutableStateOf(IntSize.Zero) }
    val fabAlpha by animateFloatAsState(
        targetValue = if (controlState.isControlPanelCollapsed) 0.72f else 0.9f,
        label = "fabAlpha"
    )

    fun expandedBounds(size: IntSize): Pair<Float, Float> {
        val maxX = (size.width - fabSizePx - fabMarginPx).coerceAtLeast(fabMarginPx)
        val maxY = (size.height - fabSizePx - fabMarginPx).coerceAtLeast(fabMarginPx)
        return maxX to maxY
    }

    fun clampExpandedOffset(offset: Offset): Offset {
        val (maxX, maxY) = expandedBounds(viewportSize)
        return Offset(
            x = offset.x.coerceIn(fabMarginPx, maxX),
            y = offset.y.coerceIn(fabMarginPx, maxY)
        )
    }

    fun dockFab(collapsed: Boolean) {
        if (viewportSize.width <= 0 || viewportSize.height <= 0) {
            return
        }

        val currentY = clampExpandedOffset(fabOffset).y
        val dockX = if (collapsed) {
            if (isFabDockedRight) {
                viewportSize.width - collapsedPeekPx
            } else {
                collapsedPeekPx - fabSizePx
            }
        } else if (isFabDockedRight) {
            viewportSize.width - fabSizePx - fabMarginPx
        } else {
            fabMarginPx
        }

        fabOffset = Offset(dockX, currentY)
        onToggleControlPanelCollapsed(collapsed)
    }

    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val dismissControlDialog: () -> Unit = {
        scope.launch {
            sheetState.hide()
            onToggleControlDialog(false)
            dockFab(collapsed = true)
        }
    }
    val runControlAction: (Boolean, () -> Unit) -> Unit = { dismissAfter, action ->
        action()
        if (dismissAfter) {
            dismissControlDialog()
        }
    }

    LaunchedEffect(viewportSize) {
        if (viewportSize.width > 0 && viewportSize.height > 0 && !isFabInitialized) {
            fabOffset = Offset(viewportSize.width - fabSizePx - fabMarginPx, fabMarginPx * 2)
            isFabInitialized = true
            previousViewportSize = viewportSize
        } else if (viewportSize.width > 0 && viewportSize.height > 0) {
            if (previousViewportSize.width > 0 && previousViewportSize.height > 0) {
                val (previousMaxX, previousMaxY) = expandedBounds(previousViewportSize)
                val (currentMaxX, currentMaxY) = expandedBounds(viewportSize)
                val expandedOffset = clampExpandedOffset(fabOffset)
                val relativeX = if (previousMaxX > fabMarginPx) {
                    ((expandedOffset.x - fabMarginPx) / (previousMaxX - fabMarginPx)).coerceIn(0f, 1f)
                } else {
                    1f
                }
                val relativeY = if (previousMaxY > fabMarginPx) {
                    ((expandedOffset.y - fabMarginPx) / (previousMaxY - fabMarginPx)).coerceIn(0f, 1f)
                } else {
                    0f
                }
                fabOffset = Offset(
                    x = fabMarginPx + ((currentMaxX - fabMarginPx) * relativeX),
                    y = fabMarginPx + ((currentMaxY - fabMarginPx) * relativeY)
                )
            }
            if (controlState.isControlPanelCollapsed) {
                dockFab(collapsed = true)
            } else {
                fabOffset = clampExpandedOffset(fabOffset)
            }
            previousViewportSize = viewportSize
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        Surface(
            modifier = Modifier
                .offset { IntOffset(fabOffset.x.roundToInt(), fabOffset.y.roundToInt()) }
                .size(fabSize)
                .pointerInput(viewportSize, controlState.isControlPanelCollapsed) {
                    detectDragGestures(
                        onDragStart = {
                            if (controlState.isControlPanelCollapsed) {
                                dockFab(collapsed = false)
                            }
                        },
                        onDragEnd = {
                            isFabDockedRight = fabOffset.x + fabSizePx / 2f >= viewportSize.width / 2f
                            dockFab(collapsed = true)
                        }
                    ) { change, dragAmount ->
                        change.consume()
                        fabOffset = clampExpandedOffset(
                            Offset(
                                x = fabOffset.x + dragAmount.x,
                                y = fabOffset.y + dragAmount.y
                            )
                        )
                        onToggleControlPanelCollapsed(false)
                    }
                },
            shape = CircleShape,
            color = MaterialTheme.colorScheme.surface.copy(alpha = fabAlpha),
            tonalElevation = 8.dp,
            shadowElevation = 8.dp,
            onClick = {
                if (controlState.isControlPanelCollapsed) {
                    dockFab(collapsed = false)
                } else {
                    onToggleControlDialog(true)
                }
            }
        ) {
            Box(contentAlignment = Alignment.Center, modifier = Modifier.fillMaxSize()) {
                Icon(
                    imageVector = if (controlState.isControlPanelCollapsed) {
                        if (isFabDockedRight) Icons.AutoMirrored.Filled.KeyboardArrowLeft
                        else Icons.AutoMirrored.Filled.KeyboardArrowRight
                    } else {
                        Icons.Default.Settings
                    },
                    contentDescription = "Controls",
                    tint = MaterialTheme.colorScheme.onSurface
                )
            }
        }
    }

    RemoteControlSheet(
        device = device,
        controlState = controlState,
        sheetState = sheetState,
        onDismiss = {
            onToggleControlDialog(false)
            dockFab(collapsed = true)
        },
        dismissControlDialog = dismissControlDialog,
        runControlAction = runControlAction,
        onSendKey = onSendKey,
        onSetFillMode = onSetFillMode,
        onReconnectToDevice = onReconnectToDevice,
        onOpenAppPicker = onOpenAppPicker,
        onDisconnect = onDisconnect
    )

    AppPickerSheet(
        appPickerState = appPickerState,
        onDismissAppPicker = onDismissAppPicker,
        onReconnectToApp = onReconnectToApp
    )
}

@OptIn(ExperimentalLayoutApi::class, ExperimentalMaterial3Api::class)
@Composable
private fun RemoteControlSheet(
    device: Device,
    controlState: RemoteControlUiState,
    sheetState: SheetState,
    onDismiss: () -> Unit,
    dismissControlDialog: () -> Unit,
    runControlAction: (Boolean, () -> Unit) -> Unit,
    onSendKey: (String) -> Unit,
    onSetFillMode: (Boolean) -> Unit,
    onReconnectToDevice: () -> Unit,
    onOpenAppPicker: () -> Unit,
    onDisconnect: () -> Unit
) {
    if (!controlState.isControlDialogOpen) return

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState
    ) {
        LazyColumn(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp),
            contentPadding = PaddingValues(bottom = 24.dp)
        ) {
            item {
                Text("当前设备: ${device.name}", style = MaterialTheme.typography.titleMedium)
                Text("连接状态: ${controlState.status}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(modifier = Modifier.height(24.dp))
            }

            item {
                Text("屏幕控制", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                Spacer(modifier = Modifier.height(8.dp))
                FlowRow(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    OutlinedButton(onClick = { runControlAction(false) { onSendKey("screenon") } }) { Text("亮屏") }
                    OutlinedButton(onClick = { runControlAction(false) { onSendKey("screenoff") } }) { Text("息屏") }
                }
                Spacer(modifier = Modifier.height(16.dp))
            }

            item {
                Text("导航控制", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                Spacer(modifier = Modifier.height(8.dp))
                FlowRow(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    OutlinedButton(onClick = { runControlAction(false) { onSendKey("back") } }) { Text("返回") }
                    OutlinedButton(onClick = { runControlAction(false) { onSendKey("home") } }) { Text("主页") }
                    OutlinedButton(onClick = { runControlAction(false) { onSendKey("recent") } }) { Text("任务") }
                    OutlinedButton(onClick = { runControlAction(false) { onSendKey("menu") } }) { Text("菜单") }
                    OutlinedButton(onClick = { runControlAction(false) { onSendKey("power") } }) { Text("电源") }
                }
                Spacer(modifier = Modifier.height(16.dp))
            }

            item {
                Text("音量控制", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                Spacer(modifier = Modifier.height(8.dp))
                FlowRow(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    OutlinedButton(onClick = { runControlAction(false) { onSendKey("volumeup") } }) { Text("音量+") }
                    OutlinedButton(onClick = { runControlAction(false) { onSendKey("volumedown") } }) { Text("音量-") }
                    OutlinedButton(onClick = { runControlAction(false) { onSendKey("mute") } }) { Text("静音") }
                }
                Spacer(modifier = Modifier.height(16.dp))
            }

            item {
                Text("画面显示", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                Spacer(modifier = Modifier.height(8.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        if (controlState.isFlexDisplayEnabled) "自适应显示器已启用，默认保持等比显示"
                        else "强制拉伸填充全屏",
                        modifier = Modifier.weight(1f)
                    )
                    Switch(
                        checked = controlState.fillMode,
                        onCheckedChange = { runControlAction(false) { onSetFillMode(it) } },
                        enabled = true
                    )
                }
                Spacer(modifier = Modifier.height(16.dp))
            }

            item {
                Text("投屏模式", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                Spacer(modifier = Modifier.height(8.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    OutlinedButton(
                        onClick = { runControlAction(true, onReconnectToDevice) },
                        modifier = Modifier.weight(1f)
                    ) { Text("整机投屏") }

                    OutlinedButton(
                        onClick = {
                            dismissControlDialog()
                            onOpenAppPicker()
                        },
                        modifier = Modifier.weight(1f)
                    ) { Text("应用投屏") }
                }
                Spacer(modifier = Modifier.height(24.dp))
            }

            item {
                Button(
                    onClick = {
                        dismissControlDialog()
                        onDisconnect()
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("断开连接并返回")
                }
            }
        }
    }
}

@Composable
private fun AppPickerSheet(
    appPickerState: RemoteAppPickerUiState,
    onDismissAppPicker: () -> Unit,
    onReconnectToApp: (DeviceApp) -> Unit
) {
    if (!appPickerState.isAppSelectDialogOpen) return

    AyDialog(
        title = "选择应用",
        onDismissRequest = onDismissAppPicker,
        content = {
            if (appPickerState.isLoadingApps) {
                Box(modifier = Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            } else if (appPickerState.appError != null) {
                Text(appPickerState.appError, color = MaterialTheme.colorScheme.error)
            } else if (appPickerState.availableApps.isEmpty()) {
                Box(modifier = Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
                    Text("未找到应用", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxWidth().heightIn(max = 400.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(appPickerState.availableApps) { app ->
                        OutlinedButton(
                            onClick = { onReconnectToApp(app) },
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text(app.name)
                        }
                    }
                }
            }
        },
        footer = {
            Button(onClick = onDismissAppPicker, modifier = Modifier.fillMaxWidth()) {
                Text("取消")
            }
        }
    )
}

private fun sendPointer(
    viewModel: RemoteViewModel,
    event: RemoteTouchPointerEvent,
    viewportSize: IntSize,
    videoSize: IntSize,
    fillMode: Boolean,
    videoBounds: VideoBounds
) {
    val bounds = if (fillMode) {
        VideoBounds(
            left = 0f,
            top = 0f,
            width = viewportSize.width.toFloat().coerceAtLeast(1f),
            height = viewportSize.height.toFloat().coerceAtLeast(1f)
        )
    } else {
        videoBounds
    }
    val xRatio = ((event.point.x - bounds.left) / bounds.width).coerceIn(0f, 1f)
    val yRatio = ((event.point.y - bounds.top) / bounds.height).coerceIn(0f, 1f)
    val isReleasePhase = event.phase == "up" || event.phase == "cancel"

    viewModel.handleIntent(
        RemoteIntent.SendPointer(
            PointerControlMessage(
                phase = event.phase,
                pointerId = event.pointerId,
                pointerType = "touch",
                isPrimary = event.isPrimary,
                xRatio = xRatio,
                yRatio = yRatio,
                frameWidth = videoSize.width.coerceAtLeast(1),
                frameHeight = videoSize.height.coerceAtLeast(1),
                pressure = if (isReleasePhase) 0f else 1f,
                buttons = if (isReleasePhase) 0 else 1
            )
        )
    )
}

private fun calculateVideoBounds(viewportSize: IntSize, videoSize: IntSize, fillMode: Boolean): VideoBounds {
    val viewportWidth = viewportSize.width.toFloat().coerceAtLeast(1f)
    val viewportHeight = viewportSize.height.toFloat().coerceAtLeast(1f)
    val videoWidth = videoSize.width.toFloat().coerceAtLeast(1f)
    val videoHeight = videoSize.height.toFloat().coerceAtLeast(1f)
    
    val scale = if (fillMode) {
        maxOf(viewportWidth / videoWidth, viewportHeight / videoHeight)
    } else {
        minOf(viewportWidth / videoWidth, viewportHeight / videoHeight)
    }
    
    val displayWidth = videoWidth * scale
    val displayHeight = videoHeight * scale
    val left = (viewportWidth - displayWidth) / 2f
    val top = (viewportHeight - displayHeight) / 2f
    return VideoBounds(left, top, displayWidth, displayHeight)
}

private fun resolveDesiredScreenOrientation(
    viewportSize: IntSize,
    videoSize: IntSize,
    occupancyRatio: Float
): Int? {
    if (viewportSize.width <= 0 || viewportSize.height <= 0 || videoSize.width <= 0 || videoSize.height <= 0) {
        return null
    }

    if (isAspectNearSquare(videoSize)) {
        return null
    }

    val viewportLandscape = viewportSize.width >= viewportSize.height
    val videoLandscape = videoSize.width >= videoSize.height
    if (viewportLandscape == videoLandscape) {
        return null
    }

    return if (occupancyRatio <= ORIENTATION_OCCUPANCY_THRESHOLD) {
        if (videoLandscape) {
            ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        } else {
            ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
        }
    } else {
        null
    }
}

private fun resolveNormalCastScreenOrientation(videoSize: IntSize): Int? {
    if (videoSize.width <= 0 || videoSize.height <= 0) {
        return null
    }

    if (isAspectNearSquare(videoSize)) {
        return null
    }

    return if (videoSize.width >= videoSize.height) {
        ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
    } else {
        ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
    }
}

private fun calculateVisibleViewportSize(
    view: android.view.View,
    fallbackSize: IntSize,
    boundsInWindow: Rect?
): IntSize {
    if (fallbackSize.width <= 0 || fallbackSize.height <= 0) {
        return IntSize.Zero
    }
    val bounds = boundsInWindow ?: return fallbackSize
    val visibleFrame = AndroidRect()
    view.getWindowVisibleDisplayFrame(visibleFrame)
    if (visibleFrame.width() <= 0 || visibleFrame.height() <= 0) {
        return fallbackSize
    }

    val left = maxOf(bounds.left, visibleFrame.left.toFloat())
    val top = maxOf(bounds.top, visibleFrame.top.toFloat())
    val right = minOf(bounds.right, visibleFrame.right.toFloat())
    val bottom = minOf(bounds.bottom, visibleFrame.bottom.toFloat())

    val width = (right - left).toInt().coerceIn(1, fallbackSize.width)
    val height = (bottom - top).toInt().coerceIn(1, fallbackSize.height)
    return IntSize(width, height)
}

private fun isAspectNearSquare(size: IntSize): Boolean {
    val longEdge = maxOf(size.width, size.height).toFloat().coerceAtLeast(1f)
    val shortEdge = minOf(size.width, size.height).toFloat().coerceAtLeast(1f)
    return abs(longEdge / shortEdge - 1f) <= ORIENTATION_ASPECT_DEAD_ZONE
}

private data class VideoBounds(
    val left: Float,
    val top: Float,
    val width: Float,
    val height: Float
)
