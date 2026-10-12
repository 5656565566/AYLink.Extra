package com.aylink.mobile.data.transport

import kotlinx.coroutines.CompletableDeferred
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody
import okio.Buffer
import okio.Sink
import okio.Source
import okio.Timeout
import okio.buffer
import java.io.IOException
import java.util.concurrent.TimeUnit

internal const val RTC_CHUNK_BYTES = 16 * 1024
internal const val RTC_WINDOW_BYTES = 256 * 1024

@Serializable
internal data class RtcMessage(
    val type: String,
    val method: String? = null,
    val url: String? = null,
    val headers: Map<String, String>? = null,
    val status: Int? = null,
    val bytes: Int? = null,
    val error: String? = null,
)

// 与 Agent transport/rtc 保持相同的分块和窗口；只有消费者读取后才返还额度。
internal class RtcByteStream(
    private val json: Json,
    private val send: (ByteArray, Boolean) -> Boolean,
    private val onFinished: () -> Unit,
) {
    private val lock = Object()
    private val input = Buffer()
    private val response = CompletableDeferred<RtcMessage>()
    private var credit = RTC_WINDOW_BYTES
    private var allowance = RTC_WINDOW_BYTES
    private var responseStarted = false
    private var ended = false
    private var finished = false
    private var readCompleted = false
    private var failure: IOException? = null
    private val readTimeout = Timeout().timeout(5, TimeUnit.MINUTES)
    private val writeTimeout = Timeout().timeout(5, TimeUnit.MINUTES)

    val responseEnded: Boolean
        get() = synchronized(lock) { ended }

    fun receive(
        data: ByteArray,
        binary: Boolean,
    ) {
        try {
            synchronized(lock) {
                if (finished) return
                if (data.size > RTC_CHUNK_BYTES) throw IOException("RTC frame exceeds chunk limit")
                if (binary) {
                    if (!responseStarted || ended || data.isEmpty() || data.size > allowance) {
                        throw IOException("Invalid RTC receive window")
                    }
                    allowance -= data.size
                    input.write(data)
                } else {
                    val message = json.decodeFromString(RtcMessage.serializer(), data.decodeToString(throwOnInvalidSequence = true))
                    when (message.type) {
                        "response" -> {
                            if (responseStarted || message.status !in 200..599) throw IOException("Invalid RTC response")
                            responseStarted = true
                            response.complete(message)
                        }
                        "credit" -> {
                            val bytes = message.bytes ?: 0
                            if (bytes <= 0 || bytes > RTC_WINDOW_BYTES - credit) throw IOException("Invalid RTC credit")
                            credit += bytes
                        }
                        "end" -> {
                            if (!responseStarted || ended) throw IOException("Invalid RTC end")
                            ended = true
                        }
                        "cancel", "error" -> throw IOException(message.error ?: "RTC request failed")
                        else -> throw IOException("Unknown RTC message")
                    }
                }
                lock.notifyAll()
            }
        } catch (error: Exception) {
            fail(IOException(error.message ?: "Invalid RTC frame", error))
        }
    }

    fun start(
        request: Request,
        basePath: String = "",
    ) {
        val headers = request.headers.toMap().toMutableMap()
        request.body?.contentType()?.let { headers["Content-Type"] = it.toString() }
        val url = request.url.encodedPath.removePrefix(basePath) + (request.url.encodedQuery?.let { "?$it" } ?: "")
        synchronized(lock) {
            sendControl(RtcMessage(type = "request", method = request.method, url = url, headers = headers))
        }
    }

    fun end() {
        synchronized(lock) {
            if (!ended && !finished) sendControl(RtcMessage(type = "end"))
        }
    }

    suspend fun awaitResponse(request: Request): Response {
        val head = response.await()
        val source = source().buffer()
        val body =
            object : ResponseBody() {
                override fun contentType() =
                    head.headers
                        ?.entries
                        ?.firstOrNull { it.key.equals("Content-Type", true) }
                        ?.value
                        ?.toMediaTypeOrNull()

                override fun contentLength() =
                    head.headers
                        ?.entries
                        ?.firstOrNull { it.key.equals("Content-Length", true) }
                        ?.value
                        ?.toLongOrNull() ?: -1L

                override fun source() = source
            }
        return Response
            .Builder()
            .request(request)
            .protocol(Protocol.HTTP_1_1)
            .code(head.status!!)
            .message("")
            .apply { head.headers?.forEach { (name, value) -> addHeader(name, value) } }
            .body(body)
            .build()
    }

    fun source(): Source =
        object : Source {
            override fun read(
                sink: Buffer,
                byteCount: Long,
            ): Long {
                require(byteCount >= 0)
                if (byteCount == 0L) return 0
                val count =
                    synchronized(lock) {
                        if (readCompleted) return -1L
                        while (input.size == 0L && !ended && !finished) readTimeout.waitUntilNotified(lock)
                        checkFailure()
                        if (input.size == 0L && ended) {
                            readCompleted = true
                            -1L
                        } else {
                            val count = input.read(sink, minOf(byteCount, input.size))
                            allowance += count.toInt()
                            sendControl(RtcMessage(type = "credit", bytes = count.toInt()))
                            count
                        }
                    }
                if (count == -1L) close()
                return count
            }

            override fun timeout() = readTimeout

            override fun close() = this@RtcByteStream.close()
        }

    fun sink(): Sink =
        object : Sink {
            override fun write(
                source: Buffer,
                byteCount: Long,
            ) {
                var remaining = byteCount
                while (remaining > 0) {
                    synchronized(lock) {
                        while (credit == 0 && !ended && !finished) writeTimeout.waitUntilNotified(lock)
                        checkFailure()
                        if (ended) throw IOException("RTC response ended")
                        val size = minOf(remaining, credit.toLong(), RTC_CHUNK_BYTES.toLong()).toInt()
                        credit -= size
                        if (!send(source.readByteArray(size.toLong()), true)) throw IOException("RTC send failed")
                        remaining -= size
                    }
                }
            }

            override fun timeout() = writeTimeout

            override fun flush() = Unit

            // 请求体 EOF 只结束发送方向，响应仍需读完。
            override fun close() = end()
        }

    fun fail(error: IOException) = finish(error)

    fun close() = finish(null)

    private fun finish(error: IOException?) {
        synchronized(lock) {
            if (finished) return
            finished = true
            failure = error ?: IOException("RTC request closed")
            input.clear()
            response.completeExceptionally(failure!!)
            lock.notifyAll()
        }
        onFinished()
    }

    private fun checkFailure() {
        failure?.let { throw it }
    }

    private fun sendControl(message: RtcMessage) {
        checkFailure()
        val bytes = json.encodeToString(RtcMessage.serializer(), message).encodeToByteArray()
        if (bytes.size > RTC_CHUNK_BYTES || !send(bytes, false)) throw IOException("RTC control send failed")
    }
}
