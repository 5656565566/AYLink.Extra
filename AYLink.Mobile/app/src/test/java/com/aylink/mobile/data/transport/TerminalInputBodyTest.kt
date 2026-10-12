package com.aylink.mobile.data.transport

import okio.Buffer
import okio.buffer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class TerminalInputBodyTest {
    @Test
    fun inputQueueIsBoundedAndRejectsMessagesAfterClose() {
        val body = TerminalInputBody()
        assertTrue(body.send("x".repeat(RTC_WINDOW_BYTES - 1)))
        assertFalse(body.send("x"))
        body.close()
        assertFalse(body.send("input"))
    }

    @Test(timeout = 5000)
    fun inputIsNdjsonAndClosingWakesBlockedWriter() {
        val executor = Executors.newSingleThreadExecutor()
        val flushed = CountDownLatch(1)
        val output = Buffer()
        val body = TerminalInputBody()
        val sink =
            object : okio.ForwardingSink(output) {
                override fun flush() {
                    super.flush()
                    flushed.countDown()
                }
            }
        try {
            assertTrue(body.send("{\"type\":\"input\",\"data\":\"中文\"}"))
            val future = executor.submit { body.writeTo(sink.buffer()) }
            assertTrue(flushed.await(2, TimeUnit.SECONDS))
            body.close()
            future.get(2, TimeUnit.SECONDS)
            assertEquals("{\"type\":\"input\",\"data\":\"中文\"}\n", output.readUtf8())
        } finally {
            body.close()
            executor.shutdownNow()
        }
    }
}
