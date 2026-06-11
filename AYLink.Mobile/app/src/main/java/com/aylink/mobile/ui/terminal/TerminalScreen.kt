package com.aylink.mobile.ui.terminal

import android.content.Context
import android.graphics.Typeface
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.inputmethod.InputMethodManager
import kotlin.math.roundToInt
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.ClipboardManager
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.graphics.toColorInt
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.termux.terminal.TerminalEmulator
import com.termux.terminal.TerminalSession
import com.termux.terminal.TerminalSessionClient
import com.termux.view.TerminalView
import com.termux.view.TerminalViewClient

@Composable
fun TerminalScreen(
    viewModel: TerminalViewModel
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val clipboardManager = LocalClipboardManager.current
    var terminalBridge by remember { mutableStateOf<TermuxTerminalBridge?>(null) }

    LaunchedEffect(viewModel) {
        viewModel.events.collect { event ->
            when (event) {
                is TerminalEvent.OutputChunk -> terminalBridge?.appendOutput(event.data)
            }
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            terminalBridge?.dispose()
            terminalBridge = null
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = uiState.device.name.ifBlank { uiState.device.serial },
                    style = MaterialTheme.typography.titleMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = uiState.statusText,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            Button(
                onClick = viewModel::reconnect,
                enabled = !uiState.connecting
            ) {
                Text(if (uiState.disconnected) "重新连接" else "重连")
            }
        }

        if (uiState.errorMessage != null) {
            Spacer(modifier = Modifier.height(12.dp))
            Surface(
                color = MaterialTheme.colorScheme.errorContainer,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(
                    text = uiState.errorMessage.orEmpty(),
                    color = MaterialTheme.colorScheme.onErrorContainer,
                    modifier = Modifier.padding(12.dp),
                    style = MaterialTheme.typography.bodyMedium
                )
            }
        }

        Spacer(modifier = Modifier.height(12.dp))

        Surface(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
            color = androidx.compose.ui.graphics.Color(0xFF101418)
        ) {
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { viewContext ->
                    TerminalView(viewContext, null).apply {
                        val bridge = TermuxTerminalBridge(
                            context = viewContext,
                            terminalView = this,
                            clipboardManager = clipboardManager,
                            onSendInput = viewModel::sendInput,
                            onResize = viewModel::resize
                        )
                        terminalBridge = bridge
                        setTerminalViewClient(bridge)
                        attachSession(bridge.session)
                        setTextSize((viewContext.resources.displayMetrics.density * 14f).roundToInt())
                        setTypeface(Typeface.MONOSPACE)
                        setBackgroundColor("#101418".toColorInt())
                        isFocusable = true
                        isFocusableInTouchMode = true
                        requestFocus()
                        bridge.appendOutput(
                            if (uiState.transcript.isNotEmpty()) {
                                uiState.transcript
                            } else {
                                "AYLink Terminal\r\n正在等待远端输出...\r\n"
                            }
                        )
                    }
                },
                update = { terminalView ->
                    terminalBridge?.attachToView(terminalView)
                    terminalBridge?.replaceTranscript(
                        if (uiState.transcript.isNotEmpty()) {
                            uiState.transcript
                        } else {
                            "AYLink Terminal\r\n正在等待远端输出...\r\n"
                        }
                    )
                    terminalView.post {
                        terminalView.requestFocus()
                        val imm = context.getSystemService(InputMethodManager::class.java)
                        imm?.showSoftInput(terminalView, InputMethodManager.SHOW_IMPLICIT)
                    }
                }
            )
        }

        Spacer(modifier = Modifier.height(12.dp))

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            if (uiState.connecting) {
                CircularProgressIndicator(modifier = Modifier.size(28.dp))
            }
            FilterChip(
                selected = false,
                onClick = { viewModel.sendInput("\u0003") },
                label = { Text("Ctrl+C") }
            )
            FilterChip(
                selected = false,
                onClick = { viewModel.sendInput("\t") },
                label = { Text("Tab") }
            )
            FilterChip(
                selected = false,
                onClick = { viewModel.sendInput("\u001B") },
                label = { Text("Esc") }
            )
            FilterChip(
                selected = false,
                onClick = { viewModel.sendInput("\n") },
                label = { Text("Enter") }
            )
            FilterChip(
                selected = false,
                onClick = { clipboardManager.getText()?.let { viewModel.sendInput(it.text) } },
                label = { Text("粘贴") }
            )
        }

        if (!uiState.ready && !uiState.connecting) {
            Spacer(modifier = Modifier.height(12.dp))
            Text(
                text = "当前终端已切到 Termux 渲染，输入建议直接在终端区域完成。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

private class TermuxTerminalBridge(
    context: Context,
    terminalView: TerminalView,
    private val clipboardManager: ClipboardManager,
    private val onSendInput: (String) -> Unit,
    private val onResize: (Int, Int) -> Unit
) : TerminalViewClient, TerminalSessionClient {

    private val appContext = context.applicationContext
    var terminalView: TerminalView = terminalView
        private set

    val session: TerminalSession = TerminalSession(
        "/system/bin/sh",
        "/",
        arrayOf("-c", "cat >/dev/null"),
        emptyArray(),
        null,
        this
    )

    private var emulatorReady = false
    private val pendingOutput = StringBuilder()
    private var lastRenderedTranscript = ""

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

    fun appendOutput(data: String) {
        val emulator = session.emulator
        if (emulator == null || !emulatorReady) {
            pendingOutput.append(data)
            return
        }
        val bytes = data.toByteArray(Charsets.UTF_8)
        emulator.append(bytes, bytes.size)
        terminalView.onScreenUpdated()
        lastRenderedTranscript += data
    }

    fun replaceTranscript(data: String) {
        if (data == lastRenderedTranscript) {
            return
        }
        val emulator = session.emulator
        if (emulator == null || !emulatorReady) {
            pendingOutput.clear()
            pendingOutput.append(data)
            lastRenderedTranscript = data
            return
        }
        session.reset()
        lastRenderedTranscript = ""
        appendOutput(data)
    }

    fun dispose() {
        session.finishIfRunning()
    }

    override fun onScale(scale: Float): Float = 1f

    override fun onSingleTapUp(e: MotionEvent) {
        terminalView.requestFocus()
        val imm = appContext.getSystemService(InputMethodManager::class.java)
        imm?.showSoftInput(terminalView, InputMethodManager.SHOW_IMPLICIT)
    }

    override fun shouldBackButtonBeMappedToEscape(): Boolean = false

    override fun shouldEnforceCharBasedInput(): Boolean = true

    override fun shouldUseCtrlSpaceWorkaround(): Boolean = false

    override fun isTerminalViewSelected(): Boolean = true

    override fun copyModeChanged(copyMode: Boolean) = Unit

    override fun onKeyDown(keyCode: Int, e: KeyEvent, currentSession: TerminalSession): Boolean {
        val sequence = when (keyCode) {
            KeyEvent.KEYCODE_ENTER -> "\n"
            KeyEvent.KEYCODE_DEL -> "\u007F"
            KeyEvent.KEYCODE_TAB -> "\t"
            KeyEvent.KEYCODE_ESCAPE -> "\u001B"
            KeyEvent.KEYCODE_DPAD_UP -> "\u001B[A"
            KeyEvent.KEYCODE_DPAD_DOWN -> "\u001B[B"
            KeyEvent.KEYCODE_DPAD_RIGHT -> "\u001B[C"
            KeyEvent.KEYCODE_DPAD_LEFT -> "\u001B[D"
            else -> null
        }
        if (sequence != null) {
            onSendInput(sequence)
            return true
        }
        return false
    }

    override fun onKeyUp(keyCode: Int, e: KeyEvent): Boolean = false

    override fun onLongPress(event: MotionEvent): Boolean = false

    override fun readControlKey(): Boolean = false

    override fun readAltKey(): Boolean = false

    override fun readShiftKey(): Boolean = false

    override fun readFnKey(): Boolean = false

    override fun onCodePoint(codePoint: Int, ctrlDown: Boolean, currentSession: TerminalSession): Boolean {
        val text = if (ctrlDown && codePoint in 64..95) {
            (codePoint - 64).toChar().toString()
        } else {
            String(Character.toChars(codePoint))
        }
        onSendInput(text)
        return true
    }

    override fun onEmulatorSet() {
        emulatorReady = true
        val emulator = session.emulator ?: return
        onResize(emulator.mColumns, emulator.mRows)
        if (pendingOutput.isNotEmpty()) {
            appendOutput(pendingOutput.toString())
            pendingOutput.clear()
        }
    }

    override fun onTextChanged(changedSession: TerminalSession) {
        terminalView.onScreenUpdated()
        changedSession.emulator?.let { onResize(it.mColumns, it.mRows) }
    }

    override fun onTitleChanged(changedSession: TerminalSession) = Unit

    override fun onSessionFinished(finishedSession: TerminalSession) = Unit

    override fun onCopyTextToClipboard(session: TerminalSession, text: String) {
        clipboardManager.setText(AnnotatedString(text))
    }

    override fun onPasteTextFromClipboard(session: TerminalSession) {
        clipboardManager.getText()?.let { onSendInput(it.text) }
    }

    override fun onBell(session: TerminalSession) = Unit

    override fun onColorsChanged(session: TerminalSession) {
        terminalView.onScreenUpdated()
    }

    override fun onTerminalCursorStateChange(state: Boolean) {
        terminalView.onScreenUpdated()
    }

    override fun getTerminalCursorStyle(): Int = TerminalEmulator.DEFAULT_TERMINAL_CURSOR_STYLE

    override fun logError(tag: String, message: String) = Unit

    override fun logWarn(tag: String, message: String) = Unit

    override fun logInfo(tag: String, message: String) = Unit

    override fun logDebug(tag: String, message: String) = Unit

    override fun logVerbose(tag: String, message: String) = Unit

    override fun logStackTraceWithMessage(tag: String, message: String, e: Exception) = Unit

    override fun logStackTrace(tag: String, e: Exception) = Unit
}
