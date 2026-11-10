package com.aylink.mobile.ui.remote

import java.util.Base64

internal fun encodeCastSessionBitmap(
    slotCount: Int,
    activeSlots: Collection<Int>,
): String {
    require(slotCount in 0..4096)
    val bytes = ByteArray(2 + (slotCount + 7) / 8)
    bytes[0] = slotCount.toByte()
    bytes[1] = (slotCount ushr 8).toByte()
    for (slot in activeSlots) {
        require(slot in 0 until slotCount)
        val index = 2 + slot / 8
        bytes[index] = (bytes[index].toInt() or (1 shl (slot % 8))).toByte()
    }
    return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
}
