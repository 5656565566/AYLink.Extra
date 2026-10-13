package com.aylink.mobile.ui.terminal

import com.termux.terminal.TerminalEmulator
import com.termux.terminal.TerminalOutput
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TerminalOutputRecoveryTest {
    @Test
    fun recoveryClearsExistingScreenAndScrollback() {
        val emulator = createEmulator()
        append(emulator, (0..7).joinToString("\r\n") { "old-$it" })
        assertTrue(emulator.screen.activeTranscriptRows > 0)

        resetOutput(emulator)

        assertEquals("", emulator.screen.transcriptText.trim())
        assertEquals(0, emulator.screen.activeTranscriptRows)
        assertEquals(0, emulator.cursorRow)
        assertEquals(0, emulator.cursorCol)
    }

    @Test
    fun replayAfterHistoryOverflowMatchesFreshScreenAndContinuesOutput() {
        val emulator = createEmulator()
        val previousOutput = (0..7).joinToString("\r\n") { "old-$it" }
        append(emulator, previousOutput)
        val snapshot = "new\r\nnext"
        assertNull(terminalOutputDelta(previousOutput.length.toLong(), 32_000L + snapshot.length, snapshot))

        resetOutput(emulator)
        append(emulator, snapshot)

        val expected = createEmulator()
        append(expected, snapshot)
        assertSameScreen(expected, emulator)

        append(emulator, "\r\nlater")
        append(expected, "\r\nlater")
        assertSameScreen(expected, emulator)
    }

    @Test
    fun recoveryResetsParserAndCursorBeforeReplayingSnapshot() {
        val emulator = createEmulator()
        append(emulator, "old\r\nold-tail\u001B[2;3r\u001B[?6h\u001B[31m\u001B[")

        resetOutput(emulator)
        append(emulator, "new\u001B[32mcolor\u001B[0m")

        val expected = createEmulator()
        append(expected, "new\u001B[32mcolor\u001B[0m")
        assertSameScreen(expected, emulator)
        assertEquals(expected.screen.getStyleAt(0, 3), emulator.screen.getStyleAt(0, 3))
    }

    private fun resetOutput(emulator: TerminalEmulator) {
        emulator.reset()
        append(emulator, TERMINAL_OUTPUT_CLEAR_SEQUENCE)
    }

    private fun append(
        emulator: TerminalEmulator,
        data: String,
    ) {
        val bytes = data.toByteArray(Charsets.UTF_8)
        emulator.append(bytes, bytes.size)
    }

    private fun assertSameScreen(
        expected: TerminalEmulator,
        actual: TerminalEmulator,
    ) {
        assertEquals(expected.screen.transcriptText, actual.screen.transcriptText)
        assertEquals(expected.screen.activeTranscriptRows, actual.screen.activeTranscriptRows)
        assertEquals(expected.cursorRow, actual.cursorRow)
        assertEquals(expected.cursorCol, actual.cursorCol)
    }

    private fun createEmulator(): TerminalEmulator = TerminalEmulator(TestOutput(), 20, 4, 100, null)

    private class TestOutput : TerminalOutput() {
        override fun write(
            data: ByteArray,
            offset: Int,
            count: Int,
        ) = Unit

        override fun titleChanged(
            oldTitle: String?,
            newTitle: String?,
        ) = Unit

        override fun onCopyTextToClipboard(text: String?) = Unit

        override fun onPasteTextFromClipboard() = Unit

        override fun onBell() = Unit

        override fun onColorsChanged() = Unit
    }
}
