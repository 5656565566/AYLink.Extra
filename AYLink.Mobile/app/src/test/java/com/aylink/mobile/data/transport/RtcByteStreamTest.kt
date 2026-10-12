package com.aylink.mobile.data.transport

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import okhttp3.MultipartBody
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okio.Buffer
import okio.buffer
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.IOException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class RtcByteStreamTest {
    private val json = Json { ignoreUnknownKeys = true }

    private fun RtcByteStream.control(message: RtcMessage) =
        receive(json.encodeToString(RtcMessage.serializer(), message).encodeToByteArray(), false)

    @Test(timeout = 5000)
    fun multipartUploadAcrossManyWindowsPreservesBytesAndBoundary() {
        val data = ByteArray(2_500_000) { (it % 251).toByte() }
        val body =
            MultipartBody
                .Builder("mobile-boundary")
                .setType(MultipartBody.FORM)
                .addFormDataPart("file", "测试.apk", data.toRequestBody())
                .build()
        val expected = Buffer().also { body.writeTo(it) }.readByteArray()
        val uploaded = Buffer()
        val controls = mutableListOf<RtcMessage>()
        lateinit var stream: RtcByteStream
        stream =
            RtcByteStream(json, { bytes, binary ->
                assertTrue(bytes.size <= RTC_CHUNK_BYTES)
                if (binary) {
                    uploaded.write(bytes)
                    stream.control(RtcMessage("credit", bytes = bytes.size))
                } else {
                    controls += json.decodeFromString(RtcMessage.serializer(), bytes.decodeToString())
                }
                true
            }, {})
        stream.start(
            Request
                .Builder()
                .url("http://localhost/api/devices/1/files/upload?path=%2Fsdcard")
                .post(body)
                .build(),
        )
        val sink = stream.sink().buffer()
        body.writeTo(sink)
        sink.flush()
        stream.end()
        assertArrayEquals(expected, uploaded.readByteArray())
        assertEquals("multipart/form-data; boundary=mobile-boundary", controls.first().headers?.get("Content-Type"))
        assertEquals("/api/devices/1/files/upload?path=%2Fsdcard", controls.first().url)
        assertEquals("end", controls.last().type)
    }

    @Test(timeout = 5000)
    fun uploadStopsAtWindowUntilConsumerReturnsCredit() {
        val executor = Executors.newSingleThreadExecutor()
        val reachedWindow = CountDownLatch(1)
        var sent = 0
        val stream =
            RtcByteStream(json, { bytes, binary ->
                if (binary) {
                    sent += bytes.size
                    if (sent == RTC_WINDOW_BYTES) reachedWindow.countDown()
                }
                true
            }, {})
        try {
            val future = executor.submit { stream.sink().write(Buffer().write(ByteArray(RTC_WINDOW_BYTES + 1)), RTC_WINDOW_BYTES + 1L) }
            assertTrue(reachedWindow.await(2, TimeUnit.SECONDS))
            assertFalse(future.isDone)
            stream.control(RtcMessage("credit", bytes = 1))
            future.get(2, TimeUnit.SECONDS)
            assertEquals(RTC_WINDOW_BYTES + 1, sent)
        } finally {
            stream.close()
            executor.shutdownNow()
        }
    }

    @Test
    fun downloadReturnsCreditOnlyAsBytesAreConsumed() {
        val controls = mutableListOf<RtcMessage>()
        var closed = 0
        val stream =
            RtcByteStream(json, { bytes, _ ->
                controls += json.decodeFromString(RtcMessage.serializer(), bytes.decodeToString())
                true
            }, { closed++ })
        stream.control(RtcMessage("response", status = 200))
        repeat(16) { stream.receive(ByteArray(RTC_CHUNK_BYTES) { it.toByte() }, true) }
        stream.control(RtcMessage("end"))
        assertTrue(controls.isEmpty())
        val source = stream.source()
        val output = Buffer()
        assertEquals(123L, source.read(output, 123))
        assertEquals(123, controls.single().bytes)
        assertEquals(0, closed)
        while (source.read(output, RTC_CHUNK_BYTES.toLong()) != -1L) { }
        assertEquals(RTC_WINDOW_BYTES.toLong(), output.size)
        assertEquals(1, closed)
        assertEquals(-1L, source.read(output, 1))
        source.close()
        assertEquals(1, closed)
    }

    @Test(timeout = 5000)
    fun downloadAcrossManyWindowsPreservesEveryByte() =
        runBlocking {
            val data = ByteArray(2_500_000) { (it % 251).toByte() }
            var offset = 0
            var ended = false
            var closed = 0
            lateinit var stream: RtcByteStream

            fun produce(allowance: Int) {
                var remaining = allowance
                while (offset < data.size && remaining > 0) {
                    val size = minOf(RTC_CHUNK_BYTES, remaining, data.size - offset)
                    stream.receive(data.copyOfRange(offset, offset + size), true)
                    offset += size
                    remaining -= size
                }
                if (offset == data.size && !ended) {
                    ended = true
                    stream.control(RtcMessage("end"))
                }
            }
            stream =
                RtcByteStream(json, { bytes, _ ->
                    val message = json.decodeFromString(RtcMessage.serializer(), bytes.decodeToString())
                    if (message.type == "credit") produce(message.bytes!!)
                    true
                }, { closed++ })
            stream.control(RtcMessage("response", status = 200, headers = mapOf("Content-Length" to data.size.toString())))
            produce(RTC_WINDOW_BYTES)
            stream.awaitResponse(Request.Builder().url("http://localhost/").build()).use {
                assertArrayEquals(data, it.body!!.bytes())
            }
            assertEquals(1, closed)
        }

    @Test(timeout = 5000)
    fun cancellationWakesUploadWaitingForCredit() {
        val executor = Executors.newSingleThreadExecutor()
        val reachedWindow = CountDownLatch(1)
        var sent = 0
        val stream =
            RtcByteStream(json, { bytes, binary ->
                if (binary) {
                    sent += bytes.size
                    if (sent == RTC_WINDOW_BYTES) reachedWindow.countDown()
                }
                true
            }, {})
        try {
            val future =
                executor.submit<Boolean> {
                    try {
                        stream.sink().write(Buffer().write(ByteArray(RTC_WINDOW_BYTES + 1)), RTC_WINDOW_BYTES + 1L)
                        false
                    } catch (
                        _: IOException,
                    ) {
                        true
                    }
                }
            assertTrue(reachedWindow.await(2, TimeUnit.SECONDS))
            stream.fail(IOException("cancelled"))
            assertTrue(future.get(2, TimeUnit.SECONDS))
        } finally {
            stream.close()
            executor.shutdownNow()
        }
    }

    @Test
    fun proxyBasePathIsRemovedFromDeviceProtocolUrl() {
        var message: RtcMessage? = null
        val stream =
            RtcByteStream(json, { bytes, _ ->
                message = json.decodeFromString(RtcMessage.serializer(), bytes.decodeToString())
                true
            }, {})
        stream.start(
            Request
                .Builder()
                .url("https://localhost/agent/api/devices/1/files/download")
                .header("Authorization", "Bearer access")
                .build(),
            "/agent",
        )
        assertEquals("/api/devices/1/files/download", message!!.url)
        assertEquals("Bearer access", message!!.headers?.get("Authorization"))
        stream.close()
    }

    @Test
    fun malformedFramesFailInsteadOfGrowingTheQueue() {
        val badMessages =
            listOf(
                RtcMessage("credit", bytes = 1),
                RtcMessage("end"),
                RtcMessage("response", status = 199),
                RtcMessage("unknown"),
            )
        for (message in badMessages) {
            var closed = false
            val stream = RtcByteStream(json, { _, _ -> true }, { closed = true })
            stream.control(message)
            assertTrue(closed)
        }
        val stream = RtcByteStream(json, { _, _ -> true }, {})
        stream.control(RtcMessage("response", status = 200))
        repeat(16) { stream.receive(ByteArray(RTC_CHUNK_BYTES), true) }
        stream.receive(byteArrayOf(1), true)
        expectIOException { stream.source().read(Buffer(), 1) }
    }

    @Test
    fun connectionLossAfterEndDoesNotHideUnreadDataLoss() {
        val stream = RtcByteStream(json, { _, _ -> true }, {})
        stream.control(RtcMessage("response", status = 200))
        stream.receive(byteArrayOf(1), true)
        stream.control(RtcMessage("end"))
        stream.fail(IOException("connection lost"))
        expectIOException { stream.source().read(Buffer(), 1) }
    }

    @Test(timeout = 5000)
    fun cancellationWakesBlockedDownload() {
        val executor = Executors.newSingleThreadExecutor()
        val started = CountDownLatch(1)
        val stream = RtcByteStream(json, { _, _ -> true }, {})
        try {
            val future =
                executor.submit<Boolean> {
                    started.countDown()
                    try {
                        stream.source().read(Buffer(), 1)
                        false
                    } catch (_: IOException) {
                        true
                    }
                }
            assertTrue(started.await(2, TimeUnit.SECONDS))
            stream.fail(IOException("cancelled"))
            assertTrue(future.get(2, TimeUnit.SECONDS))
        } finally {
            stream.close()
            executor.shutdownNow()
        }
    }

    @Test
    fun responseHeadersAndUtf8NdjsonSurviveChunkBoundaries() =
        runBlocking {
            val stream = RtcByteStream(json, { _, _ -> true }, {})
            stream.control(RtcMessage("response", status = 200, headers = mapOf("Content-Type" to "application/x-ndjson")))
            val bytes = "{\"type\":\"output\",\"data\":\"中文\"}\n".encodeToByteArray()
            bytes.forEach { stream.receive(byteArrayOf(it), true) }
            stream.control(RtcMessage("end"))
            stream.awaitResponse(Request.Builder().url("http://localhost/").build()).use { response ->
                assertEquals("application/x-ndjson", response.header("Content-Type"))
                assertEquals("{\"type\":\"output\",\"data\":\"中文\"}", response.body!!.source().readUtf8LineStrict())
                assertTrue(response.body!!.source().exhausted())
            }
        }

    private fun expectIOException(block: () -> Unit) {
        try {
            block()
            fail("Expected IOException")
        } catch (_: IOException) {
        }
    }
}
