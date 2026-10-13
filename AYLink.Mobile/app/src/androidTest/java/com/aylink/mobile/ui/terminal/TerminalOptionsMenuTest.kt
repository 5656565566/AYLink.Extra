package com.aylink.mobile.ui.terminal

import android.content.ContextWrapper
import android.content.SharedPreferences
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import androidx.activity.ComponentActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.aylink.mobile.R
import com.aylink.mobile.data.model.Device
import com.aylink.mobile.data.repo.AppContainer
import com.aylink.mobile.data.repo.LocalUiSettings
import com.aylink.mobile.ui.MainLayout
import com.aylink.mobile.ui.Screen
import com.aylink.mobile.ui.theme.AYLinkTheme
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

@RunWith(AndroidJUnit4::class)
class TerminalOptionsMenuTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val server = MockWebServer()
    private val opened = AtomicInteger()
    private val closed = AtomicInteger()
    private val inputs = LinkedBlockingQueue<String>()
    private val viewModels = ViewModelStore()
    private lateinit var container: AppContainer
    private lateinit var viewModel: TerminalViewModel
    private val currentScreen = mutableStateOf<Screen>(Screen.Terminal(Device(id = 1, name = "menu test")))

    // 默认不导航，保持断开后仍在本页重连的既有覆盖；断开导航用例单独打开。
    private var navigateOnDisconnect = false

    @Before
    fun setUp() {
        server.dispatcher =
            object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse =
                    if (request.path?.endsWith("/terminal/ws") == true) {
                        MockResponse().withWebSocketUpgrade(
                            object : WebSocketListener() {
                                override fun onOpen(
                                    webSocket: WebSocket,
                                    response: Response,
                                ) {
                                    opened.incrementAndGet()
                                    webSocket.send("{\"type\":\"ready\"}")
                                    webSocket.send("{\"type\":\"output\",\"data\":\"retained-output\\n\"}")
                                }

                                override fun onMessage(
                                    webSocket: WebSocket,
                                    text: String,
                                ) {
                                    val message = container.json.parseToJsonElement(text).jsonObject
                                    if (message["type"]?.jsonPrimitive?.content == "input") {
                                        inputs.add(message.getValue("data").jsonPrimitive.content)
                                    }
                                }

                                override fun onClosed(
                                    webSocket: WebSocket,
                                    code: Int,
                                    reason: String,
                                ) {
                                    closed.incrementAndGet()
                                }

                                override fun onFailure(
                                    webSocket: WebSocket,
                                    t: Throwable,
                                    response: Response?,
                                ) {
                                    closed.incrementAndGet()
                                }
                            },
                        )
                    } else {
                        MockResponse().setResponseCode(404)
                    }
            }
        server.start()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        // 使用独立名称的偏好存储隔离测试账号，Application 上下文仍取目标应用。
        val context =
            object : ContextWrapper(instrumentation.targetContext) {
                override fun getSharedPreferences(
                    name: String,
                    mode: Int,
                ): SharedPreferences = super.getSharedPreferences("terminal_menu_test_$name", mode)
            }
        container = AppContainer(context)
        container.sessionStore.updateBaseUrl(server.url("/").toString())
        container.sessionStore.updateSession("terminal-menu-test", null)
        val device = Device(id = 1, name = "menu test")
        currentScreen.value = Screen.Terminal(device)
        // 每个用例把宿主显式固定为竖屏，避免上一个用例残留的横屏把顶部栏藏掉。
        val deadline = System.currentTimeMillis() + 10_000
        instrumentation.runOnMainSync {
            viewModel = TerminalViewModel(device, container.sessionStore, container.terminalTransport, container.json)
            viewModels.put("terminal-menu", viewModel)
            compose.activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        }
        // 等宿主稳定在竖屏再 setContent，避免组合挂在刚被旋转影响的实例上。
        while (System.currentTimeMillis() < deadline) {
            val settled =
                runCatching {
                    val activity = compose.activity
                    !activity.isDestroyed &&
                        activity.resources.configuration.orientation == Configuration.ORIENTATION_PORTRAIT
                }.getOrDefault(false)
            if (settled) break
            Thread.sleep(50)
        }
        compose.setContent {
            val terminalState by viewModel.uiState.collectAsStateWithLifecycle()
            AYLinkTheme(settings = LocalUiSettings()) {
                MainLayout(
                    currentScreen = currentScreen.value,
                    selectedDevice = device,
                    onNavigate = { currentScreen.value = it },
                    onLogout = {},
                    actions = {
                        // 与 AYLinkApp 的接线一致：只有终端页才挂终端菜单，断开后随页面一起退出。
                        if (currentScreen.value is Screen.Terminal) {
                            TerminalOptionsMenu(
                                viewModel,
                                onDisconnected = {
                                    if (navigateOnDisconnect) currentScreen.value = Screen.TerminalHome
                                },
                            )
                        }
                    },
                    terminalChromeVisible = terminalState.chromeVisible,
                ) {
                    when (currentScreen.value) {
                        is Screen.Terminal -> TerminalScreen(viewModel)
                        else -> Box(modifier = Modifier.fillMaxSize().background(TerminalBackgroundColor))
                    }
                }
            }
        }
        compose.waitUntil(10_000) {
            val state = viewModel.uiState.value
            state.ready && state.transcript.contains("retained-output")
        }
    }

    @After
    fun tearDown() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync { viewModels.clear() }
        if (::container.isInitialized) {
            container.deviceTransport.pool.close()
            container.sessionStore.updateSession(null, null)
            val client = container.okHttpClient
            client.dispatcher.cancelAll()
            client.connectionPool.evictAll()
            client.dispatcher.executorService.shutdown()
        }
        server.shutdown()
    }

    @Test
    fun menuHidesShortcutBarAndImeThenRestoresKeyboard() {
        compose.onNodeWithText("ESC").assertExists()
        compose.onNodeWithContentDescription("显示或隐藏键盘").performClick()
        waitForIme(visible = true)

        clickMenuItem(compose.activity.getString(R.string.terminal_hide_keyboard))
        compose.onNodeWithText("ESC").assertDoesNotExist()
        waitForIme(visible = false)
        assertFalse(viewModel.uiState.value.keyboardVisible)

        clickMenuItem(compose.activity.getString(R.string.terminal_show_keyboard))
        compose.onNodeWithText("ESC").assertExists()
        waitForIme(visible = true)
        assertTrue(viewModel.uiState.value.keyboardVisible)
        assertTrue(viewModel.uiState.value.ready)
    }

    @Test
    fun orientationMenuItemShowsCurrentGearAndCyclesOnClick() {
        // 只验证菜单标题与点击切换：循环顺序和方向映射由 JVM 单测覆盖。
        val menuTitle = orientationMenuTitle(TerminalOrientation.FOLLOW_SYSTEM)
        compose.onNodeWithContentDescription("终端选项").performClick()
        compose.onNodeWithText(menuTitle).assertExists()
        assertEquals(TerminalOrientation.FOLLOW_SYSTEM, viewModel.uiState.value.screenOrientation)

        compose.onNodeWithText(menuTitle).performClick()
        assertEquals(TerminalOrientation.LANDSCAPE, viewModel.uiState.value.screenOrientation)
    }

    private fun orientationMenuTitle(orientation: TerminalOrientation): String =
        compose.activity.getString(R.string.terminal_orientation, orientationLabel(orientation))

    private fun orientationLabel(orientation: TerminalOrientation) =
        compose.activity.getString(
            when (orientation) {
                TerminalOrientation.FOLLOW_SYSTEM -> R.string.terminal_orientation_follow_system
                TerminalOrientation.LANDSCAPE -> R.string.terminal_orientation_landscape
                TerminalOrientation.PORTRAIT -> R.string.terminal_orientation_portrait
            },
        )

    @Test
    fun fullscreenHidesTopBarAndBackTemporarilyRevealsIt() {
        // 顶部栏挂在 MainLayout 上，全屏时整块移除，返回键再临时唤回。
        compose.onNodeWithContentDescription("终端选项").assertExists()

        clickMenuItem(compose.activity.getString(R.string.terminal_fullscreen))
        compose.waitUntil(10_000) { viewModel.uiState.value.fullscreen }
        assertTopBarVisible(false)

        // 返回键先短暂显示顶部，约 4 秒后重新隐藏。
        compose.runOnIdle { compose.activity.onBackPressedDispatcher.onBackPressed() }
        assertTopBarVisible(true)
        compose.waitUntil(20_000) { !topBarVisible() }

        // 再次唤出顶部，并在此期间退出全屏，顶部栏保持显示。
        compose.runOnIdle { compose.activity.onBackPressedDispatcher.onBackPressed() }
        assertTopBarVisible(true)
        clickMenuItem(compose.activity.getString(R.string.terminal_exit_fullscreen))
        compose.waitUntil(10_000) { !viewModel.uiState.value.fullscreen }
        assertTopBarVisible(true)
    }

    @Test
    fun fullscreenAlsoHidesStatusBarAndRestoresItOnExit() {
        clickMenuItem(compose.activity.getString(R.string.terminal_fullscreen))
        compose.waitUntil(10_000) { viewModel.uiState.value.fullscreen }
        compose.waitUntil(10_000) { !statusBarVisible() }

        // 返回键唤回顶部栏时状态栏同步恢复，不会留下一条黑边。
        compose.runOnIdle { compose.activity.onBackPressedDispatcher.onBackPressed() }
        assertTopBarVisible(true)
        compose.waitUntil(10_000) { statusBarVisible() }

        clickMenuItem(compose.activity.getString(R.string.terminal_exit_fullscreen))
        compose.waitUntil(10_000) { !viewModel.uiState.value.fullscreen }
        assertTopBarVisible(true)
        compose.waitUntil(10_000) { statusBarVisible() }
    }

    private fun statusBarVisible(): Boolean =
        ViewCompat
            .getRootWindowInsets(compose.activity.window.decorView)
            ?.isVisible(WindowInsetsCompat.Type.statusBars()) == true

    @Test
    fun menuDisconnectNavigatesBackToUnselectedDeviceState() {
        navigateOnDisconnect = true
        val before = viewModel.uiState.value
        // 断开后回到未选择设备状态，终端页和终端菜单一并退出。
        clickMenuItem(compose.activity.getString(R.string.terminal_disconnect))
        compose.waitForIdle()
        // 断开后立刻离开终端页，顶部栏的终端菜单随之移除。
        compose.waitUntil(10_000) { compose.onAllNodesWithContentDescription("终端选项").fetchSemanticsNodes().isEmpty() }
        assertTrue(currentScreen.value is Screen.TerminalHome)
        assertEquals("终端已断开", viewModel.uiState.value.statusText)
        assertEquals(before.transcript, viewModel.uiState.value.transcript)
        assertEquals(before.outputSequence, viewModel.uiState.value.outputSequence)
        compose.runOnIdle { viewModel.sendInput("blocked-after-disconnect\n") }
        assertTrue(inputs.isEmpty())

        // 重新进入终端才恢复菜单，说明断开确实离开了已绑定设备的页面。
        compose.runOnIdle { currentScreen.value = Screen.Terminal(before.device) }
        compose.waitUntil(10_000) { topBarVisible() }
    }

    @Test
    fun menuDisconnectClosesSocketPreservesOutputAndCanReconnect() {
        val before = viewModel.uiState.value
        clickMenuItem(compose.activity.getString(R.string.terminal_disconnect))
        compose.waitUntil(10_000) { closed.get() == 1 }
        compose.runOnIdle {
            val after = viewModel.uiState.value
            assertFalse(after.connecting)
            assertFalse(after.ready)
            assertTrue(after.disconnected)
            assertEquals("终端已断开", after.statusText)
            assertEquals(before.transcript, after.transcript)
            assertEquals(before.outputSequence, after.outputSequence)
            viewModel.sendInput("blocked-after-disconnect\n")
        }
        compose.onNodeWithText("ESC").assertIsNotEnabled()

        clickMenuItem("重连")
        compose.waitUntil(10_000) {
            val state = viewModel.uiState.value
            state.ready && state.outputSequence > before.outputSequence
        }
        assertEquals(2, opened.get())
        val reconnected = viewModel.uiState.value
        assertTrue(reconnected.transcript.startsWith(before.transcript))
        compose.runOnIdle { viewModel.sendInput("after-reconnect\n") }
        assertEquals("after-reconnect\n", inputs.poll(5, TimeUnit.SECONDS))
        assertTrue(inputs.isEmpty())
    }

    @Test
    fun tappingScrimOutsideDrawerClosesItOnTerminalScreen() {
        compose.onNodeWithContentDescription("Menu").performClick()
        compose.waitUntil(10_000) { drawerOpen() }

        // 终端页只禁用“滑动手势拉开”，点击遮罩收起必须仍然可用。
        tapOutsideDrawer()
        compose.waitUntil(10_000) { !drawerOpen() }
    }

    /** 一次完整的 down/up 手势，模拟手指点击侧边栏外的遮罩。 */
    private fun tapOutsideDrawer() {
        compose.onRoot().performTouchInput {
            down(Offset(width * 0.9f, height * 0.5f))
            up()
        }
    }

    /** 抽屉内容常驻语义树，靠位置判断：打开时在屏幕内，收回时被移出左侧屏幕。 */
    private fun drawerOpen(): Boolean {
        val nodes = compose.onAllNodesWithText("文件管理").fetchSemanticsNodes()
        if (nodes.isEmpty()) return false
        val root = compose.onRoot().fetchSemanticsNode()
        val left = nodes.first().boundsInRoot.left
        return left >= 0f && left < root.size.width
    }

    @Test
    fun expandedMenuKeepsTopBarVisiblePastTheRevealTimeout() {
        val exitFullscreen = compose.activity.getString(R.string.terminal_exit_fullscreen)
        clickMenuItem(compose.activity.getString(R.string.terminal_fullscreen))
        compose.waitUntil(10_000) { viewModel.uiState.value.fullscreen }
        assertTopBarVisible(false)

        // 返回键唤出顶部栏后打开菜单，4 秒计时不应把展开的菜单收走。
        compose.runOnIdle { compose.activity.onBackPressedDispatcher.onBackPressed() }
        assertTopBarVisible(true)
        compose.onNodeWithContentDescription("终端选项").performClick()
        compose.waitForIdle()
        compose.onNodeWithText(exitFullscreen).assertExists()
        compose.mainClock.advanceTimeBy(6_000)
        compose.waitForIdle()
        compose.onNodeWithText(exitFullscreen).assertExists()
        assertTopBarVisible(true)

        // 关闭菜单后重新计时，超时才收起。
        clickMenuItem(exitFullscreen)
        compose.waitUntil(10_000) { !viewModel.uiState.value.fullscreen }
    }

    private fun topBarVisible() = compose.onAllNodesWithContentDescription("终端选项").fetchSemanticsNodes().isNotEmpty()

    private fun assertTopBarVisible(expected: Boolean) = compose.waitUntil(10_000) { topBarVisible() == expected }

    private fun clickMenuItem(text: String) {
        compose.onNodeWithContentDescription("终端选项").performClick()
        compose.onNodeWithText(text).performClick()
        compose.waitForIdle()
    }

    private fun waitForIme(visible: Boolean) {
        compose.waitUntil(10_000) {
            ViewCompat
                .getRootWindowInsets(compose.activity.window.decorView)
                ?.isVisible(WindowInsetsCompat.Type.ime()) == visible
        }
    }
}
