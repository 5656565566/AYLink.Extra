package com.aylink.mobile.ui.terminal

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.termux.terminal.TerminalSession
import com.termux.terminal.TerminalSessionClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class TerminalNativeTest {
    @Test
    fun nativeSessionReadsInputResizesAndExits() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val client = TestClient()
        lateinit var session: TerminalSession
        instrumentation.runOnMainSync {
            session =
                TerminalSession(
                    "/system/bin/sh",
                    "/",
                    arrayOf(
                        "/system/bin/sh",
                        "-c",
                        "/system/bin/toybox stty size; /system/bin/toybox head -n 1; /system/bin/toybox stty size",
                    ),
                    emptyArray(),
                    null,
                    client,
                )
            session.initializeEmulator(80, 24)
        }
        try {
            assertTrue("Initial PTY output was not received", client.initialOutput.await(10, TimeUnit.SECONDS))
            instrumentation.runOnMainSync {
                session.updateSize(100, 40)
                session.write("JNI_OK\n")
            }
            assertTrue("PTY process did not exit", client.finished.await(10, TimeUnit.SECONDS))
            instrumentation.waitForIdleSync()
            instrumentation.runOnMainSync {
                val transcript = session.emulator.screen.transcriptText
                assertTrue(transcript.contains("24 80"))
                assertTrue(transcript.contains("40 100"))
                assertTrue(transcript.contains("JNI_OK"))
                assertEquals(0, session.exitStatus)
            }
            assertTrue(client.errors.toString(), client.errors.isEmpty())
        } finally {
            instrumentation.runOnMainSync { session.finishIfRunning() }
        }
    }

    private class TestClient : TerminalSessionClient {
        val initialOutput = CountDownLatch(1)
        val finished = CountDownLatch(1)
        val errors = ConcurrentLinkedQueue<String>()

        override fun onTextChanged(session: TerminalSession) {
            val transcript = session.emulator.screen.transcriptText
            if (transcript.contains("24 80")) initialOutput.countDown()
        }

        override fun onSessionFinished(session: TerminalSession) = finished.countDown()

        override fun onTitleChanged(session: TerminalSession) = Unit

        override fun onCopyTextToClipboard(
            session: TerminalSession,
            text: String,
        ) = Unit

        override fun onPasteTextFromClipboard(session: TerminalSession) = Unit

        override fun onBell(session: TerminalSession) = Unit

        override fun onColorsChanged(session: TerminalSession) = Unit

        override fun onTerminalCursorStateChange(state: Boolean) = Unit

        override fun getTerminalCursorStyle(): Int? = null

        override fun logError(
            tag: String,
            message: String,
        ) {
            errors.add("$tag: $message")
        }

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
            exception: Exception,
        ) {
            errors.add("$tag: $message: $exception")
        }

        override fun logStackTrace(
            tag: String,
            exception: Exception,
        ) {
            errors.add("$tag: $exception")
        }
    }
}
