package com.aylink.mobile.ui.remote

internal enum class VideoStreamState(val wireName: String) {
    Idle("idle"),
    Connecting("connecting"),
    Observing("observing"),
    Stable("stable"),
    Stalled("stalled"),
    Detached("detached");

    override fun toString(): String = wireName
}

internal data class VideoStreamStateMachine(
    var state: VideoStreamState = VideoStreamState.Idle,
    var connectionId: Int? = null,
    var stableSinceMillis: Long = 0L,
    var lastUnstableAtMillis: Long = 0L
)

internal fun resetVideoStreamStateMachine(machine: VideoStreamStateMachine) {
    machine.state = VideoStreamState.Idle
    machine.connectionId = null
    machine.stableSinceMillis = 0L
    machine.lastUnstableAtMillis = 0L
}

internal fun markVideoStreamConnecting(machine: VideoStreamStateMachine, connectionId: Int, nowMillis: Long) {
    machine.state = VideoStreamState.Connecting
    machine.connectionId = connectionId
    machine.stableSinceMillis = 0L
    machine.lastUnstableAtMillis = nowMillis
}

internal fun markVideoStreamUnstable(machine: VideoStreamStateMachine, connectionId: Int, nowMillis: Long) {
    if (machine.connectionId != connectionId) {
        machine.connectionId = connectionId
    }
    machine.state = VideoStreamState.Stalled
    machine.stableSinceMillis = 0L
    machine.lastUnstableAtMillis = nowMillis
}

internal fun markVideoStreamAdvanced(machine: VideoStreamStateMachine, connectionId: Int, nowMillis: Long) {
    if (machine.connectionId != connectionId || machine.state == VideoStreamState.Idle || machine.state == VideoStreamState.Connecting || machine.state == VideoStreamState.Stalled) {
        machine.connectionId = connectionId
        machine.state = VideoStreamState.Observing
        machine.stableSinceMillis = nowMillis
        return
    }

    if (machine.state == VideoStreamState.Observing) {
        return
    }

    if (machine.state == VideoStreamState.Stable || machine.state == VideoStreamState.Detached) {
        return
    }

    machine.state = VideoStreamState.Observing
    machine.stableSinceMillis = nowMillis
}

internal fun markVideoStreamDetached(machine: VideoStreamStateMachine, connectionId: Int) {
    if (machine.connectionId != connectionId) {
        return
    }
    machine.state = VideoStreamState.Detached
}

internal fun markVideoStreamStable(machine: VideoStreamStateMachine, connectionId: Int) {
    if (machine.connectionId != connectionId || machine.stableSinceMillis <= 0L || machine.state == VideoStreamState.Idle || machine.state == VideoStreamState.Connecting || machine.state == VideoStreamState.Stalled) {
        return
    }
    machine.state = VideoStreamState.Stable
}

internal fun getVideoStreamStableDurationMillis(machine: VideoStreamStateMachine, connectionId: Int, nowMillis: Long): Long {
    if (machine.connectionId != connectionId || machine.stableSinceMillis <= 0L || machine.state == VideoStreamState.Idle || machine.state == VideoStreamState.Connecting || machine.state == VideoStreamState.Stalled) {
        return 0L
    }
    return (nowMillis - machine.stableSinceMillis).coerceAtLeast(0L)
}

internal fun getVideoStreamDetachDelayMillis(machine: VideoStreamStateMachine, connectionId: Int, nowMillis: Long, stablePeriodMillis: Long): Long? {
    val stableDuration = getVideoStreamStableDurationMillis(machine, connectionId, nowMillis)
    if (stableDuration <= 0L) {
        return null
    }
    return (stablePeriodMillis - stableDuration).coerceAtLeast(0L)
}
