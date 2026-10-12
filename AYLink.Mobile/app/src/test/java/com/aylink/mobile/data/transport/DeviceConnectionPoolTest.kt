package com.aylink.mobile.data.transport

import com.aylink.mobile.data.api.ApiException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import okhttp3.Request
import okhttp3.Response
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.IOException

class DeviceConnectionPoolTest {
    private class Connection : DeviceConnection {
        override var isOpen = true

        override suspend fun request(request: Request): Response = error("Unused")

        override fun close() {
            isOpen = false
        }
    }

    @Test(timeout = 5000)
    fun concurrentWaitersShareConnectionAndOneCancellationDoesNotCancelOthers() =
        runBlocking {
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            val entered = CompletableDeferred<Unit>()
            val result = CompletableDeferred<DeviceConnection>()
            var attempts = 0
            val pool =
                DeviceConnectionPool(scope, { "account" }, {
                    attempts++
                    entered.complete(Unit)
                    result.await()
                })
            try {
                val first = async { pool.acquire(1) }
                entered.await()
                val second = async { pool.acquire(1) }
                first.cancel()
                val connection = Connection()
                result.complete(connection)
                assertSame(connection, withTimeout(2000) { second.await() })
                assertSame(connection, pool.acquire(1))
                assertEquals(1, attempts)
            } finally {
                pool.close()
                scope.cancel()
            }
        }

    @Test
    fun establishmentFailureIsCachedForThirtySecondsThenRetried() =
        runBlocking {
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            var time = 0L
            var attempts = 0
            val pool =
                DeviceConnectionPool(scope, { "account" }, {
                    attempts++
                    throw IOException("No route")
                }, { time })
            try {
                assertNull(pool.acquire(1))
                time = 29_999
                assertNull(pool.acquire(1))
                assertEquals(1, attempts)
                time = 30_000
                assertNull(pool.acquire(1))
                assertEquals(2, attempts)
            } finally {
                pool.close()
                scope.cancel()
            }
        }

    @Test
    fun accountAndDeviceScopesNeverReuseAnotherConnection() =
        runBlocking {
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            var account = "server-a|admin|1"
            val connections = mutableListOf<Connection>()
            val pool = DeviceConnectionPool(scope, { account }, { Connection().also { connections += it } })
            try {
                val first = pool.acquire(1)
                val other = pool.acquire(2)
                assertTrue(first !== other)
                pool.refreshAccount()
                assertTrue(first!!.isOpen)
                account = "server-b|admin|1"
                pool.refreshAccount()
                assertFalse(first.isOpen)
                assertFalse(other!!.isOpen)
                assertTrue(pool.acquire(1) !== first)
                assertEquals(3, connections.size)
            } finally {
                pool.close()
                scope.cancel()
            }
        }

    @Test(timeout = 5000)
    fun lateConnectionFromOldAccountIsClosed() =
        runBlocking {
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            var account = "old"
            val entered = CompletableDeferred<Unit>()
            val result = CompletableDeferred<DeviceConnection>()
            val pool =
                DeviceConnectionPool(scope, { account }, {
                    withContext(NonCancellable) {
                        entered.complete(Unit)
                        result.await()
                    }
                })
            try {
                val pending = async { pool.acquire(1) }
                entered.await()
                account = "new"
                val connection = Connection()
                result.complete(connection)
                try {
                    pending.await()
                    fail("Old account connection must be rejected")
                } catch (_: CancellationException) {
                }
                assertFalse(connection.isOpen)
            } finally {
                pool.close()
                scope.cancel()
            }
        }

    @Test
    fun authenticationFailureIsPropagatedForTokenRefreshWithoutFailureCaching() =
        runBlocking {
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            var attempts = 0
            val connection = Connection()
            val pool =
                DeviceConnectionPool(scope, { "account" }, {
                    if (++attempts == 1) throw ApiException(401, "expired")
                    connection
                })
            try {
                try {
                    pool.acquire(1)
                    fail("Expected authentication failure")
                } catch (
                    error: ApiException,
                ) {
                    assertEquals(401, error.statusCode)
                }
                assertSame(connection, pool.acquire(1))
                assertEquals(2, attempts)
            } finally {
                pool.close()
                scope.cancel()
            }
        }
}
