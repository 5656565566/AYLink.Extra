package com.aylink.mobile.ui.remote

import androidx.activity.ComponentActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.click
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollToIndex
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipe
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.aylink.mobile.data.model.Device
import com.aylink.mobile.data.model.DeviceApp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import kotlin.math.abs

@RunWith(AndroidJUnit4::class)
class RemoteFloatingControlTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val controls = mutableStateOf(RemoteControlUiState())
    private val picker = mutableStateOf(RemoteAppPickerUiState())
    private val viewport = mutableStateOf(IntSize.Zero)
    private val device = mutableStateOf(Device(id = 1, name = "测试设备"))
    private val mounted = mutableStateOf(true)
    private val sentKeys = mutableListOf<String>()
    private var remoteTaps = 0
    private var selectedApp: DeviceApp? = null
    private var appRequests = 0

    @Test
    fun topButtonsStartBeforeBottomButtons() {
        showControls()
        compose.mainClock.autoAdvance = false
        try {
            tapAnchor("展开")
            compose.mainClock.advanceTimeByFrame()
            compose.mainClock.advanceTimeBy(120)
            val center = anchor("收起").fetchSemanticsNode().boundsInRoot.center
            val top =
                compose
                    .onNodeWithContentDescription("导航")
                    .fetchSemanticsNode()
                    .boundsInRoot
                    .center
            val bottom =
                compose
                    .onNodeWithContentDescription("设备")
                    .fetchSemanticsNode()
                    .boundsInRoot
                    .center
            assertTrue((top - center).getDistance() > with(compose.density) { 30.dp.toPx() })
            assertTrue((bottom - center).getDistance() < with(compose.density) { 5.dp.toPx() })
        } finally {
            compose.mainClock.advanceTimeBy(500)
            compose.mainClock.autoAdvance = true
        }
    }

    @Test
    fun idleBallFadesAndDraggingRestoresItWithCenteredArrow() {
        showControls()
        val opaqueContrast = ballContrast()
        val screen = compose.onNodeWithTag("viewport")
        compose.mainClock.advanceTimeBy(4_000)
        screen.performTouchInput { click(Offset(20f, 20f)) }
        // MainTestClock 同时驱动 LaunchedEffect 的 delay 和淡出动画。
        compose.mainClock.advanceTimeBy(1_400)
        val fadedContrast = ballContrast()
        assertTrue("opaque=$opaqueContrast, faded=$fadedContrast", fadedContrast < opaqueContrast * 0.6f)
        val bounds = anchor("展开").fetchSemanticsNode().boundsInRoot
        val origin = screen.fetchSemanticsNode().boundsInRoot.topLeft
        screen.performTouchInput {
            down(bounds.center - origin)
            moveTo(bounds.center - origin - Offset(160f, 0f))
        }
        try {
            compose.waitForIdle()
            assertTrue(ballContrast() > opaqueContrast * 0.9f)
            val ball = anchor("展开").fetchSemanticsNode().boundsInRoot.center
            val arrow =
                compose
                    .onNodeWithTag("remoteControlIcon", useUnmergedTree = true)
                    .fetchSemanticsNode()
                    .boundsInRoot
                    .center
            assertTrue((arrow - ball).getDistance() < 1f)
        } finally {
            screen.performTouchInput { up() }
        }
        tapAnchor("展开")
        compose.onNodeWithContentDescription("音量").assertIsDisplayed()
        compose.mainClock.advanceTimeBy(5_400)
        assertTrue(ballContrast("收起") > opaqueContrast * 0.9f)
    }

    @Test
    fun collapsedBallIsHalfHiddenAtTheEdgeAndReopensWithOneTap() {
        showControls(fontScale = 1.3f)
        val screen = compose.onNodeWithTag("viewport").fetchSemanticsNode().boundsInRoot
        val collapsed = anchor("展开").fetchSemanticsNode().boundsInRoot
        assertEquals(screen.right, collapsed.right, 1f)
        assertEquals(with(compose.density) { 26.dp.toPx() }, collapsed.width, 1f)
        tapAnchor("展开")
        compose.onNodeWithContentDescription("投屏").performTouchInput { click() }
        compose.onNodeWithContentDescription("返回分类").assertIsDisplayed()
        assertLabelFits("整机")
        assertLabelFits("应用")
        tapAnchor("收起")
        compose.onNodeWithContentDescription("应用投屏").assertDoesNotExist()
        val hiddenAgain = anchor("展开").fetchSemanticsNode().boundsInRoot
        assertEquals(collapsed.left, hiddenAgain.left, 1f)
        tapAnchor("展开")
        compose.onNodeWithContentDescription("应用投屏").assertIsDisplayed()
    }

    @Test
    fun blankSpaceReachesRemoteWhileControlsAndDraggingStayLocal() {
        showControls()
        tapAnchor("展开")
        val screen = compose.onNodeWithTag("viewport")
        screen.performTouchInput { click(Offset(20f, 20f)) }
        compose.onNodeWithContentDescription("导航").performTouchInput { click() }
        compose.onNodeWithText("返回").assertIsDisplayed()
        compose.onNodeWithContentDescription("远端返回").performTouchInput { click() }
        compose.onNodeWithContentDescription("返回分类").performTouchInput { click() }
        compose.onNodeWithContentDescription("音量").performTouchInput { click() }
        compose.onNodeWithContentDescription("增大音量").performTouchInput { click() }
        compose.onNodeWithContentDescription("增大音量").performTouchInput { click() }
        compose.runOnIdle {
            assertEquals(1, remoteTaps)
            assertEquals(listOf("back", "volumeup", "volumeup"), sentKeys)
            compose.activity.onBackPressedDispatcher.onBackPressed()
        }
        compose.onNodeWithContentDescription("设备").assertIsDisplayed()
        val width = screen.fetchSemanticsNode().boundsInRoot.width
        anchor("收起").performTouchInput { swipe(center, center - Offset(width * 0.8f, 0f)) }
        val draggedCenter = anchor("收起").fetchSemanticsNode().boundsInRoot.center
        assertTrue(draggedCenter.x < width / 2)
        compose.onNodeWithContentDescription("设备").assertIsDisplayed()
        compose.runOnIdle { assertEquals(1, remoteTaps) }
        tapAnchor("收起")
        val leftDock = anchor("展开").fetchSemanticsNode().boundsInRoot
        assertEquals(0f, leftDock.left, 1f)
        assertEquals(with(compose.density) { 26.dp.toPx() }, leftDock.width, 1f)
        tapAnchor("展开")
        compose.onNodeWithContentDescription("增大音量").assertIsDisplayed()
    }

    @Test
    fun appPickerRestoresCastOnCancelAndCollapsesAfterSelection() {
        picker.value = picker.value.copy(availableApps = (1..12).map { DeviceApp("应用$it", "test.app$it") })
        showControls()
        tapAnchor("展开")
        compose.onNodeWithContentDescription("投屏").performTouchInput { click() }
        compose.onNodeWithContentDescription("应用投屏").performTouchInput { click() }
        compose.onNodeWithText("选择投屏应用").assertIsDisplayed()
        compose.onNode(hasScrollAction()).performScrollToIndex(11)
        compose.onNodeWithText("应用12").assertIsDisplayed()
        compose.onNodeWithText("取消").performTouchInput { click() }
        compose.onNodeWithContentDescription("应用投屏").assertIsDisplayed()
        compose.runOnIdle { picker.value = picker.value.copy(appError = "加载失败") }
        compose.onNodeWithContentDescription("应用投屏").performTouchInput { click() }
        compose.onNodeWithText("加载失败").assertIsDisplayed()
        compose.onNodeWithText("重试").performTouchInput { click() }
        compose.runOnIdle {
            assertEquals(3, appRequests)
            picker.value = picker.value.copy(appError = null)
        }
        compose.onNode(hasScrollAction()).performScrollToIndex(11)
        compose.onNodeWithText("应用12").performTouchInput { click() }
        compose.onNodeWithText("选择投屏应用").assertDoesNotExist()
        anchor("展开").assertIsDisplayed()
        tapAnchor("展开")
        compose.onNodeWithContentDescription("应用投屏").assertIsDisplayed()
        compose.runOnIdle { assertEquals("test.app12", selectedApp?.packageName) }
    }

    @Test
    fun firstButtonReturnsToCategoriesAndSelectionIsOnlyKeptForThisSession() {
        showControls()
        tapAnchor("展开")
        compose.onNodeWithContentDescription("音量").performTouchInput { click() }
        val back = compose.onNodeWithContentDescription("返回分类").fetchSemanticsNode().boundsInRoot
        compose.onNodeWithText("上级").assertIsDisplayed()
        val action = compose.onNodeWithContentDescription("增大音量").fetchSemanticsNode().boundsInRoot
        assertTrue(back.top < action.top)
        tapAnchor("收起")
        compose.runOnIdle { controls.value = controls.value.copy(status = "正在重连") }
        tapAnchor("展开")
        compose.onNodeWithContentDescription("增大音量").assertIsDisplayed()
        compose.onNodeWithContentDescription("返回分类").performTouchInput { click() }
        compose.onNodeWithContentDescription("画面").performTouchInput { click() }
        compose.onNodeWithContentDescription("返回分类").performTouchInput { click() }
        tapAnchor("收起")
        tapAnchor("展开")
        compose.onNodeWithContentDescription("亮屏").assertIsDisplayed()
        compose.runOnIdle { mounted.value = false }
        anchor("收起").assertDoesNotExist()
        compose.runOnIdle {
            controls.value = RemoteControlUiState()
            mounted.value = true
        }
        tapAnchor("展开")
        compose.onNodeWithContentDescription("画面").assertIsDisplayed()
        compose.onNodeWithContentDescription("亮屏").assertDoesNotExist()
        compose.onNodeWithContentDescription("音量").performTouchInput { click() }
        compose.runOnIdle {
            device.value = Device(id = 2, name = "另一设备")
            controls.value = RemoteControlUiState()
        }
        tapAnchor("展开")
        compose.onNodeWithContentDescription("音量").assertIsDisplayed()
        compose.onNodeWithContentDescription("增大音量").assertDoesNotExist()
    }

    private fun anchor(verb: String) = compose.onNode(hasContentDescription("${verb}投屏控制", substring = true))

    private fun ballContrast(verb: String = "展开"): Float {
        val bounds = anchor(verb).fetchSemanticsNode().boundsInRoot
        val screen = compose.onNodeWithTag("viewport")
        val origin = screen.fetchSemanticsNode().boundsInRoot.topLeft
        // 比较球体与相邻背景的色差，避免背景亮度影响透明度判断。
        val pixels = screen.captureToImage().toPixelMap()
        val x = (bounds.center.x - origin.x).toInt()
        val y = (bounds.top + bounds.height * 0.8f - origin.y).toInt()
        val color = pixels[x, y]
        val gap = with(compose.density) { 20.dp.toPx() }
        val backgroundX = if (x > pixels.width / 2) bounds.left - origin.x - gap else bounds.right - origin.x + gap
        val background = pixels[backgroundX.toInt(), y]
        return abs(color.red - background.red) + abs(color.green - background.green) + abs(color.blue - background.blue)
    }

    private fun tapAnchor(verb: String) {
        val bounds = anchor(verb).fetchSemanticsNode().boundsInRoot
        val screen = compose.onNodeWithTag("viewport")
        val screenBounds = screen.fetchSemanticsNode().boundsInRoot
        screen.performTouchInput { click(bounds.center - screenBounds.topLeft) }
    }

    private fun assertLabelFits(label: String) {
        val layouts = mutableListOf<TextLayoutResult>()
        compose
            .onNodeWithText(label, useUnmergedTree = true)
            .performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
        val layout = layouts.single()
        // 段落可占满约束宽度，用实际行尾和省略状态判断文字是否被截断。
        assertFalse("$label should not be ellipsized", layout.isLineEllipsized(0))
        assertTrue("$label should fit its bounds", layout.getLineRight(0) <= layout.size.width && !layout.didOverflowHeight)
    }

    private fun showControls(fontScale: Float = 1f) {
        compose.setContent {
            CompositionLocalProvider(LocalDensity provides Density(LocalDensity.current.density, fontScale)) {
                MaterialTheme(colorScheme = darkColorScheme()) {
                    Box(Modifier.fillMaxSize().testTag("viewport").onSizeChanged { viewport.value = it }) {
                        Box(Modifier.fillMaxSize().background(Color.Black).pointerInput(Unit) { detectTapGestures { remoteTaps++ } })
                        if (mounted.value) {
                            RemoteFloatingControl(
                                device = device.value,
                                viewportSize = viewport.value,
                                controlState = controls.value,
                                appPickerState = picker.value,
                                onSendKey = { sentKeys += it },
                                onSetFillMode = { controls.value = controls.value.copy(fillMode = it) },
                                onReconnectToDevice = {},
                                onOpenAppPicker = {
                                    appRequests++
                                    picker.value = picker.value.copy(isAppSelectDialogOpen = true)
                                },
                                onReconnectToApp = {
                                    selectedApp = it
                                    picker.value = picker.value.copy(isAppSelectDialogOpen = false)
                                },
                                onToggleControlMenu = { controls.value = controls.value.copy(isControlMenuOpen = it) },
                                onToggleDebugOverlay = {},
                                onDismissAppPicker = { picker.value = picker.value.copy(isAppSelectDialogOpen = false) },
                                onDisconnect = {},
                            )
                        }
                    }
                }
            }
        }
    }
}
