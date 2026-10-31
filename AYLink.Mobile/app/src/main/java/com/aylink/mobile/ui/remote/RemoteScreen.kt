package com.aylink.mobile.ui.remote

import android.content.pm.ActivityInfo
import android.view.WindowManager
import androidx.activity.compose.BackHandler
import androidx.activity.compose.LocalActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.changedToUp
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aylink.mobile.data.model.Device
import com.aylink.mobile.data.model.PointerControlMessage
import kotlinx.coroutines.delay
import org.webrtc.RendererCommon
import org.webrtc.SurfaceViewRenderer
import kotlin.math.abs
import android.graphics.Rect as AndroidRect

private const val ORIENTATION_CHANGE_DEBOUNCE_MS = 450L
private const val ORIENTATION_ASPECT_DEAD_ZONE = 0.08f
private const val ORIENTATION_OCCUPANCY_THRESHOLD = 0.48f
private const val TOUCH_RESUME_STABILIZE_MS = 120L

@Composable
fun AyDialog(
    title: String,
    onDismissRequest: () -> Unit,
    content: @Composable ColumnScope.() -> Unit,
    footer: @Composable RowScope.() -> Unit,
) {
    Dialog(
        onDismissRequest = onDismissRequest,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            shape = RoundedCornerShape(8.dp),
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 4.dp,
            modifier =
                Modifier
                    .padding(24.dp)
                    .widthIn(max = 400.dp)
                    .fillMaxWidth(),
        ) {
            Column {
                Box(
                    modifier = Modifier.padding(start = 24.dp, top = 16.dp, end = 24.dp, bottom = 16.dp),
                ) {
                    Text(
                        text = title,
                        style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.SemiBold),
                    )
                }

                Column(
                    modifier =
                        Modifier
                            .padding(horizontal = 24.dp)
                            .heightIn(max = 420.dp)
                            .padding(bottom = 24.dp)
                            .weight(1f, fill = false)
                            .verticalScroll(rememberScrollState()),
                ) {
                    content()
                }

                Box(
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f)),
                ) {
                    Row(
                        modifier =
                            Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 24.dp, vertical = 16.dp),
                        horizontalArrangement = Arrangement.spacedBy(16.dp),
                    ) {
                        footer()
                    }
                }
            }
        }
    }
}

@Composable
fun RemoteScreen(
    device: Device,
    viewModel: RemoteViewModel,
    onBack: () -> Unit,
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
    val visibleViewportSize =
        remember(localView, viewportSize, viewportBoundsInWindow) {
            calculateVisibleViewportSize(localView, viewportSize, viewportBoundsInWindow)
        }
    val videoBounds =
        remember(viewportSize, viewportState.videoSize) {
            calculateVideoBounds(viewportSize, viewportState.videoSize, fillMode = false)
        }
    val videoOccupancyRatio =
        remember(viewportSize, videoBounds) {
            val viewportArea = viewportSize.width.toFloat() * viewportSize.height.toFloat()
            if (viewportArea <= 0f) {
                1f
            } else {
                (videoBounds.width * videoBounds.height / viewportArea).coerceIn(0f, 1f)
            }
        }
    val desiredScreenOrientation =
        remember(visibleViewportSize, viewportState.videoSize, videoOccupancyRatio) {
            if (!viewportState.isAppProjectionMode && !viewportState.isNewDisplayMode) {
                resolveNormalCastScreenOrientation(videoSize = viewportState.videoSize)
            } else if (viewportState.isAppProjectionMode && viewportState.isNewDisplayMode) {
                resolveDesiredScreenOrientation(
                    viewportSize = visibleViewportSize,
                    videoSize = viewportState.videoSize,
                    occupancyRatio = videoOccupancyRatio,
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
        val hadKeepScreenOn =
            activity
                ?.window
                ?.attributes
                ?.flags
                ?.and(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) != 0
        val observer =
            object : DefaultLifecycleObserver {
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
        modifier =
            Modifier
                .fillMaxSize()
                .background(Color.Black)
                .windowInsetsPadding(
                    WindowInsets.safeDrawing.only(
                        WindowInsetsSides.Horizontal + WindowInsetsSides.Top + WindowInsetsSides.Bottom,
                    ),
                ).onGloballyPositioned { coordinates ->
                    val position = coordinates.positionInWindow()
                    val size = coordinates.size
                    viewportBoundsInWindow =
                        Rect(
                            left = position.x,
                            top = position.y,
                            right = position.x + size.width,
                            bottom = position.y + size.height,
                        )
                },
    ) {
        RemoteVideoSurface(
            viewportSize = viewportSize,
            viewportState = viewportState,
            effectiveFillMode = effectiveFillMode,
            videoBounds = videoBounds,
            onViewportSizeChanged = { viewportSize = it },
            onRendererReady = { rendererRef = it },
            viewModel = viewModel,
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
            onToggleControlMenu = { viewModel.handleIntent(RemoteIntent.SetControlMenuOpen(it)) },
            onToggleDebugOverlay = { viewModel.handleIntent(RemoteIntent.ToggleDebugOverlay) },
            onDismissAppPicker = { viewModel.handleIntent(RemoteIntent.SetAppSelectDialogOpen(false)) },
            onDisconnect = { viewModel.handleIntent(RemoteIntent.DisconnectAndNavigateBack) },
        )

        if (controlState.isDebugModeEnabled && controlState.isDebugOverlayVisible) {
            RemoteDebugOverlay(controlState = controlState)
        }
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
    viewModel: RemoteViewModel,
) {
    val stretchScale = rememberVideoStretchScale(viewportSize, videoBounds, effectiveFillMode)
    val touchPointerState = remember { RemoteTouchPointerState() }
    var touchEpoch by remember { mutableIntStateOf(touchPointerState.epoch) }
    var touchReady by remember { mutableStateOf(false) }
    val touchSurfaceSnapshots = remember { mutableStateMapOf<Int, TouchSurfaceSnapshot>() }
    val touchSurfaceSnapshot =
        remember(touchEpoch, viewportSize, viewportState.videoSize, effectiveFillMode, videoBounds) {
            TouchSurfaceSnapshot(
                epoch = touchEpoch,
                viewportSize = viewportSize,
                videoSize = viewportState.videoSize,
                fillMode = effectiveFillMode,
                videoBounds = videoBounds,
            )
        }
    SideEffect {
        if (touchSurfaceSnapshot.isValid()) {
            touchSurfaceSnapshots[touchSurfaceSnapshot.epoch] = touchSurfaceSnapshot
        }
    }
    val latestPointerDispatch by rememberUpdatedState(
        newValue = { event: RemoteTouchPointerEvent ->
            val isReleasePhase = event.phase == "up" || event.phase == "cancel"
            val snapshot = touchSurfaceSnapshots[event.epoch]
            val canSend = snapshot != null && (isReleasePhase || event.epoch == touchEpoch && touchReady)
            sendPointer(
                viewModel = viewModel,
                event = event,
                snapshot = snapshot.takeIf { canSend },
            )
        },
    )

    LaunchedEffect(viewportSize, viewportState.videoSize, effectiveFillMode, videoBounds) {
        touchPointerState.cancelActivePointers(latestPointerDispatch)
        touchEpoch = touchPointerState.resetForInputBoundary()
        touchReady = false
        touchSurfaceSnapshots.keys.retainAll(setOf(touchEpoch - 1, touchEpoch))
        if (isValidTouchSurface(viewportSize, viewportState.videoSize, effectiveFillMode, videoBounds)) {
            delay(TOUCH_RESUME_STABILIZE_MS)
            if (isValidTouchSurface(viewportSize, viewportState.videoSize, effectiveFillMode, videoBounds)) {
                touchReady = true
            }
        }
    }

    DisposableEffect(touchPointerState, viewModel) {
        onDispose {
            touchPointerState.cancelActivePointers(latestPointerDispatch)
            touchPointerState.clear()
        }
    }

    Box(
        modifier =
            Modifier
                .fillMaxSize()
                .clipToBounds()
                .onSizeChanged(onViewportSizeChanged),
        contentAlignment = Alignment.Center,
    ) {
        RemoteVideoRenderer(
            videoSize = viewportState.videoSize,
            videoBounds = videoBounds,
            stretchScale = stretchScale,
            onRendererReady = onRendererReady,
            viewModel = viewModel,
        )

        RemoteTouchInputLayer(
            viewportSize = viewportSize,
            videoSize = viewportState.videoSize,
            effectiveFillMode = effectiveFillMode,
            videoBounds = videoBounds,
            touchPointerState = touchPointerState,
            touchEpoch = touchEpoch,
            touchReady = touchReady,
            onPointerEvent = latestPointerDispatch,
        )
    }
}

@Composable
private fun rememberVideoStretchScale(
    viewportSize: IntSize,
    videoBounds: VideoBounds,
    fillMode: Boolean,
): ScaleFactor =
    remember(viewportSize, videoBounds, fillMode) {
        ScaleFactor(
            scaleX =
                if (!fillMode || videoBounds.width <= 0f) {
                    1f
                } else {
                    viewportSize.width.toFloat().coerceAtLeast(1f) / videoBounds.width
                },
            scaleY =
                if (!fillMode || videoBounds.height <= 0f) {
                    1f
                } else {
                    viewportSize.height.toFloat().coerceAtLeast(1f) / videoBounds.height
                },
        )
    }

@Composable
private fun RemoteVideoRenderer(
    videoSize: IntSize,
    videoBounds: VideoBounds,
    stretchScale: ScaleFactor,
    onRendererReady: (SurfaceViewRenderer) -> Unit,
    viewModel: RemoteViewModel,
) {
    val density = LocalDensity.current

    AndroidView(
        factory = {
            SurfaceViewRenderer(it).apply {
                onRendererReady(this)
                setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FIT)
                viewModel.webRtcManager.initializeRenderer(this)
                viewModel.webRtcManager.bindRemoteVideo(this)
            }
        },
        modifier =
            Modifier
                .then(
                    if (videoSize == IntSize.Zero) {
                        Modifier.fillMaxSize()
                    } else {
                        Modifier.size(
                            width = with(density) { videoBounds.width.toDp() },
                            height = with(density) { videoBounds.height.toDp() },
                        )
                    },
                ).graphicsLayer {
                    alpha = if (videoSize == IntSize.Zero) 0f else 1f
                    scaleX = stretchScale.scaleX
                    scaleY = stretchScale.scaleY
                }.clipToBounds(),
        update = { renderer ->
            renderer.setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FIT)
        },
    )
}

@Composable
private fun RemoteTouchInputLayer(
    viewportSize: IntSize,
    videoSize: IntSize,
    effectiveFillMode: Boolean,
    videoBounds: VideoBounds,
    touchPointerState: RemoteTouchPointerState,
    touchEpoch: Int,
    touchReady: Boolean,
    onPointerEvent: (RemoteTouchPointerEvent) -> Unit,
) {
    Box(
        modifier =
            Modifier
                .fillMaxSize()
                .pointerInput(touchPointerState, viewportSize, videoSize, effectiveFillMode, videoBounds, touchEpoch, touchReady) {
                    awaitEachGesture {
                        val emitPointer: (RemoteTouchPointerEvent) -> Unit = { event ->
                            onPointerEvent(event)
                        }
                        try {
                            val down = awaitFirstDown(requireUnconsumed = false)
                            if (!touchReady || !isValidTouchSurface(viewportSize, videoSize, effectiveFillMode, videoBounds)) {
                                return@awaitEachGesture
                            }
                            touchPointerState.beginGesture(down.id.value, down.position, emitPointer)

                            do {
                                val event = awaitPointerEvent(pass = PointerEventPass.Main)
                                if (!touchReady || touchPointerState.epoch != touchEpoch) {
                                    touchPointerState.cancelActivePointers(emitPointer)
                                    return@awaitEachGesture
                                }
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
                },
    )
}

@Composable
private fun RemoteDebugOverlay(controlState: RemoteControlUiState) {
    val snapshot = controlState.debugSnapshot
    Surface(
        modifier =
            Modifier
                .padding(14.dp)
                .widthIn(min = 240.dp, max = 360.dp),
        shape = RoundedCornerShape(10.dp),
        color = Color.Black.copy(alpha = 0.76f),
        tonalElevation = 8.dp,
        shadowElevation = 8.dp,
    ) {
        Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
                text = "视频诊断",
                style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold),
                color = Color.White,
            )
            DebugRow("连接", controlState.status)
            DebugRow("分辨率", snapshot?.let { if (it.width > 0 && it.height > 0) "${it.width} × ${it.height}" else "-" } ?: "-")
            DebugRow("帧计数", snapshot?.frameCount?.toString() ?: "-")
            DebugRow("最后帧", snapshot?.lastFrameAtMillis?.let { formatFrameAge(it) } ?: "-")
            DebugRow("Peer", snapshot?.isPeerConnected?.toString() ?: "-")
            DebugRow("有画面", snapshot?.hasVideoFrame?.toString() ?: "-")
            DebugRow("Generation", snapshot?.generation?.toString() ?: "-")
            DebugRow("统一状态", controlState.unifiedRecoveryDecision?.state?.name ?: "-")
            DebugRow("健康来源", controlState.unifiedRecoveryDecision?.origin?.name ?: "-")
            DebugRow("恢复动作", controlState.unifiedRecoveryDecision?.action?.name ?: "-")
            DebugRow("恢复原因", controlState.unifiedRecoveryDecision?.reason ?: "-")
        }
    }
}

@Composable
private fun DebugRow(
    label: String,
    value: String,
) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            text = label,
            modifier = Modifier.width(68.dp),
            style = MaterialTheme.typography.labelMedium,
            color = Color.White.copy(alpha = 0.72f),
        )
        Text(
            text = value,
            modifier = Modifier.weight(1f),
            style = MaterialTheme.typography.labelMedium,
            fontFamily = FontFamily.Monospace,
            color = Color.White.copy(alpha = 0.92f),
        )
    }
}

private fun formatFrameAge(lastFrameAtMillis: Long): String {
    if (lastFrameAtMillis <= 0L) {
        return "-"
    }
    val age = (System.currentTimeMillis() - lastFrameAtMillis).coerceAtLeast(0L)
    return "${age}ms ago"
}

private fun sendPointer(
    viewModel: RemoteViewModel,
    event: RemoteTouchPointerEvent,
    snapshot: TouchSurfaceSnapshot?,
) {
    val surface = snapshot ?: return
    if (!surface.isValid()) {
        return
    }
    val bounds =
        if (surface.fillMode) {
            VideoBounds(
                left = 0f,
                top = 0f,
                width = surface.viewportSize.width.toFloat(),
                height = surface.viewportSize.height.toFloat(),
            )
        } else {
            surface.videoBounds
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
                frameWidth = surface.videoSize.width,
                frameHeight = surface.videoSize.height,
                pressure = if (isReleasePhase) 0f else 1f,
                buttons = if (isReleasePhase) 0 else 1,
            ),
        ),
    )
}

private fun isValidTouchSurface(
    viewportSize: IntSize,
    videoSize: IntSize,
    fillMode: Boolean,
    videoBounds: VideoBounds,
): Boolean {
    if (viewportSize.width <= 0 || viewportSize.height <= 0 || videoSize.width <= 0 || videoSize.height <= 0) {
        return false
    }
    if (fillMode) {
        return true
    }
    return videoBounds.width > 0f && videoBounds.height > 0f
}

private fun calculateVideoBounds(
    viewportSize: IntSize,
    videoSize: IntSize,
    fillMode: Boolean,
): VideoBounds {
    val viewportWidth = viewportSize.width.toFloat().coerceAtLeast(1f)
    val viewportHeight = viewportSize.height.toFloat().coerceAtLeast(1f)
    val videoWidth = videoSize.width.toFloat().coerceAtLeast(1f)
    val videoHeight = videoSize.height.toFloat().coerceAtLeast(1f)

    val scale =
        if (fillMode) {
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
    occupancyRatio: Float,
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
    boundsInWindow: Rect?,
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
    val height: Float,
)

private data class ScaleFactor(
    val scaleX: Float,
    val scaleY: Float,
)

private data class TouchSurfaceSnapshot(
    val epoch: Int,
    val viewportSize: IntSize,
    val videoSize: IntSize,
    val fillMode: Boolean,
    val videoBounds: VideoBounds,
) {
    fun isValid(): Boolean = isValidTouchSurface(viewportSize, videoSize, fillMode, videoBounds)
}
