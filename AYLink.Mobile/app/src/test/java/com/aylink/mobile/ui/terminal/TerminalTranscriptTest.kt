package com.aylink.mobile.ui.terminal

import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import kotlin.random.Random

class TerminalTranscriptTest {
    @Test
    fun boundedBufferMatchesOriginalStringWindow() {
        val output = TerminalTranscript(23)
        val random = Random(7)
        var expected = ""
        var sequence = 0L
        val chunks = listOf("", "hello", "中😀", "x".repeat(64)) + List(200) { "ab中😀".repeat(random.nextInt(0, 20)) }
        chunks.forEach { data ->
            expected = (expected + data).takeLast(23)
            sequence += data.length
            assertEquals(sequence, output.append(data))
            assertEquals(TerminalOutputSnapshot(sequence, expected), output.snapshot())
        }
    }

    @Test
    fun publishedSnapshotsRemainImmutableAndAreReusedUntilOutputChanges() {
        val output = TerminalTranscript(8)
        output.append("original")
        val original = output.snapshot()
        assertSame(original, output.snapshot())

        output.append("replacement")
        assertEquals("original", original.transcript)
        assertEquals("lacement", output.snapshot().transcript)
        val replacement = output.snapshot()
        output.append("")
        assertSame(replacement, output.snapshot())
    }

    @Test
    fun concurrentWritersKeepSequenceAndWindowConsistent() {
        val output = TerminalTranscript(97)
        val chunks = ConcurrentHashMap<Long, String>()
        val executor = Executors.newFixedThreadPool(4)
        try {
            val writers =
                (0..3).map { writer ->
                    executor.submit {
                        repeat(100) {
                            val data = "${writer}中"
                            chunks[output.append(data)] = data
                        }
                    }
                }
            writers.forEach { it.get() }
            val expected = chunks.toSortedMap().values.joinToString("")
            assertEquals(TerminalOutputSnapshot(expected.length.toLong(), expected.takeLast(97)), output.snapshot())
        } finally {
            executor.shutdownNow()
        }
    }

    @Test
    fun burstIsCoalescedAndFinalChunkIsPublished() =
        runBlocking {
            val output = TerminalTranscript(32)
            Executors.newSingleThreadExecutor().asCoroutineDispatcher().use { dispatcher ->
                val received = Channel<TerminalOutputSnapshot>(2)
                val collector =
                    launch(dispatcher, start = CoroutineStart.UNDISPATCHED) {
                        output.snapshots.collect { received.send(it) }
                    }
                try {
                    withContext(dispatcher) {
                        repeat(1_000) { output.append("x") }
                    }
                    assertEquals(TerminalOutputSnapshot(1_000, "x".repeat(32)), withTimeout(5_000) { received.receive() })

                    withContext(dispatcher) { output.append("last") }
                    assertEquals(TerminalOutputSnapshot(1_004, "x".repeat(28) + "last"), withTimeout(5_000) { received.receive() })
                    collector.cancelAndJoin()
                    assertTrue(received.tryReceive().isFailure)
                } finally {
                    collector.cancelAndJoin()
                    received.close()
                }
            }
        }

    @Test
    fun newCollectorReceivesOutputProducedBeforeSubscription() =
        runBlocking {
            val output = TerminalTranscript(8)
            output.append("old-then-new")
            val received = Channel<TerminalOutputSnapshot>(1)
            val collector = launch { output.snapshots.collect { received.send(it) } }
            try {
                assertEquals(TerminalOutputSnapshot(12, "then-new"), withTimeout(5_000) { received.receive() })
            } finally {
                collector.cancelAndJoin()
                received.close()
            }
        }
}
