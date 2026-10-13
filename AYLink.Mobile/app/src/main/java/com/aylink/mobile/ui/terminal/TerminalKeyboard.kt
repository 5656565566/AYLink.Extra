package com.aylink.mobile.ui.terminal

import android.content.res.Configuration
import android.view.KeyEvent
import androidx.activity.compose.LocalActivity
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Keyboard
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aylink.mobile.R
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

@Composable
internal fun TerminalOptionsMenu(
    viewModel: TerminalViewModel,
    // 断开连接后终端页不再绑定设备，由调用方导航到未选择设备状态。
    onDisconnected: () -> Unit = {},
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var expanded by remember { mutableStateOf(false) }
    val activity = LocalActivity.current
    val menuView = LocalView.current
    val insetsController =
        remember(activity, menuView) {
            activity?.window?.let { WindowCompat.getInsetsController(it, menuView) }
        }
    // 菜单展开期间：暂停顶部栏的自动收起计时，并收起系统键盘。
    // 系统输入法窗口的层级高于应用的弹窗窗口，不收起就会盖住菜单下半部分。
    var imeVisibleBeforeMenu by remember { mutableStateOf(false) }
    LaunchedEffect(expanded) {
        if (expanded) {
            imeVisibleBeforeMenu = ViewCompat.getRootWindowInsets(menuView)?.isVisible(WindowInsetsCompat.Type.ime()) == true
            insetsController?.hide(WindowInsetsCompat.Type.ime())
            viewModel.setChromeMenuOpen(true)
        } else {
            // 只有原本在输入、且没有借菜单关掉键盘时才恢复，避免和“隐藏键盘”菜单项打架。
            if (imeVisibleBeforeMenu) {
                imeVisibleBeforeMenu = false
                if (state.keyboardVisible) insetsController?.show(WindowInsetsCompat.Type.ime())
            }
            viewModel.setChromeMenuOpen(false)
        }
    }
    // 离开页面时兜底复位，避免菜单状态残留在 ViewModel 里。
    DisposableEffect(viewModel) {
        onDispose { viewModel.setChromeMenuOpen(false) }
    }
    Box {
        IconButton(onClick = { expanded = true }) {
            Icon(Icons.Default.MoreVert, contentDescription = "终端选项")
        }
        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
            modifier =
                Modifier
                    .widthIn(min = 240.dp, max = 320.dp)
                    // 横屏下菜单整体会超出屏幕，限高后改为内部滚动，避免下半截落到屏幕外。
                    .heightIn(max = dropdownMenuMaxHeight()),
            scrollState = rememberScrollState(),
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
                        val statusColor =
                            when {
                                state.errorMessage != null -> MaterialTheme.colorScheme.error
                                state.ready || state.connecting -> MaterialTheme.colorScheme.primary
                                else -> MaterialTheme.colorScheme.onSurfaceVariant
                            }
                        if (state.connecting) {
                            CircularProgressIndicator(modifier = Modifier.size(12.dp), strokeWidth = 2.dp)
                        } else {
                            Box(Modifier.size(8.dp).background(statusColor, CircleShape))
                        }
                        Text(state.statusText, style = MaterialTheme.typography.bodySmall, color = statusColor, textAlign = TextAlign.End)
                    }
                }
                Text(
                    state.device.name.ifBlank { state.device.serial.ifBlank { "未命名设备" } },
                    style = MaterialTheme.typography.titleSmall,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                if (state.device.serial.isNotBlank()) {
                    Text(
                        "序列号：${state.device.serial}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                state.errorMessage?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                }
            }
            HorizontalDivider()
            DropdownMenuItem(
                text = {
                    Text(stringResource(if (state.keyboardVisible) R.string.terminal_hide_keyboard else R.string.terminal_show_keyboard))
                },
                onClick = {
                    expanded = false
                    viewModel.toggleKeyboardVisibility()
                },
            )
            DropdownMenuItem(
                text = { Text("重连") },
                enabled = !state.connecting,
                onClick = {
                    expanded = false
                    viewModel.reconnect()
                },
            )
            DropdownMenuItem(
                text = { Text(stringResource(R.string.terminal_disconnect)) },
                onClick = {
                    expanded = false
                    viewModel.disconnect()
                    onDisconnected()
                },
            )
            DropdownMenuItem(
                text = { Text("字体 +") },
                enabled = state.fontSize < TerminalViewModel.MAX_FONT_SIZE,
                onClick = {
                    expanded = false
                    viewModel.increaseFontSize()
                },
            )
            DropdownMenuItem(
                text = { Text("字体 −") },
                enabled = state.fontSize > TerminalViewModel.MIN_FONT_SIZE,
                onClick = {
                    expanded = false
                    viewModel.decreaseFontSize()
                },
            )
            DropdownMenuItem(
                text = { Text(stringResource(R.string.terminal_orientation, stringResource(state.screenOrientation.labelRes()))) },
                onClick = {
                    expanded = false
                    viewModel.cycleOrientation()
                },
            )
            DropdownMenuItem(
                text = { Text(stringResource(if (state.fullscreen) R.string.terminal_exit_fullscreen else R.string.terminal_fullscreen)) },
                onClick = {
                    expanded = false
                    viewModel.toggleFullscreen()
                },
            )
        }
    }
}

@Composable
internal fun TerminalKeyboard(
    enabled: Boolean,
    keyboardEnabled: Boolean,
    modifiers: TerminalModifiers,
    onModifiersChange: (TerminalModifiers) -> Unit,
    onKey: (Int) -> Unit,
    onCharacter: (Int) -> Unit,
    onRepeatStart: (Int) -> (() -> Unit)?,
    onToggleKeyboard: () -> Unit,
) {
    var functionLayer by remember { mutableStateOf(false) }
    // 横屏高度只有 411dp，快捷键栏压成单行才能给终端腾出空间；宽屏放得下全部常用键。
    val landscape = LocalConfiguration.current.orientation == Configuration.ORIENTATION_LANDSCAPE
    val rows =
        when {
            landscape && functionLayer -> listOf(LANDSCAPE_FUNCTION_KEYS)
            landscape -> listOf(LANDSCAPE_KEYS)
            functionLayer -> FUNCTION_KEYS
            else -> NORMAL_KEYS
        }
    Column(modifier = Modifier.fillMaxWidth()) {
        HorizontalDivider(color = Color.White.copy(alpha = 0.12f))
        rows.forEach { keys ->
            Row(modifier = Modifier.fillMaxWidth()) {
                keys.forEach { key ->
                    val modifierState = key.modifierState(modifiers)
                    val click = {
                        when (key.role) {
                            TerminalShortcutRole.INPUT -> {
                                when {
                                    key.keyCode != null -> onKey(key.keyCode)
                                    key.character != null -> onCharacter(key.character.code)
                                }
                            }
                            TerminalShortcutRole.CONTROL -> onModifiersChange(modifiers.copy(control = modifiers.control.toggle()))
                            TerminalShortcutRole.ALT -> onModifiersChange(modifiers.copy(alt = modifiers.alt.toggle()))
                            TerminalShortcutRole.FUNCTION_LAYER -> functionLayer = !functionLayer
                            TerminalShortcutRole.KEYBOARD -> onToggleKeyboard()
                        }
                    }
                    val longClick: (() -> Unit)? =
                        when (key.role) {
                            TerminalShortcutRole.CONTROL -> {
                                { onModifiersChange(modifiers.copy(control = modifiers.control.lock())) }
                            }
                            TerminalShortcutRole.ALT -> {
                                { onModifiersChange(modifiers.copy(alt = modifiers.alt.lock())) }
                            }
                            else -> null
                        }
                    TerminalKeyButton(
                        key = key,
                        modifier = Modifier.weight(1f),
                        enabled = key.isEnabled(enabled),
                        selected = key.isSelected(modifiers, functionLayer, keyboardEnabled),
                        locked = modifierState == TerminalModifier.LOCKED,
                        onClick = click,
                        onLongClick = longClick,
                        onRepeatStart = { key.keyCode?.let(onRepeatStart) },
                    )
                }
            }
        }
    }
}

@Composable
private fun TerminalKeyButton(
    key: TerminalShortcut,
    modifier: Modifier,
    enabled: Boolean,
    selected: Boolean,
    locked: Boolean,
    onClick: () -> Unit,
    onLongClick: (() -> Unit)?,
    onRepeatStart: () -> (() -> Unit)?,
) {
    val currentRepeatStart by rememberUpdatedState(onRepeatStart)
    var pressed by remember { mutableStateOf(false) }
    val inputModifier =
        if (key.repeat) {
            Modifier
                .semantics {
                    role = Role.Button
                    if (!enabled) disabled()
                    onClick {
                        if (enabled) onClick()
                        enabled
                    }
                }.pointerInput(key, enabled) {
                    if (!enabled) return@pointerInput
                    detectTapGestures(onPress = {
                        coroutineScope {
                            val send = currentRepeatStart() ?: return@coroutineScope
                            pressed = true
                            try {
                                send()
                                val repeatJob =
                                    launch {
                                        delay(viewConfiguration.longPressTimeoutMillis)
                                        while (isActive) {
                                            send()
                                            delay(80)
                                        }
                                    }
                                try {
                                    tryAwaitRelease()
                                } finally {
                                    repeatJob.cancel()
                                }
                            } finally {
                                pressed = false
                            }
                        }
                    })
                }
        } else {
            Modifier.combinedClickable(
                enabled = enabled,
                role = Role.Button,
                onClick = onClick,
                onLongClick = onLongClick,
                onLongClickLabel = if (onLongClick != null) "锁定或解锁修饰键" else null,
            )
        }
    Surface(
        modifier =
            modifier.height(48.dp).then(inputModifier).semantics {
                contentDescription = key.description
                if (key.role != TerminalShortcutRole.INPUT) {
                    stateDescription =
                        when {
                            locked -> "锁定"
                            selected -> if (onLongClick != null) "下一次输入" else "开启"
                            else -> "关闭"
                        }
                }
            },
        color = if (selected || pressed) MaterialTheme.colorScheme.secondaryContainer else TerminalBackgroundColor,
        contentColor =
            (if (selected || pressed) MaterialTheme.colorScheme.onSecondaryContainer else Color(0xFFE0E0E0))
                .copy(alpha = if (enabled) 1f else 0.38f),
        border = if (locked) BorderStroke(1.dp, MaterialTheme.colorScheme.primary) else null,
    ) {
        Box(contentAlignment = Alignment.Center) {
            if (key.role == TerminalShortcutRole.KEYBOARD) {
                Icon(Icons.Default.Keyboard, contentDescription = null)
            } else {
                Text(text = key.label, fontSize = 11.sp, fontWeight = FontWeight.Medium, maxLines = 1)
            }
        }
    }
}

internal enum class TerminalShortcutRole {
    INPUT,
    CONTROL,
    ALT,
    FUNCTION_LAYER,
    KEYBOARD,
}

// 菜单只显示当前档位，档位名单独成串，便于与“屏幕方向”这个固定标题条组合。
internal fun TerminalOrientation.labelRes(): Int =
    when (this) {
        TerminalOrientation.FOLLOW_SYSTEM -> R.string.terminal_orientation_follow_system
        TerminalOrientation.LANDSCAPE -> R.string.terminal_orientation_landscape
        TerminalOrientation.PORTRAIT -> R.string.terminal_orientation_portrait
    }

// 顶部栏加状态栏约 96dp，竖屏下屏幕高度远大于菜单高度所以不会触发限高。
@Composable
private fun dropdownMenuMaxHeight(): Dp = (LocalConfiguration.current.screenHeightDp - 96).coerceAtLeast(200).dp

internal data class TerminalShortcut(
    val label: String,
    val keyCode: Int? = null,
    val character: Char? = null,
    val repeat: Boolean = false,
    val description: String = label,
    val role: TerminalShortcutRole = TerminalShortcutRole.INPUT,
) {
    fun modifierState(modifiers: TerminalModifiers): TerminalModifier =
        when (role) {
            TerminalShortcutRole.CONTROL -> modifiers.control
            TerminalShortcutRole.ALT -> modifiers.alt
            else -> TerminalModifier.OFF
        }

    fun isEnabled(connected: Boolean): Boolean =
        connected || role == TerminalShortcutRole.FUNCTION_LAYER || role == TerminalShortcutRole.KEYBOARD

    fun isSelected(
        modifiers: TerminalModifiers,
        functionLayer: Boolean,
        keyboardEnabled: Boolean,
    ): Boolean =
        when (role) {
            TerminalShortcutRole.CONTROL -> modifiers.controlDown
            TerminalShortcutRole.ALT -> modifiers.altDown
            TerminalShortcutRole.FUNCTION_LAYER -> functionLayer
            TerminalShortcutRole.KEYBOARD -> keyboardEnabled
            TerminalShortcutRole.INPUT -> false
        }
}

// 横屏只给一行空间：精选最常用的键，等宽撑满横屏宽度（914dp 放得下），功能键仍由 FN 进入。
internal val LANDSCAPE_KEYS =
    listOf(
        TerminalShortcut("FN", description = "切换功能键", role = TerminalShortcutRole.FUNCTION_LAYER),
        TerminalShortcut("ESC", KeyEvent.KEYCODE_ESCAPE),
        TerminalShortcut("TAB", KeyEvent.KEYCODE_TAB),
        TerminalShortcut("CTRL", role = TerminalShortcutRole.CONTROL),
        TerminalShortcut("ALT", role = TerminalShortcutRole.ALT),
        TerminalShortcut("↑", KeyEvent.KEYCODE_DPAD_UP, repeat = true, description = "上"),
        TerminalShortcut("↓", KeyEvent.KEYCODE_DPAD_DOWN, repeat = true, description = "下"),
        TerminalShortcut("←", KeyEvent.KEYCODE_DPAD_LEFT, repeat = true, description = "左"),
        TerminalShortcut("→", KeyEvent.KEYCODE_DPAD_RIGHT, repeat = true, description = "右"),
        TerminalShortcut("HOME", KeyEvent.KEYCODE_MOVE_HOME),
        TerminalShortcut("END", KeyEvent.KEYCODE_MOVE_END),
        TerminalShortcut("PGUP", KeyEvent.KEYCODE_PAGE_UP, repeat = true, description = "向上翻页"),
        TerminalShortcut("PGDN", KeyEvent.KEYCODE_PAGE_DOWN, repeat = true, description = "向下翻页"),
        TerminalShortcut("键盘", description = "显示或隐藏键盘", role = TerminalShortcutRole.KEYBOARD),
    )

// 横屏功能键层同样只占一行：F1-F12 加 FN 返回常用键。
internal val LANDSCAPE_FUNCTION_KEYS =
    (0..11).map { TerminalShortcut("F${it + 1}", KeyEvent.KEYCODE_F1 + it) } +
        TerminalShortcut("FN", description = "返回常用键", role = TerminalShortcutRole.FUNCTION_LAYER)

private val NORMAL_KEYS =
    listOf(
        listOf(
            TerminalShortcut("ESC", KeyEvent.KEYCODE_ESCAPE),
            TerminalShortcut("/", character = '/'),
            TerminalShortcut("|", character = '|'),
            TerminalShortcut("−", character = '-'),
            TerminalShortcut("HOME", KeyEvent.KEYCODE_MOVE_HOME),
            TerminalShortcut("↑", KeyEvent.KEYCODE_DPAD_UP, repeat = true, description = "上"),
            TerminalShortcut("END", KeyEvent.KEYCODE_MOVE_END),
            TerminalShortcut("PGUP", KeyEvent.KEYCODE_PAGE_UP, repeat = true, description = "向上翻页"),
            TerminalShortcut("FN", description = "切换功能键", role = TerminalShortcutRole.FUNCTION_LAYER),
        ),
        listOf(
            TerminalShortcut("TAB", KeyEvent.KEYCODE_TAB),
            TerminalShortcut("CTRL", role = TerminalShortcutRole.CONTROL),
            TerminalShortcut("ALT", role = TerminalShortcutRole.ALT),
            TerminalShortcut("←", KeyEvent.KEYCODE_DPAD_LEFT, repeat = true, description = "左"),
            TerminalShortcut("↓", KeyEvent.KEYCODE_DPAD_DOWN, repeat = true, description = "下"),
            TerminalShortcut("→", KeyEvent.KEYCODE_DPAD_RIGHT, repeat = true, description = "右"),
            TerminalShortcut("PGDN", KeyEvent.KEYCODE_PAGE_DOWN, repeat = true, description = "向下翻页"),
            TerminalShortcut("键盘", description = "显示或隐藏键盘", role = TerminalShortcutRole.KEYBOARD),
        ),
    )

private val FUNCTION_KEYS =
    listOf(
        (0..7).map { TerminalShortcut("F${it + 1}", KeyEvent.KEYCODE_F1 + it) } +
            TerminalShortcut("FN", description = "返回常用键", role = TerminalShortcutRole.FUNCTION_LAYER),
        (8..11).map { TerminalShortcut("F${it + 1}", KeyEvent.KEYCODE_F1 + it) } +
            listOf(
                TerminalShortcut("CTRL", role = TerminalShortcutRole.CONTROL),
                TerminalShortcut("ALT", role = TerminalShortcutRole.ALT),
                TerminalShortcut("TAB", KeyEvent.KEYCODE_TAB),
                TerminalShortcut("键盘", description = "显示或隐藏键盘", role = TerminalShortcutRole.KEYBOARD),
            ),
    )
