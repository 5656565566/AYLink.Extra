package com.aylink.mobile.ui.terminal

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TerminalShortcutTest {
    @Test
    fun renamedModifierKeysKeepTheirState() {
        val control = TerminalShortcut("控制", role = TerminalShortcutRole.CONTROL)
        val alt = TerminalShortcut("Alternate", role = TerminalShortcutRole.ALT)
        val modifiers = TerminalModifiers(control = TerminalModifier.ONCE, alt = TerminalModifier.LOCKED)

        assertEquals(TerminalModifier.ONCE, control.modifierState(modifiers))
        assertEquals(TerminalModifier.LOCKED, alt.modifierState(modifiers))
        assertTrue(control.isSelected(modifiers, functionLayer = false, keyboardEnabled = false))
        assertTrue(alt.isSelected(modifiers, functionLayer = false, keyboardEnabled = false))
        assertFalse(control.isSelected(modifiers.consumed(), functionLayer = false, keyboardEnabled = false))
        assertTrue(alt.isSelected(modifiers.consumed(), functionLayer = false, keyboardEnabled = false))
    }

    @Test
    fun renamedLocalTogglesWorkWithoutConnection() {
        val function = TerminalShortcut("功能", role = TerminalShortcutRole.FUNCTION_LAYER)
        val keyboard = TerminalShortcut("Keyboard", role = TerminalShortcutRole.KEYBOARD)
        val modifiers = TerminalModifiers()

        assertTrue(function.isEnabled(connected = false))
        assertTrue(keyboard.isEnabled(connected = false))
        assertTrue(function.isSelected(modifiers, functionLayer = true, keyboardEnabled = false))
        assertFalse(function.isSelected(modifiers, functionLayer = false, keyboardEnabled = true))
        assertTrue(keyboard.isSelected(modifiers, functionLayer = false, keyboardEnabled = true))
        assertFalse(keyboard.isSelected(modifiers, functionLayer = true, keyboardEnabled = false))
    }

    @Test
    fun inputLabelsDoNotGiveKeysModifierOrToggleBehavior() {
        val modifiers = TerminalModifiers(control = TerminalModifier.LOCKED, alt = TerminalModifier.LOCKED)
        listOf("CTRL", "ALT", "FN", "键盘").forEach { label ->
            val key = TerminalShortcut(label, character = 'x')
            assertFalse(key.isEnabled(connected = false))
            assertTrue(key.isEnabled(connected = true))
            assertEquals(TerminalModifier.OFF, key.modifierState(modifiers))
            assertFalse(key.isSelected(modifiers, functionLayer = true, keyboardEnabled = true))
        }
        assertFalse(TerminalShortcut("控制", role = TerminalShortcutRole.CONTROL).isEnabled(connected = false))
        assertFalse(TerminalShortcut("Alternate", role = TerminalShortcutRole.ALT).isEnabled(connected = false))
    }
}
