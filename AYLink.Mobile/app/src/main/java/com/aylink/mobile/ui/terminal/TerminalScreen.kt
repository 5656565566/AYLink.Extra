package com.aylink.mobile.ui.terminal

import android.app.Activity
import android.content.ClipData
import android.content.Context
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.graphics.Rect
import android.graphics.Typeface
import android.view.ActionMode
import android.view.KeyEvent
import android.view.Menu
import android.view.MenuItem
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.exclude
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.Clipboard
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.toClipEntry
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aylink.mobile.R
import com.termux.terminal.TerminalEmulator
import com.termux.terminal.TerminalSession
import com.termux.terminal.TerminalSessionClient
import com.termux.view.TerminalView
import com.termux.view.TerminalViewClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

internal val TerminalBackgroundColor = Color(0xFF101418)
internal const val TERMINAL_OUTPUT_CLEAR_SEQUENCE = "\u001B[3J\u001B[2J\u001B[H"

internal fun TerminalOrientation.activityValue(): Int =
    when (this) {
        TerminalOrientation.FOLLOW_SYSTEM -> ActivityInfo.SCREEN_ORIENTATION_USER
        TerminalOrientation.LANDSCAPE -> ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
        TerminalOrientation.PORTRAIT -> ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
    }

@Composable
fun TerminalScreen(viewModel: TerminalViewModel) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val clipboardManager = LocalClipboard.current
    val coroutineScope = rememberCoroutineScope()
    val currentState by rememberUpdatedState(uiState)
    val hostView = LocalView.current
    val window = (hostView.context as? Activity)?.window
    var keyboardEnabled by remember { mutableStateOf(false) }
    var modifiers by remember { mutableStateOf(TerminalModifiers()) }
    var terminalBridge by remember { mutableStateOf<TermuxTerminalBridge?>(null) }

    LaunchedEffect(viewModel) {
        viewModel.events.collect { event ->
            when (event) {
                is TerminalEvent.OutputChunk -> terminalBridge?.appendOutput(event.data, event.sequence, currentState)
            }
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            terminalBridge?.dispose()
            terminalBridge = null
        }
    }

    LaunchedEffect(window, uiState.screenOrientation) {
        val activity = window?.context as? Activity
        if (activity?.requestedOrientation != uiState.screenOrientation.activityValue()) {
            activity?.requestedOrientation = uiState.screenOrientation.activityValue()
        }
    }

    // 横竖屏变化上报给终端状态：横屏下顶部栏和快捷键栏都要让位给终端内容。
    val configuration = LocalConfiguration.current
    LaunchedEffect(configuration.orientation) {
        viewModel.updateLandscape(configuration.orientation == Configuration.ORIENTATION_LANDSCAPE)
    }

    DisposableEffect(window) {
        val activity = window?.context as? Activity
        // 保存进入终端时的方向，离开终端页恢复，避免把锁定留给其他页面。
        val previousOrientation = activity?.requestedOrientation
        onDispose {
            activity?.requestedOrientation = previousOrientation ?: ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            // 方向只在本次终端会话内生效，离开页面后回到跟随系统。
            viewModel.resetScreenOrientation()
        }
    }

    DisposableEffect(window, keyboardEnabled, uiState.keyboardVisible, uiState.chromeVisible) {
        val keyboardFlag = WindowManager.LayoutParams.FLAG_ALT_FOCUSABLE_IM
        val originalFlag = window?.attributes?.flags?.and(keyboardFlag)
        val insetsController = window?.let { WindowCompat.getInsetsController(it, hostView) }
        if (keyboardEnabled && uiState.keyboardVisible) {
            window?.clearFlags(keyboardFlag)
            terminalBridge?.showKeyboard()
        } else {
            // 保留焦点供选区和硬件按键使用，只禁止软键盘连接当前窗口。
            window?.addFlags(keyboardFlag)
            window?.let { WindowCompat.getInsetsController(it, hostView).hide(WindowInsetsCompat.Type.ime()) }
        }
        // 全屏时隐藏状态栏；返回键唤回顶部栏期间同步恢复，避免留下一条黑边。
        insetsController?.apply {
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            if (uiState.chromeVisible) show(WindowInsetsCompat.Type.statusBars()) else hide(WindowInsetsCompat.Type.statusBars())
        }
        onDispose {
            if (originalFlag != null) window?.setFlags(originalFlag, keyboardFlag)
            // 只在离开终端页（仍处于全屏）时恢复系统栏，避免无关 key 变化造成闪烁。
            if (!uiState.chromeVisible) {
                insetsController?.show(WindowInsetsCompat.Type.statusBars())
                insetsController?.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_DEFAULT
            }
        }
    }

    // 沉浸式（全屏或横屏）且顶部栏已隐藏时，返回键先短暂显示顶部。
    // 顶部栏已显示时不再拦截，避免返回键被卡住；软键盘可见时优先收起键盘。
    BackHandler(enabled = !uiState.chromeVisible) {
        val imeVisible = ViewCompat.getRootWindowInsets(hostView)?.isVisible(WindowInsetsCompat.Type.ime()) == true
        if (imeVisible) {
            window?.let { WindowCompat.getInsetsController(it, hostView).hide(WindowInsetsCompat.Type.ime()) }
        } else {
            viewModel.revealTopBarTemporarily()
        }
    }

    Column(
        modifier =
            Modifier
                .fillMaxSize()
                .background(TerminalBackgroundColor)
                .windowInsetsPadding(WindowInsets.ime.exclude(WindowInsets.navigationBars)),
    ) {
        AndroidView(
            modifier =
                Modifier
                    .weight(1f)
                    .fillMaxWidth(),
            factory = { viewContext ->
                TerminalContainer(
                    viewContext,
                    TerminalView(viewContext, null).apply {
                        val bridge =
                            TermuxTerminalBridge(
                                context = viewContext,
                                terminalView = this,
                                clipboardManager = clipboardManager,
                                coroutineScope = coroutineScope,
                                onSendInput = viewModel::sendInput,
                                onResize = viewModel::resize,
                                readModifiers = { modifiers },
                                consumeModifiers = { modifiers = modifiers.consumed() },
                                canSend = { currentState.ready },
                                keyboardEnabled = { keyboardEnabled && currentState.keyboardVisible },
                                onShowKeyboard = {
                                    window?.let { WindowCompat.getInsetsController(it, this).show(WindowInsetsCompat.Type.ime()) }
                                },
                            )
                        terminalBridge = bridge
                        setTerminalViewClient(bridge)
                        attachSession(bridge.session)
                        // Termux 的 setTextSize 先创建渲染器，setTypeface 才能访问其字号。
                        bridge.setFontSize(uiState.fontSize)
                        setTypeface(Typeface.MONOSPACE)
                        setBackgroundColor(TerminalBackgroundColor.toArgb())
                        isFocusable = true
                        isFocusableInTouchMode = true
                        bridge.syncOutput(uiState)
                    },
                )
            },
            update = { container ->
                terminalBridge?.attachToView(container.terminalView)
                terminalBridge?.setFontSize(uiState.fontSize)
                terminalBridge?.syncOutput(uiState)
            },
        )

        if (uiState.keyboardVisible) {
            TerminalKeyboard(
                enabled = uiState.ready,
                keyboardEnabled = keyboardEnabled,
                modifiers = modifiers,
                onModifiersChange = { modifiers = it },
                onKey = { terminalBridge?.sendKey(it) },
                onCharacter = { terminalBridge?.sendCodePoint(it) },
                onRepeatStart = { terminalBridge?.beginKeyRepeat(it) },
                onToggleKeyboard = { keyboardEnabled = !keyboardEnabled },
            )
        }
    }
}

// 通过原生父 View 包装选择菜单，保留 Termux 的拖动选区和浮动工具栏定位。
@Suppress("ViewConstructor") // 仅通过代码创建，不用于 XML 布局加载。
private class TerminalContainer(
    context: Context,
    val terminalView: TerminalView,
) : FrameLayout(context) {
    init {
        addView(terminalView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    }

    override fun startActionModeForChild(
        originalView: View,
        callback: ActionMode.Callback,
        type: Int,
    ): ActionMode? {
        val selectionCallback =
            if (originalView === terminalView && type == ActionMode.TYPE_FLOATING) {
                TerminalSelectionCallback(callback)
            } else {
                callback
            }
        return super.startActionModeForChild(originalView, selectionCallback, type)
    }

    private inner class TerminalSelectionCallback(
        private val delegate: ActionMode.Callback,
    ) : ActionMode.Callback2() {
        override fun onCreateActionMode(
            mode: ActionMode,
            menu: Menu,
        ): Boolean {
            val created = delegate.onCreateActionMode(mode, menu)
            if (created) {
                menu.findItem(TERMINAL_COPY_ID)?.setTitle(R.string.terminal_copy)
                menu.findItem(TERMINAL_PASTE_ID)?.setTitle(R.string.terminal_paste)
                menu.removeItem(TERMINAL_MORE_ID)
            }
            return created
        }

        override fun onPrepareActionMode(
            mode: ActionMode,
            menu: Menu,
        ): Boolean = delegate.onPrepareActionMode(mode, menu)

        override fun onActionItemClicked(
            mode: ActionMode,
            item: MenuItem,
        ): Boolean = delegate.onActionItemClicked(mode, item)

        override fun onDestroyActionMode(mode: ActionMode) = delegate.onDestroyActionMode(mode)

        override fun onGetContentRect(
            mode: ActionMode,
            view: View,
            outRect: Rect,
        ) {
            if (delegate is ActionMode.Callback2) {
                delegate.onGetContentRect(mode, view, outRect)
            } else {
                super.onGetContentRect(mode, view, outRect)
            }
        }
    }

    private companion object {
        // 对应固定依赖 Termux 0.118.0 TextSelectionCursorController 的菜单 ID。
        const val TERMINAL_COPY_ID = 1
        const val TERMINAL_PASTE_ID = 2
        const val TERMINAL_MORE_ID = 3
    }
}

private class TermuxTerminalBridge(
    context: Context,
    terminalView: TerminalView,
    private val clipboardManager: Clipboard,
    private val coroutineScope: CoroutineScope,
    private val onSendInput: (String) -> Unit,
    private val onResize: (Int, Int) -> Unit,
    private val readModifiers: () -> TerminalModifiers,
    private val consumeModifiers: () -> Unit,
    private val canSend: () -> Boolean,
    private val keyboardEnabled: () -> Boolean,
    private val onShowKeyboard: () -> Unit,
) : TerminalViewClient,
    TerminalSessionClient {
    private val appContext = context.applicationContext
    var terminalView: TerminalView = terminalView
        private set

    val session: TerminalSession =
        TerminalSession(
            "/system/bin/sh",
            "/",
            // JNI 使用完整 argv；首项必须是程序名，否则 -c 会被当作 argv[0]。
            arrayOf("/system/bin/sh", "-c", "cat >/dev/null"),
            emptyArray(),
            null,
            this,
        )

    private var emulatorReady = false
    private val pendingOutput = StringBuilder()
    private var renderedThrough = 0L
    private var fontSize = 0
    private var hardwareLeftAlt = false

    init {
        session.initializeEmulator(80, 24)
        emulatorReady = true
    }

    fun attachToView(view: TerminalView) {
        terminalView = view
        if (terminalView.currentSession !== session) {
            terminalView.attachSession(session)
        }
    }

    private fun renderOutput(data: String) {
        if (data.isEmpty()) return
        val emulator = session.emulator
        if (emulator == null || !emulatorReady) {
            pendingOutput.append(data)
            return
        }
        val bytes = data.toByteArray(Charsets.UTF_8)
        emulator.append(bytes, bytes.size)
        terminalView.onScreenUpdated()
    }

    private fun resetOutput() {
        terminalView.stopTextSelectionMode()
        pendingOutput.clear()
        session.reset()
        // Termux reset 只重置解析器；重放快照还需清除滚动历史、屏幕并回到原点。
        renderOutput(TERMINAL_OUTPUT_CLEAR_SEQUENCE)
    }

    fun syncOutput(state: TerminalUiState) {
        if (state.outputSequence <= renderedThrough) return
        val delta = terminalOutputDelta(renderedThrough, state.outputSequence, window = state.transcript)
        if (delta == null) resetOutput()
        renderOutput(delta ?: state.transcript)
        renderedThrough = state.outputSequence
    }

    fun appendOutput(
        data: String,
        sequence: Long,
        state: TerminalUiState,
    ) {
        val delta = terminalOutputDelta(renderedThrough, sequence, window = data)
        if (delta == null) {
            syncOutput(state)
            return
        }
        if (delta.isEmpty()) return
        renderOutput(delta)
        renderedThrough = sequence
    }

    fun setFontSize(size: Int) {
        if (fontSize == size) return
        terminalView.stopTextSelectionMode()
        terminalView.setTextSize((terminalView.resources.displayMetrics.density * size).roundToInt())
        fontSize = size
    }

    fun showKeyboard() {
        if (!keyboardEnabled()) return
        terminalView.requestFocus()
        onShowKeyboard()
    }

    fun sendKey(keyCode: Int) {
        if (!canSend()) return
        keySequence(keyCode, readModifiers())?.let {
            terminalView.stopTextSelectionMode()
            onSendInput(it)
            consumeModifiers()
        }
    }

    fun beginKeyRepeat(keyCode: Int): (() -> Unit)? {
        if (!canSend()) return null
        val modifiers = readModifiers()
        consumeModifiers()
        // 一次按住使用同一组修饰键；松开后下一次按键才消耗新的状态。
        return {
            if (canSend()) {
                keySequence(keyCode, modifiers)?.let {
                    terminalView.stopTextSelectionMode()
                    onSendInput(it)
                }
            }
        }
    }

    private fun keySequence(
        keyCode: Int,
        modifiers: TerminalModifiers,
        shift: Boolean = false,
        numLock: Boolean = false,
    ): String? {
        val emulator = session.emulator ?: return null
        return terminalKeyCode(keyCode, modifiers, emulator.isCursorKeysApplicationMode, emulator.isKeypadApplicationMode, shift, numLock)
    }

    fun sendCodePoint(
        codePoint: Int,
        control: Boolean = false,
        alt: Boolean = false,
    ) {
        if (!canSend()) return
        val modifiers = readModifiers()
        terminalView.stopTextSelectionMode()
        onSendInput(terminalCodePoint(codePoint, control || modifiers.controlDown, alt || modifiers.altDown))
        consumeModifiers()
    }

    fun dispose() {
        session.finishIfRunning()
    }

    override fun onScale(scale: Float): Float = 1f

    override fun onSingleTapUp(e: MotionEvent) {
        showKeyboard()
    }

    override fun shouldBackButtonBeMappedToEscape(): Boolean = false

    override fun shouldEnforceCharBasedInput(): Boolean = true

    override fun shouldUseCtrlSpaceWorkaround(): Boolean = false

    override fun isTerminalViewSelected(): Boolean = true

    override fun copyModeChanged(copyMode: Boolean) = Unit

    // Termux 仍处理 ACTION_MULTIPLE；需拦截以免文字发给本地占位进程。
    @Suppress("DEPRECATION")
    override fun onKeyDown(
        keyCode: Int,
        e: KeyEvent,
        currentSession: TerminalSession,
    ): Boolean {
        if (e.isSystem) return false
        hardwareLeftAlt = e.metaState and KeyEvent.META_ALT_LEFT_ON != 0
        if (e.action == KeyEvent.ACTION_MULTIPLE && keyCode == KeyEvent.KEYCODE_UNKNOWN) {
            e.characters?.codePoints()?.forEach { sendCodePoint(it, e.isCtrlPressed, hardwareLeftAlt) }
            return true
        }
        val modifiers = readModifiers()
        val effectiveModifiers =
            TerminalModifiers(
                control = if (e.isCtrlPressed) TerminalModifier.ONCE else modifiers.control,
                alt = if (e.isAltPressed) TerminalModifier.ONCE else modifiers.alt,
            )
        val sequence = if (e.isFunctionPressed) null else keySequence(keyCode, effectiveModifiers, e.isShiftPressed, e.isNumLockOn)
        if (sequence != null) {
            if (canSend()) {
                onSendInput(sequence)
                consumeModifiers()
            }
            return true
        }
        return false
    }

    override fun onKeyUp(
        keyCode: Int,
        e: KeyEvent,
    ): Boolean {
        hardwareLeftAlt = e.metaState and KeyEvent.META_ALT_LEFT_ON != 0
        return false
    }

    override fun onLongPress(event: MotionEvent): Boolean = false

    override fun readControlKey(): Boolean = readModifiers().controlDown

    override fun readAltKey(): Boolean = readModifiers().altDown

    override fun readShiftKey(): Boolean = false

    override fun readFnKey(): Boolean = false

    override fun onCodePoint(
        codePoint: Int,
        ctrlDown: Boolean,
        currentSession: TerminalSession,
    ): Boolean {
        sendCodePoint(codePoint, ctrlDown, hardwareLeftAlt)
        return true
    }

    override fun onEmulatorSet() {
        emulatorReady = true
        val emulator = session.emulator ?: return
        onResize(emulator.mColumns, emulator.mRows)
        if (pendingOutput.isNotEmpty()) {
            renderOutput(pendingOutput.toString())
            pendingOutput.clear()
        }
    }

    override fun onTextChanged(changedSession: TerminalSession) {
        terminalView.onScreenUpdated()
        changedSession.emulator?.let { onResize(it.mColumns, it.mRows) }
    }

    override fun onTitleChanged(changedSession: TerminalSession) = Unit

    override fun onSessionFinished(finishedSession: TerminalSession) = Unit

    override fun onCopyTextToClipboard(
        session: TerminalSession,
        text: String,
    ) {
        coroutineScope.launch {
            val clipData = ClipData.newPlainText("terminal_copy", text)
            clipboardManager.setClipEntry(clipData.toClipEntry())
        }
    }

    override fun onPasteTextFromClipboard(session: TerminalSession) {
        coroutineScope.launch {
            val clipEntry = clipboardManager.getClipEntry()
            val text =
                clipEntry
                    ?.clipData
                    ?.getItemAt(0)
                    ?.coerceToText(appContext)
                    ?.toString()
            if (canSend() && !text.isNullOrEmpty()) {
                terminalView.stopTextSelectionMode()
                onSendInput(text)
            }
        }
    }

    override fun onBell(session: TerminalSession) = Unit

    override fun onColorsChanged(session: TerminalSession) {
        terminalView.onScreenUpdated()
    }

    override fun onTerminalCursorStateChange(state: Boolean) {
        terminalView.onScreenUpdated()
    }

    override fun getTerminalCursorStyle(): Int = TerminalEmulator.DEFAULT_TERMINAL_CURSOR_STYLE

    override fun logError(
        tag: String,
        message: String,
    ) = Unit

    override fun logWarn(
        tag: String,
        message: String,
    ) = Unit

    override fun logInfo(
        tag: String,
        message: String,
    ) = Unit

    override fun logDebug(
        tag: String,
        message: String,
    ) = Unit

    override fun logVerbose(
        tag: String,
        message: String,
    ) = Unit

    override fun logStackTraceWithMessage(
        tag: String,
        message: String,
        e: Exception,
    ) = Unit

    override fun logStackTrace(
        tag: String,
        e: Exception,
    ) = Unit
}
