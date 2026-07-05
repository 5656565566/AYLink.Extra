package com.aylink.mobile.ui.remote

import androidx.compose.ui.geometry.Offset

internal data class RemoteTouchPointerEvent(
    val phase: String,
    val pointerId: Int,
    val isPrimary: Boolean,
    val point: Offset,
    val epoch: Int,
)

internal class RemoteTouchPointerState {
    private val activePointers = linkedMapOf<Long, ActivePointer>()
    private var primarySourcePointerId: Long? = null
    private var nextScrcpyPointerId = 0
    private var currentEpoch = 0

    val epoch: Int
        get() = currentEpoch

    fun resetForInputBoundary(): Int {
        activePointers.clear()
        primarySourcePointerId = null
        nextScrcpyPointerId = 0
        currentEpoch += 1
        return currentEpoch
    }

    fun beginGesture(
        sourcePointerId: Long,
        point: Offset,
        emit: (RemoteTouchPointerEvent) -> Unit,
    ) {
        releaseOtherPointers(sourcePointerId, "cancel", emit)
        pointerDown(sourcePointerId, point, emit)
    }

    fun pointerDown(
        sourcePointerId: Long,
        point: Offset,
        emit: (RemoteTouchPointerEvent) -> Unit,
    ) {
        activePointers[sourcePointerId]?.let { stale ->
            emit(stale.toEvent("cancel", point = stale.lastPoint, epoch = currentEpoch))
            activePointers.remove(sourcePointerId)
        }

        val pointer =
            ActivePointer(
                sourcePointerId = sourcePointerId,
                scrcpyPointerId = nextScrcpyPointerId++,
                lastPoint = point,
            )
        activePointers[sourcePointerId] = pointer
        if (primarySourcePointerId == null) {
            primarySourcePointerId = sourcePointerId
        }
        emit(pointer.toEvent("down", point, currentEpoch))
    }

    fun pointerMove(
        sourcePointerId: Long,
        point: Offset,
        emit: (RemoteTouchPointerEvent) -> Unit,
    ) {
        val pointer = activePointers[sourcePointerId] ?: return
        if (pointer.lastPoint == point) {
            return
        }

        pointer.lastPoint = point
        emit(pointer.toEvent("move", point, currentEpoch))
    }

    fun pointerUp(
        sourcePointerId: Long,
        point: Offset,
        emit: (RemoteTouchPointerEvent) -> Unit,
    ) {
        releasePointer(sourcePointerId, "up", point, emit)
    }

    fun pointerCancel(
        sourcePointerId: Long,
        point: Offset? = null,
        emit: (RemoteTouchPointerEvent) -> Unit,
    ) {
        releasePointer(sourcePointerId, "cancel", point, emit)
    }

    fun cancelActivePointers(emit: (RemoteTouchPointerEvent) -> Unit) {
        releaseAll("cancel", emit)
    }

    fun clear() {
        activePointers.clear()
        primarySourcePointerId = null
        nextScrcpyPointerId = 0
    }

    private fun releasePointer(
        sourcePointerId: Long,
        phase: String,
        point: Offset?,
        emit: (RemoteTouchPointerEvent) -> Unit,
    ) {
        val pointer = activePointers.remove(sourcePointerId) ?: return
        emit(pointer.toEvent(phase, point ?: pointer.lastPoint, currentEpoch))
        if (primarySourcePointerId == sourcePointerId) {
            primarySourcePointerId = activePointers.keys.firstOrNull()
        }
        resetPointerIdsIfIdle()
    }

    private fun releaseOtherPointers(
        keptSourcePointerId: Long,
        phase: String,
        emit: (RemoteTouchPointerEvent) -> Unit,
    ) {
        val stalePointers =
            activePointers
                .filterKeys { it != keptSourcePointerId }
                .values
                .toList()
        stalePointers.forEach { pointer ->
            activePointers.remove(pointer.sourcePointerId)
            emit(pointer.toEvent(phase, pointer.lastPoint, currentEpoch))
        }
        if (primarySourcePointerId != keptSourcePointerId && activePointers.isEmpty()) {
            primarySourcePointerId = null
        }
        resetPointerIdsIfIdle()
    }

    private fun releaseAll(
        phase: String,
        emit: (RemoteTouchPointerEvent) -> Unit,
    ) {
        if (activePointers.isEmpty()) {
            primarySourcePointerId = null
            return
        }

        val pointers = activePointers.values.toList()
        activePointers.clear()
        pointers.forEach { pointer ->
            emit(pointer.toEvent(phase, pointer.lastPoint, currentEpoch))
        }
        primarySourcePointerId = null
        resetPointerIdsIfIdle()
    }

    private fun resetPointerIdsIfIdle() {
        if (activePointers.isEmpty()) {
            nextScrcpyPointerId = 0
        }
    }

    private fun ActivePointer.toEvent(
        phase: String,
        point: Offset,
        epoch: Int,
    ): RemoteTouchPointerEvent =
        RemoteTouchPointerEvent(
            phase = phase,
            pointerId = scrcpyPointerId,
            isPrimary = sourcePointerId == primarySourcePointerId,
            point = point,
            epoch = epoch,
        )

    private data class ActivePointer(
        val sourcePointerId: Long,
        val scrcpyPointerId: Int,
        var lastPoint: Offset,
    )
}
