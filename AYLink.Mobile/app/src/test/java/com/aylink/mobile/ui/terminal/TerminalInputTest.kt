package com.aylink.mobile.ui.terminal

import android.view.KeyEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TerminalInputTest {
    @Test
    fun controlConvertsBothCasesAndTerminalPunctuation() {
        assertEquals("\u0003", terminalCodePoint('c'.code, control = true, alt = false))
        assertEquals("\u0003", terminalCodePoint('C'.code, control = true, alt = false))
        val codes =
            listOf(
                ' ' to 0,
                '@' to 0,
                '2' to 0,
                '[' to 27,
                '3' to 27,
                '\\' to 28,
                '4' to 28,
                ']' to 29,
                '5' to 29,
                '^' to 30,
                '6' to 30,
                '_' to 31,
                '/' to 31,
                '7' to 31,
                '?' to 127,
                '8' to 127,
            )
        codes.forEach { (character, expected) ->
            assertEquals(expected.toChar().toString(), terminalCodePoint(character.code, control = true, alt = false))
        }
        assertEquals("-", terminalCodePoint('-'.code, control = true, alt = false))
    }

    @Test
    fun altPrefixesEscapeAndUnicodeSurvives() {
        assertEquals("\u001Bb", terminalCodePoint('b'.code, control = false, alt = true))
        assertEquals("\u001B\u0003", terminalCodePoint('c'.code, control = true, alt = true))
        assertEquals("中", terminalCodePoint('中'.code, control = false, alt = false))
        assertEquals("😀", terminalCodePoint(0x1F600, control = false, alt = false))
    }

    @Test
    fun oneShotIsConsumedButLockedModifierSurvives() {
        val once = TerminalModifier.OFF.toggle()
        assertEquals(TerminalModifier.ONCE, once)
        assertEquals(TerminalModifier.OFF, once.toggle())
        val locked = once.lock()
        assertEquals(TerminalModifier.LOCKED, locked)
        assertEquals(TerminalModifier.OFF, locked.lock())
        assertEquals(TerminalModifier.OFF, locked.toggle())
        val modifiers = TerminalModifiers(control = once, alt = locked)
        assertTrue(modifiers.controlDown)
        assertTrue(modifiers.altDown)
        assertFalse(modifiers.consumed().controlDown)
        assertTrue(modifiers.consumed().altDown)
    }

    @Test
    fun arrowsAndHomeEndRespectApplicationMode() {
        listOf(
            KeyEvent.KEYCODE_DPAD_UP to "A",
            KeyEvent.KEYCODE_DPAD_DOWN to "B",
            KeyEvent.KEYCODE_DPAD_RIGHT to "C",
            KeyEvent.KEYCODE_DPAD_LEFT to "D",
            KeyEvent.KEYCODE_MOVE_HOME to "H",
            KeyEvent.KEYCODE_MOVE_END to "F",
        ).forEach { (key, suffix) ->
            assertEquals("\u001B[$suffix", key(key))
            assertEquals("\u001BO$suffix", key(key, application = true))
        }
        assertEquals("\u001B[1;5A", key(KeyEvent.KEYCODE_DPAD_UP, TerminalModifiers(control = TerminalModifier.ONCE)))
        assertEquals("\u001B[1;3D", key(KeyEvent.KEYCODE_DPAD_LEFT, TerminalModifiers(alt = TerminalModifier.ONCE)))
    }

    @Test
    fun pagingTabAndFunctionKeysUseStandardSequences() {
        assertEquals("\u001B[5~", key(KeyEvent.KEYCODE_PAGE_UP))
        assertEquals("\u001B[6~", key(KeyEvent.KEYCODE_PAGE_DOWN))
        assertEquals("\t", key(KeyEvent.KEYCODE_TAB))
        assertEquals("\u001B[Z", terminalKeyCode(KeyEvent.KEYCODE_TAB, TerminalModifiers(), false, false, shift = true))
        assertEquals("\r", key(KeyEvent.KEYCODE_ENTER))
        assertEquals("\u007F", key(KeyEvent.KEYCODE_DEL))
        assertEquals("\u001B", key(KeyEvent.KEYCODE_ESCAPE))
        val sequences = listOf("OP", "OQ", "OR", "OS", "[15~", "[17~", "[18~", "[19~", "[20~", "[21~", "[23~", "[24~")
        sequences.forEachIndexed { index, sequence ->
            assertEquals("\u001B$sequence", key(KeyEvent.KEYCODE_F1 + index))
        }
        assertNull(key(KeyEvent.KEYCODE_C))
    }

    @Test
    fun outputSequenceSkipsDuplicateAndOverlappingEvents() {
        assertEquals("", terminalOutputDelta(6, 6, "abcdef"))
        assertEquals("", terminalOutputDelta(6, 3, "abc"))
        assertEquals("def", terminalOutputDelta(3, 6, "cdef"))
        assertEquals("abc", terminalOutputDelta(0, 3, "abc"))
        assertEquals("abc", terminalOutputDelta(3, 6, "abc"))
    }

    @Test
    fun boundedHistoryRolloverOnlyAppendsNewOutput() {
        val snapshot = "x".repeat(31_997) + "new"
        assertEquals("new", terminalOutputDelta(32_000, 32_003, snapshot))
        assertNull(terminalOutputDelta(0, 32_003, snapshot))
        assertEquals("", terminalOutputDelta(0, 0, ""))
    }

    @Test
    fun chunkGapCanBeRecoveredFromHistoryWithoutReplayingIt() {
        assertNull(terminalOutputDelta(3, 9, window = "ghi"))
        assertEquals("defghi", terminalOutputDelta(3, 9, window = "bcdefghi"))
        assertNull(terminalOutputDelta(0, 9, window = "defghi"))
    }

    private fun key(
        keyCode: Int,
        modifiers: TerminalModifiers = TerminalModifiers(),
        application: Boolean = false,
    ): String? = terminalKeyCode(keyCode, modifiers, application, false)
}
