package com.aylink.mobile.ui.remote

import androidx.compose.ui.geometry.Offset

internal data class RemoteTouchPointerEvent(
    val phase: String,
    val pointerId: Int,
    val isPrimary: Boolean,
    val point: Offset
)

internal class RemoteTouchPointerState {
    private val activePointers = linkedMapOf<Int, ActivePointer>()
    private var primarySourcePointerId: Int? = null
    private var nextScrcpyPointerId = 0

    fun beginGesture(
        sourcePointerId: Int,
        point: Offset,
        emit: (RemoteTouchPointerEvent) -> Unit
    ) {
        releaseAll("cancel", emit)
        pointerDown(sourcePointerId, point, emit)
    }

    fun pointerDown(
        sourcePointerId: Int,
        point: Offset,
        emit: (RemoteTouchPointerEvent) -> Unit
    ) {
        activePointers[sourcePointerId]?.let { stale ->
            emit(stale.toEvent("cancel", point = stale.lastPoint))
            activePointers.remove(sourcePointerId)
        }

        val pointer = ActivePointer(
            sourcePointerId = sourcePointerId,
            scrcpyPointerId = nextScrcpyPointerId++,
            lastPoint = point
        )
        activePointers[sourcePointerId] = pointer
        if (primarySourcePointerId == null) {
            primarySourcePointerId = sourcePointerId
        }
        emit(pointer.toEvent("down", point))
    }

    fun pointerMove(
        sourcePointerId: Int,
        point: Offset,
        emit: (RemoteTouchPointerEvent) -> Unit
    ) {
        val pointer = activePointers[sourcePointerId] ?: return
        if (pointer.lastPoint == point) {
            return
        }

        pointer.lastPoint = point
        emit(pointer.toEvent("move", point))
    }

    fun pointerUp(
        sourcePointerId: Int,
        point: Offset,
        emit: (RemoteTouchPointerEvent) -> Unit
    ) {
        releasePointer(sourcePointerId, "up", point, emit)
    }

    fun pointerCancel(
        sourcePointerId: Int,
        point: Offset? = null,
        emit: (RemoteTouchPointerEvent) -> Unit
    ) {
        releasePointer(sourcePointerId, "cancel", point, emit)
    }

    fun cancelActivePointers(emit: (RemoteTouchPointerEvent) -> Unit) {
        releaseAll("cancel", emit)
    }

    fun clear() {
        activePointers.clear()
        primarySourcePointerId = null
    }

    private fun releasePointer(
        sourcePointerId: Int,
        phase: String,
        point: Offset?,
        emit: (RemoteTouchPointerEvent) -> Unit
    ) {
        val pointer = activePointers.remove(sourcePointerId) ?: return
        emit(pointer.toEvent(phase, point ?: pointer.lastPoint))
        if (primarySourcePointerId == sourcePointerId) {
            primarySourcePointerId = activePointers.keys.firstOrNull()
        }
    }

    private fun releaseAll(
        phase: String,
        emit: (RemoteTouchPointerEvent) -> Unit
    ) {
        if (activePointers.isEmpty()) {
            primarySourcePointerId = null
            return
        }

        val pointers = activePointers.values.toList()
        activePointers.clear()
        primarySourcePointerId = null
        pointers.forEach { pointer ->
            emit(pointer.toEvent(phase, pointer.lastPoint))
        }
    }

    private fun ActivePointer.toEvent(phase: String, point: Offset): RemoteTouchPointerEvent {
        return RemoteTouchPointerEvent(
            phase = phase,
            pointerId = scrcpyPointerId,
            isPrimary = sourcePointerId == primarySourcePointerId,
            point = point
        )
    }

    private data class ActivePointer(
        val sourcePointerId: Int,
        val scrcpyPointerId: Int,
        var lastPoint: Offset
    )
}
