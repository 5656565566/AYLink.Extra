package com.aylink.mobile.ui.remote

import com.aylink.mobile.data.model.VideoStreamHealthSnapshot

enum class UnifiedVideoStreamState {
    Idle,
    Connecting,
    Observing,
    Stable,
    Degraded,
    Stalled,
    Recovering,
    Detached,
}

enum class UnifiedVideoHealthOrigin {
    Unknown,
    Source,
    Sender,
    Transport,
    Client,
}

enum class UnifiedVideoRecoveryAction {
    Observe,
    KeyFrameReplay,
    SourceRefresh,
    SignalingReattach,
    Renegotiate,
    IceRestart,
    Reconnect,
}

data class ClientVideoHealthSnapshot(
    val state: String,
    val reason: String,
    val signalingAttached: Boolean,
    val peerConnected: Boolean,
)

data class UnifiedVideoRecoveryDecision(
    val state: UnifiedVideoStreamState,
    val origin: UnifiedVideoHealthOrigin,
    val action: UnifiedVideoRecoveryAction,
    val reason: String,
)

fun decideVideoRecovery(
    client: ClientVideoHealthSnapshot,
    agent: VideoStreamHealthSnapshot?,
): UnifiedVideoRecoveryDecision {
    val agentOrigin = normalizeOrigin(agent?.origin)
    val agentState = agent?.state.orEmpty().lowercase()
    val sourceState =
        agent
            ?.source
            ?.state
            .orEmpty()
            .lowercase()
    val senderState =
        agent
            ?.sender
            ?.state
            .orEmpty()
            .lowercase()
    val transportState =
        agent
            ?.transport
            ?.peerConnectionState
            .orEmpty()
            .lowercase()
    val agentReason =
        listOfNotNull(
            agent?.reason,
            agent?.source?.reason,
            agent?.source?.state,
        ).firstOrNull { it.isNotBlank() }
            .orEmpty()

    if (
        isStaticButAliveSource(sourceState) &&
        isAgentVideoPathHealthy(
            senderState,
            transportState,
            agent?.transport?.sessionClosed == true,
        )
    ) {
        return UnifiedVideoRecoveryDecision(
            state = UnifiedVideoStreamState.Observing,
            origin = UnifiedVideoHealthOrigin.Source,
            action = UnifiedVideoRecoveryAction.Observe,
            reason = agentReason.ifBlank { client.reason },
        )
    }

    if (agentOrigin == UnifiedVideoHealthOrigin.Source || agentState == "stalled") {
        return UnifiedVideoRecoveryDecision(
            state = UnifiedVideoStreamState.Stalled,
            origin = UnifiedVideoHealthOrigin.Source,
            action = UnifiedVideoRecoveryAction.SourceRefresh,
            reason = agentReason.ifBlank { client.reason },
        )
    }

    val transportRecoveryAction =
        if (client.signalingAttached) {
            UnifiedVideoRecoveryAction.IceRestart
        } else {
            UnifiedVideoRecoveryAction.SignalingReattach
        }
    if (agentOrigin == UnifiedVideoHealthOrigin.Transport || !client.peerConnected) {
        return UnifiedVideoRecoveryDecision(
            state = UnifiedVideoStreamState.Degraded,
            origin = UnifiedVideoHealthOrigin.Transport,
            action = transportRecoveryAction,
            reason = agentReason.ifBlank { client.reason },
        )
    }

    if (!client.signalingAttached) {
        return UnifiedVideoRecoveryDecision(
            state = UnifiedVideoStreamState.Detached,
            origin = UnifiedVideoHealthOrigin.Transport,
            action = UnifiedVideoRecoveryAction.SignalingReattach,
            reason = client.reason,
        )
    }

    if (agentOrigin == UnifiedVideoHealthOrigin.Sender) {
        return UnifiedVideoRecoveryDecision(
            state = UnifiedVideoStreamState.Recovering,
            origin = UnifiedVideoHealthOrigin.Sender,
            action = UnifiedVideoRecoveryAction.KeyFrameReplay,
            reason = agentReason.ifBlank { client.reason },
        )
    }

    return UnifiedVideoRecoveryDecision(
        state = UnifiedVideoStreamState.Stalled,
        origin = UnifiedVideoHealthOrigin.Client,
        action = UnifiedVideoRecoveryAction.KeyFrameReplay,
        reason = client.reason,
    )
}

private fun isStaticButAliveSource(state: String): Boolean = state == "static_but_alive"

private fun isAgentVideoPathHealthy(
    senderState: String,
    transportState: String,
    sessionClosed: Boolean,
): Boolean {
    if (sessionClosed) {
        return false
    }
    return senderState == "ready" && transportState != "failed" && transportState != "closed"
}

private fun normalizeOrigin(value: String?): UnifiedVideoHealthOrigin =
    when (value.orEmpty().lowercase()) {
        "source" -> UnifiedVideoHealthOrigin.Source
        "sender" -> UnifiedVideoHealthOrigin.Sender
        "transport" -> UnifiedVideoHealthOrigin.Transport
        "client" -> UnifiedVideoHealthOrigin.Client
        else -> UnifiedVideoHealthOrigin.Unknown
    }
