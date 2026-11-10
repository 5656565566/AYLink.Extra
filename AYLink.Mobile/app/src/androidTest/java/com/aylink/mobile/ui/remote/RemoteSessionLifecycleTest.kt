package com.aylink.mobile.ui.remote

import androidx.activity.ComponentActivity
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.aylink.mobile.data.model.Device
import com.aylink.mobile.data.repo.AppContainer
import com.aylink.mobile.ui.AYLinkApp
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

@RunWith(AndroidJUnit4::class)
class RemoteSessionLifecycleTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun expiredTokenRestoreKeepsOnePeerAndDisposesItWhenLeaving() {
        val offers = LinkedBlockingQueue<WebSocket>()
        val closed = LinkedBlockingQueue<WebSocket>()
        val refreshes = AtomicInteger()
        val pages = AtomicInteger()
        val heartbeats = LinkedBlockingQueue<String>()

        fun awaitHeartbeat(
            pageId: String,
            bitmap: String,
        ) {
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3)
            while (System.nanoTime() < deadline) {
                val body = heartbeats.poll(deadline - System.nanoTime(), TimeUnit.NANOSECONDS) ?: break
                val payload = Json.parseToJsonElement(body).jsonObject
                if (payload["p"]?.jsonPrimitive?.content == pageId && payload["b"]?.jsonPrimitive?.content == bitmap) return
            }
            error("Missing heartbeat for $pageId with bitmap $bitmap")
        }

        val server = MockWebServer()
        server.dispatcher =
            object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse =
                    when {
                        request.path == "/api/auth/refresh" -> {
                            refreshes.incrementAndGet()
                            MockResponse().setBody("""{"accessToken":"renewed","refreshToken":"refresh"}""")
                        }
                        request.path == "/api/scrcpy-sessions/page" -> {
                            if (request.getHeader("Authorization") == "Bearer expired") {
                                MockResponse().setResponseCode(401)
                            } else {
                                MockResponse().setBody("""{"p":"test-page-${pages.incrementAndGet()}"}""")
                            }
                        }
                        request.path == "/api/webrtc-ticket" -> {
                            val ticketRequest = Json.parseToJsonElement(request.body.readUtf8()).jsonObject
                            assertNotNull(ticketRequest["pageId"])
                            MockResponse().setBody("""{"ticket":"test","sessionId":"test","slot":0,"expiresInSeconds":60}""")
                        }
                        request.path == "/api/scrcpy-sessions/heartbeat" -> {
                            if (request.getHeader("Authorization") !in setOf("Bearer renewed", "Bearer renewed-again")) {
                                MockResponse().setResponseCode(401)
                            } else {
                                heartbeats.offer(request.body.readUtf8())
                                MockResponse().setBody("""{"success":true}""")
                            }
                        }
                        request.path?.startsWith("/webrtc?") == true ->
                            MockResponse().withWebSocketUpgrade(
                                object : WebSocketListener() {
                                    override fun onMessage(
                                        webSocket: WebSocket,
                                        text: String,
                                    ) {
                                        if (text.contains("\"sdp\"")) offers.add(webSocket)
                                    }

                                    override fun onClosing(
                                        webSocket: WebSocket,
                                        code: Int,
                                        reason: String,
                                    ) {
                                        webSocket.close(code, reason)
                                    }

                                    override fun onClosed(
                                        webSocket: WebSocket,
                                        code: Int,
                                        reason: String,
                                    ) {
                                        closed.add(webSocket)
                                    }
                                },
                            )
                        else -> MockResponse().setBody("{}")
                    }
            }
        server.start()
        val container = AppContainer(compose.activity.applicationContext)
        val mounted = mutableStateOf(true)
        try {
            container.sessionStore.updateBaseUrl(server.url("/").toString())
            container.sessionStore.updateSession("expired", "refresh")
            container.sessionStore.updateLastRemoteDevice(Device(id = 1, name = "测试设备"))
            container.localSettingsStore.updateResumeLastRemote(true)
            compose.setContent { if (mounted.value) AYLinkApp(container) }

            assertNotNull("Restored projection did not create an offer", offers.poll(10, TimeUnit.SECONDS))
            compose.waitForIdle()
            assertEquals(1, refreshes.get())
            awaitHeartbeat("test-page-1", "AQAB")
            assertNull("Token refresh created a second projection peer", offers.poll(2, TimeUnit.SECONDS))

            compose.runOnIdle { container.sessionStore.updateAccessToken("renewed-again") }
            compose.waitForIdle()
            assertNull("Updating the access token restarted projection", offers.poll(2, TimeUnit.SECONDS))
            assertNull("Updating the access token closed the existing peer", closed.poll())

            compose.runOnIdle { mounted.value = false }
            compose.waitForIdle()
            assertNotNull("Leaving projection did not close its peer", closed.poll(10, TimeUnit.SECONDS))
            awaitHeartbeat("test-page-1", "")
            compose.runOnIdle { mounted.value = true }
            compose.waitForIdle()
            assertNotNull("Reopening projection did not create a new peer", offers.poll(10, TimeUnit.SECONDS))
            assertNull("Reopening projection created duplicate peers", offers.poll(2, TimeUnit.SECONDS))

            compose.runOnIdle { container.sessionStore.clearSession() }
            compose.waitForIdle()
            assertNotNull("Logging out did not close the projection peer", closed.poll(10, TimeUnit.SECONDS))
            awaitHeartbeat("test-page-2", "")
        } finally {
            compose.runOnIdle { mounted.value = false }
            compose.waitForIdle()
            container.sessionStore.clearSession()
            container.deviceTransport.pool.close()
            val client = container.okHttpClient
            client.dispatcher.cancelAll()
            client.connectionPool.evictAll()
            client.dispatcher.executorService.shutdown()
            server.shutdown()
        }
    }
}
