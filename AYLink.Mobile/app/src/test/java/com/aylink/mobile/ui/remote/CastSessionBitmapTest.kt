package com.aylink.mobile.ui.remote

import com.aylink.mobile.data.model.ScrcpySessionHeartbeatRequest
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Test

class CastSessionBitmapTest {
    @Test
    fun pageReleaseIncludesExplicitEmptyBitmap() {
        val release = ScrcpySessionHeartbeatRequest("page", 9, "")
        assertEquals("""{"p":"page","v":9,"b":""}""", Json.encodeToString(ScrcpySessionHeartbeatRequest.serializer(), release))
    }

    @Test
    fun matchesWebHeartbeatAndKeepsClosedSlots() {
        assertEquals("AAA", encodeCastSessionBitmap(0, emptyList()))
        assertEquals("AQAB", encodeCastSessionBitmap(1, listOf(0)))
        assertEquals("AgAC", encodeCastSessionBitmap(2, listOf(1)))
        assertEquals("AgAA", encodeCastSessionBitmap(2, emptyList()))
        assertEquals("CQCBAQ", encodeCastSessionBitmap(9, listOf(0, 7, 8)))
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsUnregisteredSlot() {
        encodeCastSessionBitmap(1, listOf(1))
    }
}
