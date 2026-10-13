package com.aylink.mobile.ui.terminal

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.yield

internal data class TerminalOutputSnapshot(
    val sequence: Long,
    val transcript: String,
)

internal class TerminalTranscript(
    private val capacity: Int,
) {
    init {
        require(capacity > 0)
    }

    // 后半段保存相同内容，使跨边界的窗口也能直接生成字符串，避免快照的临时数组。
    private val buffer = CharArray(capacity * 2)
    private var start = 0
    private var size = 0
    private var sequence = 0L
    private var cachedSnapshot = TerminalOutputSnapshot(0, "")
    private val changes = MutableStateFlow(0L)

    val snapshots: Flow<TerminalOutputSnapshot> =
        flow {
            var publishedThrough = 0L
            changes.collect { changedThrough ->
                if (changedThrough > publishedThrough) {
                    // 让已排队的输出先写入；只合并快照通知，输出内容始终保留在有界缓冲中。
                    yield()
                    val latest = snapshot()
                    emit(latest)
                    publishedThrough = latest.sequence
                }
            }
        }

    @Synchronized
    fun append(data: String): Long {
        if (data.isEmpty()) return sequence
        if (data.length >= capacity) {
            data.toCharArray(buffer, 0, data.length - capacity, data.length)
            buffer.copyInto(buffer, capacity, 0, capacity)
            start = 0
            size = capacity
        } else {
            val end = (start + size) % capacity
            val firstPart = minOf(data.length, capacity - end)
            data.toCharArray(buffer, end, 0, firstPart)
            data.toCharArray(buffer, end + capacity, 0, firstPart)
            if (firstPart < data.length) {
                data.toCharArray(buffer, 0, firstPart, data.length)
                data.toCharArray(buffer, capacity, firstPart, data.length)
            }
            start = (start + (size + data.length - capacity).coerceAtLeast(0)) % capacity
            size = (size + data.length).coerceAtMost(capacity)
        }
        sequence += data.length
        changes.value = sequence
        return sequence
    }

    @Synchronized
    fun snapshot(): TerminalOutputSnapshot {
        if (cachedSnapshot.sequence == sequence) return cachedSnapshot
        val transcript = String(buffer, start, size)
        return TerminalOutputSnapshot(sequence, transcript).also { cachedSnapshot = it }
    }
}
