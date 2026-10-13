package com.aylink.mobile.ui.terminal

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TerminalShortcutLayoutTest {
    @Test
    fun landscapeRowKeepsEveryCapabilityOfThePortraitRows() {
        val labels = LANDSCAPE_KEYS.map { it.label }
        // 横屏把两行压成一行，功能键入口、修饰键、方向键、翻页键和键盘开关都不能丢。
        val expected =
            listOf(
                "FN",
                "ESC",
                "TAB",
                "CTRL",
                "ALT",
                "↑",
                "↓",
                "←",
                "→",
                "HOME",
                "END",
                "PGUP",
                "PGDN",
                "键盘",
            )
        expected.forEach { label ->
            assertTrue("横屏快捷键缺少 $label", label in labels)
        }
        assertTrue("横屏快捷键有重复键", labels.size == labels.distinct().size)
        // 一行等宽分摊横屏宽度，键数不能多到单键低于可点尺寸。
        assertTrue("横屏快捷键过多，单键宽度不足：${labels.size}", labels.size <= 16)
    }

    @Test
    fun landscapeFunctionLayerKeepsAllFunctionKeysAndSingleBackEntry() {
        val labels = LANDSCAPE_FUNCTION_KEYS.map { it.label }
        (1..12).forEach { index ->
            assertTrue("横屏功能键缺少 F$index", "F$index" in labels)
        }
        assertTrue("横屏功能键有重复键", labels.size == labels.distinct().size)
        assertEquals(1, LANDSCAPE_FUNCTION_KEYS.count { it.role == TerminalShortcutRole.FUNCTION_LAYER })
    }

    @Test
    fun landscapeKeysMapToDistinctRoles() {
        // 常用键层里功能性开关各就位：FN 切层、CTRL/ALT 修饰、键盘开关。
        assertEquals(
            4,
            LANDSCAPE_KEYS.count {
                it.role == TerminalShortcutRole.FUNCTION_LAYER ||
                    it.role == TerminalShortcutRole.CONTROL ||
                    it.role == TerminalShortcutRole.ALT ||
                    it.role == TerminalShortcutRole.KEYBOARD
            },
        )
    }

    @Test
    fun landscapeCursorAndPageKeysRepeatForHoldDrag() {
        // 方向键和翻页键要可长按重复，否则横屏下无法连续移动光标。
        val inputKeys = LANDSCAPE_KEYS.filter { it.role == TerminalShortcutRole.INPUT }
        listOf("↑", "↓", "←", "→", "PGUP", "PGDN").forEach { label ->
            assertTrue("横屏 $label 应可长按重复", inputKeys.single { it.label == label }.repeat)
        }
    }
}
