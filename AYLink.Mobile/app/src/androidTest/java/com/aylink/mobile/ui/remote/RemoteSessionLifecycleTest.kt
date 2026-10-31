package com.aylink.mobile.ui.remote

import androidx.activity.ComponentActivity
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.aylink.mobile.data.model.Device
import com.aylink.mobile.data.repo.AppContainer
import com.aylink.mobile.ui.AYLinkApp
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
        val server = MockWebServer()
        server.dispatcher =
            object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse =
                    when {
                        request.path == "/api/auth/refresh" -> {
                            refreshes.incrementAndGet()
                            MockResponse().setBody("""{"accessToken":"renewed","refreshToken":"refresh"}""")
                        }
                        request.path == "/api/webrtc-ticket" -> {
                            if (request.getHeader("Authorization") == "Bearer expired") {
                                MockResponse().setResponseCode(401)
                            } else {
                                MockResponse().setBody("""{"ticket":"test","sessionId":"test","expiresInSeconds":60}""")
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
            assertNull("Token refresh created a second projection peer", offers.poll(2, TimeUnit.SECONDS))

            compose.runOnIdle { container.sessionStore.updateAccessToken("renewed-again") }
            compose.waitForIdle()
            assertNull("Updating the access token restarted projection", offers.poll(2, TimeUnit.SECONDS))
            assertNull("Updating the access token closed the existing peer", closed.poll())

            compose.runOnIdle { mounted.value = false }
            compose.waitForIdle()
            assertNotNull("Leaving projection did not close its peer", closed.poll(10, TimeUnit.SECONDS))
            compose.runOnIdle { mounted.value = true }
            compose.waitForIdle()
            assertNotNull("Reopening projection did not create a new peer", offers.poll(10, TimeUnit.SECONDS))
            assertNull("Reopening projection created duplicate peers", offers.poll(2, TimeUnit.SECONDS))

            compose.runOnIdle { container.sessionStore.clearSession() }
            compose.waitForIdle()
            assertNotNull("Logging out did not close the projection peer", closed.poll(10, TimeUnit.SECONDS))
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
