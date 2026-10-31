package com.aylink.mobile.ui.remote

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import kotlin.math.PI
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

internal const val REMOTE_CONTROL_BUTTON_SIZE = 48f
internal const val REMOTE_CONTROL_ANCHOR_SIZE = 52f
internal const val REMOTE_CONTROL_CLEARANCE = 36f
private const val CONTROL_GAP = 8f

// 统一使用 dp 计算，避免不同屏幕密度改变按钮间距。
internal fun remoteControlAnchor(
    viewport: Size,
    dockedRight: Boolean,
    verticalFraction: Float,
    collapsed: Boolean = false,
): Offset {
    val marginX = if (collapsed) 0f else min(REMOTE_CONTROL_CLEARANCE, viewport.width / 2)
    val marginY = min(REMOTE_CONTROL_CLEARANCE, viewport.height / 2)
    return Offset(
        x = if (dockedRight) viewport.width - marginX else marginX,
        y = (viewport.height * verticalFraction).coerceIn(marginY, viewport.height - marginY),
    )
}

internal fun remoteControlOffsets(
    viewport: Size,
    anchor: Offset,
    dockedRight: Boolean,
    count: Int,
): List<Offset> {
    if (count == 0) return emptyList()
    val maxRadius = min(180f, (if (dockedRight) anchor.x else viewport.width - anchor.x) - REMOTE_CONTROL_CLEARANCE)
    var radius = 96f
    var low: Float
    var high: Float
    while (true) {
        low = asin(((REMOTE_CONTROL_CLEARANCE - anchor.y) / radius).coerceIn(-1f, 1f))
        high = asin(((viewport.height - REMOTE_CONTROL_CLEARANCE - anchor.y) / radius).coerceIn(-1f, 1f))
        val required = (count - 1) * 2 * asin((REMOTE_CONTROL_BUTTON_SIZE + CONTROL_GAP) / (2 * radius))
        if (high - low >= required || radius >= maxRadius) break
        radius = min(radius + 4f, maxRadius)
    }
    // 靠近上下边缘时，将展开弧线移向剩余空间。
    val span = min(high - low, max(0.6f, (count - 1) * PI.toFloat() / 4))
    val start = (low + high - span) / 2
    return List(count) { index ->
        val angle = start + if (count == 1) span / 2 else index * span / (count - 1)
        Offset(
            x = anchor.x + (if (dockedRight) -1 else 1) * radius * cos(angle),
            y = anchor.y + radius * sin(angle),
        )
    }
}
