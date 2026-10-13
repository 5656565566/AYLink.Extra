package com.aylink.mobile.ui.terminal

import com.termux.terminal.KeyHandler

internal enum class TerminalModifier {
    OFF,
    ONCE,
    LOCKED,
    ;

    fun toggle(): TerminalModifier = if (this == OFF) ONCE else OFF

    fun lock(): TerminalModifier = if (this == LOCKED) OFF else LOCKED

    fun consumed(): TerminalModifier = if (this == ONCE) OFF else this
}

internal data class TerminalModifiers(
    val control: TerminalModifier = TerminalModifier.OFF,
    val alt: TerminalModifier = TerminalModifier.OFF,
) {
    val controlDown: Boolean get() = control != TerminalModifier.OFF
    val altDown: Boolean get() = alt != TerminalModifier.OFF

    fun consumed() = copy(control = control.consumed(), alt = alt.consumed())
}

internal fun terminalCodePoint(
    codePoint: Int,
    control: Boolean,
    alt: Boolean,
): String {
    val mapped =
        if (control) {
            when (codePoint) {
                in 'a'.code..'z'.code -> codePoint - 'a'.code + 1
                in 'A'.code..'Z'.code -> codePoint - 'A'.code + 1
                ' '.code, '@'.code, '2'.code -> 0
                '['.code, '3'.code -> 27
                '\\'.code, '4'.code -> 28
                ']'.code, '5'.code -> 29
                '^'.code, '6'.code -> 30
                '_'.code, '/'.code, '7'.code -> 31
                '?'.code, '8'.code -> 127
                else -> codePoint
            }
        } else {
            codePoint
        }
    return (if (alt) "\u001B" else "") + String(Character.toChars(mapped))
}

internal fun terminalKeyCode(
    keyCode: Int,
    modifiers: TerminalModifiers,
    cursorApplication: Boolean,
    keypadApplication: Boolean,
    shift: Boolean = false,
    numLock: Boolean = false,
): String? {
    var flags = 0
    if (modifiers.controlDown) flags = flags or KeyHandler.KEYMOD_CTRL
    if (modifiers.altDown) flags = flags or KeyHandler.KEYMOD_ALT
    if (shift) flags = flags or KeyHandler.KEYMOD_SHIFT
    if (numLock) flags = flags or KeyHandler.KEYMOD_NUM_LOCK
    return KeyHandler.getCode(keyCode, flags, cursorApplication, keypadApplication)
}

// window 是截至 sequence 的连续输出后缀，序列按 UTF-16 字符数计算。
// null 表示缺失内容超出 window：单个分片需转向历史窗口，历史窗口也不足时才清屏重放。
internal fun terminalOutputDelta(
    renderedThrough: Long,
    sequence: Long,
    window: String,
): String? {
    val missing = sequence - renderedThrough
    if (missing <= 0) return ""
    if (missing > window.length) return null
    return window.takeLast(missing.toInt())
}
